"""The Telegram <-> Ollama bridge."""

from __future__ import annotations

import asyncio
import base64
import logging
import time
from typing import Any

from .config import Config
from .ollama import Chunk, OllamaClient, OllamaError
from .render import CHUNK_LIMIT, markdown_to_html, split_markdown, strip_thinking, truncate
from .store import Store
from .stream import StreamingReply
from .telegram import TelegramClient, TelegramError
from .voice import VoiceUnavailable, available_backend, transcribe

log = logging.getLogger("local-ai.bot")

COMMANDS = [
    {"command": "new", "description": "Start a fresh conversation"},
    {"command": "model", "description": "Show or switch the model"},
    {"command": "models", "description": "List installed models"},
    {"command": "system", "description": "Show, set or clear the system prompt"},
    {"command": "temp", "description": "Show or set the temperature"},
    {"command": "stats", "description": "Tokens, speed and history size"},
    {"command": "stop", "description": "Cancel the reply in progress"},
    {"command": "help", "description": "What this bot can do"},
]

HELP_TEXT = """*Your local AI, on your Mac.*

Just send a message and the model on your Mac mini answers. Photos work with
vision models, voice notes are transcribed, and text files are read inline.

*Commands*
/new — forget the conversation and start over
/model — show the current model; `/model qwen3:14b` to switch
/models — list what is installed
/system — show the system prompt; `/system be terse` to set, `/system clear` to drop
/temp — show temperature; `/temp 0.2` to set (0 = focused, 1+ = loose)
/stats — tokens generated, speed, history size
/stop — cancel a reply that is still streaming
/whoami — your Telegram user ID

Nothing leaves the Mac: no API keys, no cloud, no logs anywhere but your disk."""

TEXTUAL_MIME_PREFIXES = ("text/", "application/json", "application/xml", "application/x-yaml")
TEXTUAL_SUFFIXES = (
    ".txt", ".md", ".markdown", ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg",
    ".csv", ".tsv", ".log", ".py", ".js", ".ts", ".tsx", ".jsx", ".sh", ".bash",
    ".zsh", ".rb", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".h", ".cpp",
    ".hpp", ".cs", ".sql", ".html", ".css", ".xml", ".env", ".gitignore",
)


class Bot:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.store = Store(config.db_path)
        self.telegram = TelegramClient(config.telegram_token)
        self.ollama = OllamaClient(config.ollama_host, timeout=config.request_timeout)
        self.username = "local-ai"
        self._offset: int | None = None
        self._locks: dict[int, asyncio.Lock] = {}
        self._tasks: dict[int, set[asyncio.Task]] = {}
        self._warned_users: set[int] = set()
        self._vision_cache: dict[str, bool] = {}
        self._stopping = False

    # -- lifecycle ---------------------------------------------------------

    async def run(self) -> None:
        await self._preflight()
        log.info("listening as @%s", self.username)
        try:
            while not self._stopping:
                try:
                    updates = await self.telegram.get_updates(
                        self._offset, self.config.poll_timeout
                    )
                except TelegramError as error:
                    log.error("getUpdates: %s", error)
                    await asyncio.sleep(5)
                    continue

                for update in updates:
                    self._offset = int(update["update_id"]) + 1
                    message = update.get("message") or update.get("edited_message")
                    if message:
                        self._spawn(message)
        finally:
            await self.aclose()

    def request_stop(self) -> None:
        """Ask the polling loop to finish after the current long-poll returns."""
        self._stopping = True

    async def aclose(self) -> None:
        for tasks in self._tasks.values():
            for task in tasks:
                task.cancel()
        await self.telegram.aclose()
        await self.ollama.aclose()
        self.store.close()

    async def _preflight(self) -> None:
        me = await self.telegram.get_me()
        self.username = me.get("username", "local-ai")
        await self.telegram.delete_webhook()
        await self.telegram.set_my_commands(COMMANDS)

        if not self.config.allowed_user_ids:
            log.warning(
                "TELEGRAM_ALLOWED_USER_IDS is empty -- the bot will refuse everyone "
                "and reply with their user ID so you can add it to .env"
            )
        try:
            version = await self.ollama.version()
            installed = await self.ollama.model_names()
            log.info("ollama %s at %s (%d models)", version, self.config.ollama_host, len(installed))
            if installed and self.config.default_model not in installed:
                log.warning(
                    "default model %s is not installed; try: ollama pull %s",
                    self.config.default_model,
                    self.config.default_model,
                )
        except OllamaError as error:
            log.warning("%s -- start it with: ollama serve", error)

    def _spawn(self, message: dict) -> None:
        chat_id = int(message["chat"]["id"])
        task = asyncio.create_task(self._guarded(message))
        self._tasks.setdefault(chat_id, set()).add(task)
        task.add_done_callback(lambda t: self._tasks.get(chat_id, set()).discard(t))

    async def _guarded(self, message: dict) -> None:
        try:
            await self._handle(message)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - one bad update must not kill the poller
            log.exception("failed to handle update")

    # -- routing -----------------------------------------------------------

    async def _handle(self, message: dict) -> None:
        chat_id = int(message["chat"]["id"])
        sender = message.get("from") or {}
        user_id = int(sender.get("id", 0))

        if not self.config.is_allowed(user_id):
            await self._refuse(chat_id, user_id, sender)
            return

        text = (message.get("text") or message.get("caption") or "").strip()
        if text.startswith("/"):
            command, _, argument = text.partition(" ")
            command = command.split("@")[0].lower()
            handled = await self._command(chat_id, command, argument.strip(), user_id)
            if handled:
                return
            # Unknown command: fall through and treat the whole thing as a prompt.

        prompt, images = await self._collect_input(chat_id, message, text)
        if prompt is None:
            return
        if not prompt.strip() and not images:
            return

        lock = self._locks.setdefault(chat_id, asyncio.Lock())
        async with lock:
            await self._respond(chat_id, message, prompt, images)

    async def _refuse(self, chat_id: int, user_id: int, sender: dict) -> None:
        name = sender.get("username") or sender.get("first_name") or "unknown"
        log.warning("rejected message from %s (id=%s)", name, user_id)
        if user_id in self._warned_users:
            return
        self._warned_users.add(user_id)
        await self.telegram.send_message(
            chat_id,
            "This bot is private.\n\n"
            f"Your Telegram user ID is {user_id}. If this is your bot, add it to "
            "TELEGRAM_ALLOWED_USER_IDS in local-ai/.env and restart the service.",
        )

    # -- commands ----------------------------------------------------------

    async def _command(self, chat_id: int, command: str, argument: str, user_id: int) -> bool:
        if command in {"/start", "/help"}:
            await self._send(chat_id, HELP_TEXT)
        elif command == "/whoami":
            await self._send(chat_id, f"Your Telegram user ID is `{user_id}`.")
        elif command == "/ping":
            await self._ping(chat_id)
        elif command == "/new":
            removed = self.store.clear_history(chat_id)
            await self._send(chat_id, f"Fresh start — dropped {removed} message(s).")
        elif command == "/model":
            await self._model(chat_id, argument)
        elif command == "/models":
            await self._models(chat_id)
        elif command == "/system":
            await self._system(chat_id, argument)
        elif command == "/temp":
            await self._temperature(chat_id, argument)
        elif command == "/stats":
            await self._stats(chat_id)
        elif command == "/stop":
            await self._stop(chat_id)
        else:
            return False
        return True

    async def _ping(self, chat_id: int) -> None:
        try:
            version = await self.ollama.version()
            await self._send(chat_id, f"Ollama {version} is up at `{self.config.ollama_host}`.")
        except OllamaError as error:
            await self._send(chat_id, f"Ollama is not answering: {error}")

    async def _model(self, chat_id: int, argument: str) -> None:
        current = self._model_for(chat_id)
        if not argument:
            await self._send(
                chat_id,
                f"Current model: `{current}`\n\nSwitch with `/model <name>`, "
                "see options with /models.",
            )
            return

        try:
            installed = await self.ollama.model_names()
        except OllamaError as error:
            await self._send(chat_id, f"Cannot reach Ollama: {error}")
            return

        choice = self._resolve_model(argument, installed)
        if choice is None:
            listing = "\n".join(f"• `{name}`" for name in installed) or "(none installed)"
            await self._send(chat_id, f"No model matches `{argument}`.\n\nInstalled:\n{listing}")
            return

        self.store.update_settings(chat_id, model=choice)
        await self._send(chat_id, f"Switched to `{choice}`. History kept — /new to clear it.")

    @staticmethod
    def _resolve_model(argument: str, installed: list[str]) -> str | None:
        wanted = argument.strip()
        if wanted in installed:
            return wanted
        if f"{wanted}:latest" in installed:
            return f"{wanted}:latest"
        matches = [name for name in installed if name.startswith(wanted)]
        if len(matches) == 1:
            return matches[0]
        loose = [name for name in installed if wanted.lower() in name.lower()]
        return loose[0] if len(loose) == 1 else None

    async def _models(self, chat_id: int) -> None:
        try:
            models = await self.ollama.list_models()
        except OllamaError as error:
            await self._send(chat_id, f"Cannot reach Ollama: {error}")
            return
        if not models:
            await self._send(
                chat_id,
                "No models installed yet. On the Mac run "
                "`local-ai/scripts/pull-models.sh` or `ollama pull qwen3:8b`.",
            )
            return

        current = self._model_for(chat_id)
        lines = []
        for model in sorted(models, key=lambda m: str(m.get("name", ""))):
            name = str(model.get("name", ""))
            size = int(model.get("size") or 0) / 1e9
            marker = "▸" if name == current else "•"
            lines.append(f"{marker} `{name}` — {size:.1f} GB")
        await self._send(chat_id, "*Installed models*\n" + "\n".join(lines))

    async def _system(self, chat_id: int, argument: str) -> None:
        settings = self.store.get_settings(chat_id)
        if not argument:
            current = settings.system_prompt or self.config.system_prompt
            body = f"```\n{current}\n```" if current else "_(none — the model's default)_"
            await self._send(
                chat_id,
                f"*System prompt*\n{body}\n\nSet with `/system <text>`, drop with `/system clear`.",
            )
            return
        if argument.lower() in {"clear", "reset", "none", "off"}:
            self.store.update_settings(chat_id, system_prompt=None)
            await self._send(chat_id, "System prompt cleared.")
            return
        self.store.update_settings(chat_id, system_prompt=argument)
        await self._send(chat_id, "System prompt set. It applies from the next message.")

    async def _temperature(self, chat_id: int, argument: str) -> None:
        settings = self.store.get_settings(chat_id)
        if not argument:
            current = settings.temperature if settings.temperature is not None else self.config.temperature
            await self._send(chat_id, f"Temperature is `{current}`. Set with `/temp 0.3`.")
            return
        try:
            value = float(argument)
        except ValueError:
            await self._send(chat_id, f"`{argument}` is not a number. Try `/temp 0.7`.")
            return
        if not 0.0 <= value <= 2.0:
            await self._send(chat_id, "Temperature must be between 0 and 2.")
            return
        self.store.update_settings(chat_id, temperature=value)
        await self._send(chat_id, f"Temperature set to `{value}`.")

    async def _stats(self, chat_id: int) -> None:
        stats = self.store.get_stats(chat_id)
        messages = self.store.message_count(chat_id)
        speed = stats["eval_tokens"] / stats["eval_seconds"] if stats["eval_seconds"] else 0.0
        voice = available_backend() or "not installed"
        await self._send(
            chat_id,
            "*Stats*\n"
            f"• model: `{self._model_for(chat_id)}`\n"
            f"• replies: {stats['replies']}\n"
            f"• tokens generated: {stats['eval_tokens']:,}\n"
            f"• average speed: {speed:.1f} tok/s\n"
            f"• history: {messages} message(s)\n"
            f"• voice backend: `{voice}`",
        )

    async def _stop(self, chat_id: int) -> None:
        # This handler runs inside one of the chat's own tasks -- skip it, or
        # /stop would cancel itself before it could reply.
        current = asyncio.current_task()
        cancelled = 0
        for task in list(self._tasks.get(chat_id, set())):
            if task is not current and not task.done():
                task.cancel()
                cancelled += 1
        await self._send(
            chat_id,
            f"Stopped {cancelled} reply(ies)." if cancelled else "Nothing was running.",
        )

    # -- input collection --------------------------------------------------

    async def _collect_input(
        self, chat_id: int, message: dict, text: str
    ) -> tuple[str | None, list[str]]:
        """Turn a Telegram message into prompt text plus base64 images."""
        images: list[str] = []
        parts: list[str] = [text] if text else []
        max_bytes = self.config.max_file_mb * 1024 * 1024

        if photos := message.get("photo"):
            largest = max(photos, key=lambda p: int(p.get("file_size") or 0))
            try:
                blob = await self.telegram.download_file(largest["file_id"], max_bytes)
            except TelegramError as error:
                await self._send(chat_id, f"Could not fetch that photo: {error.description}")
                return None, []
            images.append(base64.b64encode(blob).decode("ascii"))
            if not parts:
                parts.append("What is in this image?")

        if voice := (message.get("voice") or message.get("audio") or message.get("video_note")):
            transcript = await self._transcribe(chat_id, voice, max_bytes)
            if transcript is None:
                return None, []
            parts.insert(0, transcript)

        if document := message.get("document"):
            content = await self._read_document(chat_id, document, max_bytes)
            if content is None:
                return None, []
            parts.append(content)

        return "\n\n".join(part for part in parts if part), images

    async def _transcribe(self, chat_id: int, media: dict, max_bytes: int) -> str | None:
        if not self.config.voice_enabled:
            await self._send(chat_id, "Voice notes are disabled (LOCAL_AI_VOICE=0).")
            return None
        await self.telegram.send_chat_action(chat_id, "typing")
        try:
            blob = await self.telegram.download_file(media["file_id"], max_bytes)
        except TelegramError as error:
            await self._send(chat_id, f"Could not fetch that audio: {error.description}")
            return None
        try:
            return await transcribe(blob, model=self.config.whisper_model)
        except VoiceUnavailable as error:
            await self._send(chat_id, f"Cannot transcribe: {error}")
            return None

    async def _read_document(self, chat_id: int, document: dict, max_bytes: int) -> str | None:
        name = str(document.get("file_name") or "attachment")
        mime = str(document.get("mime_type") or "")
        textual = mime.startswith(TEXTUAL_MIME_PREFIXES) or name.lower().endswith(TEXTUAL_SUFFIXES)
        if not textual:
            await self._send(
                chat_id,
                f"`{name}` is a {mime or 'binary'} file — I can only read text files and images.",
            )
            return None
        try:
            blob = await self.telegram.download_file(document["file_id"], max_bytes)
        except TelegramError as error:
            await self._send(chat_id, f"Could not fetch `{name}`: {error.description}")
            return None

        body = blob.decode("utf-8", "replace")
        budget = self.config.history_chars
        if len(body) > budget:
            body = body[:budget] + f"\n\n[truncated — {len(blob):,} bytes total]"
        return f"Attached file `{name}`:\n\n```\n{body}\n```"

    # -- generation --------------------------------------------------------

    def _model_for(self, chat_id: int) -> str:
        return self.store.get_settings(chat_id).model or self.config.default_model

    async def _pick_model(self, chat_id: int, has_images: bool) -> tuple[str, str | None]:
        """Return ``(model, note)``, swapping in the vision model when needed."""
        model = self._model_for(chat_id)
        if not has_images:
            return model, None

        if model not in self._vision_cache:
            self._vision_cache[model] = await self.ollama.supports_vision(model)
        if self._vision_cache[model]:
            return model, None
        if self.config.vision_model:
            return self.config.vision_model, (
                f"_(answered with `{self.config.vision_model}` — `{model}` cannot see images)_"
            )
        return model, (
            f"_(`{model}` may not support images; set LOCAL_AI_VISION_MODEL in .env)_"
        )

    def _build_messages(self, chat_id: int, prompt: str, images: list[str]) -> list[dict]:
        settings = self.store.get_settings(chat_id)
        system = settings.system_prompt or self.config.system_prompt
        messages: list[dict] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.extend(
            self.store.history(chat_id, self.config.history_turns, self.config.history_chars)
        )
        user_message: dict[str, Any] = {"role": "user", "content": prompt}
        if images:
            user_message["images"] = images
        messages.append(user_message)
        return messages

    async def _respond(
        self, chat_id: int, message: dict, prompt: str, images: list[str]
    ) -> None:
        model, note = await self._pick_model(chat_id, bool(images))
        # Assemble the prompt from history *before* storing this turn, or the
        # new message would appear twice: once from history, once appended.
        outgoing = self._build_messages(chat_id, prompt, images)
        self.store.add_message(chat_id, "user", prompt, images or None)

        reply = StreamingReply(
            self.telegram,
            chat_id,
            reply_to=int(message["message_id"]),
            interval=self.config.stream_interval,
            min_chars=self.config.stream_min_chars,
        )
        typing = asyncio.create_task(self._keep_typing(chat_id))
        started = time.monotonic()
        answer: list[str] = []
        last: Chunk | None = None
        in_thinking = False

        try:
            settings = self.store.get_settings(chat_id)
            temperature = (
                settings.temperature if settings.temperature is not None else self.config.temperature
            )
            stream = self.ollama.chat(
                model,
                outgoing,
                temperature=temperature,
                num_ctx=self.config.num_ctx,
                think=True if self.config.show_thinking else None,
            )
            async for chunk in stream:
                last = chunk
                if chunk.thinking and self.config.show_thinking:
                    if not in_thinking:
                        in_thinking = True
                        await reply.push("_thinking…_\n")
                if chunk.content:
                    if in_thinking:
                        in_thinking = False
                        await reply.push("\n")
                    answer.append(chunk.content)
                    await reply.push(chunk.content)
        except asyncio.CancelledError:
            await reply.finish("\n_(stopped)_")
            raise
        except OllamaError as error:
            await reply.replace(f"⚠️ {error}")
            return
        finally:
            typing.cancel()

        text = strip_thinking("".join(answer)).strip()
        footer = self._footer(model, last, time.monotonic() - started, note)
        await reply.finish(footer)

        if text:
            self.store.add_message(chat_id, "assistant", text)
        if last is not None:
            self.store.record_reply(chat_id, last.eval_count, last.eval_seconds or 0.0)

    def _footer(
        self, model: str, last: Chunk | None, wall_seconds: float, note: str | None
    ) -> str:
        pieces = []
        if note:
            pieces.append(note)
        if last is not None and last.eval_count:
            seconds = last.eval_seconds or wall_seconds
            speed = last.eval_count / seconds if seconds else 0.0
            pieces.append(f"_{model} · {last.eval_count} tok · {speed:.0f} tok/s_")
        elif note is None:
            return ""
        return "\n".join(pieces)

    async def _keep_typing(self, chat_id: int) -> None:
        try:
            while True:
                await self.telegram.send_chat_action(chat_id, "typing")
                await asyncio.sleep(4)
        except asyncio.CancelledError:
            pass

    # -- helpers -----------------------------------------------------------

    async def _send(self, chat_id: int, markdown: str) -> None:
        for chunk in split_markdown(truncate(markdown, CHUNK_LIMIT * 4), CHUNK_LIMIT):
            try:
                await self.telegram.send_message(
                    chat_id, markdown_to_html(chunk), parse_mode="HTML"
                )
            except TelegramError:
                await self.telegram.send_message(chat_id, chunk)
