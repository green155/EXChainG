"""Live-updating Telegram replies.

The model streams tokens; Telegram rate-limits edits. This buffers the stream
and repaints one message a few times a second, rolling over to a fresh message
whenever the text outgrows Telegram's 4096-character ceiling.
"""

from __future__ import annotations

import logging
import time

from .render import CHUNK_LIMIT, close_open_fence, markdown_to_html, split_once
from .telegram import TelegramClient, TelegramError

log = logging.getLogger("local-ai.stream")

CURSOR = " ▍"
EMPTY_PLACEHOLDER = "…"


def _looks_like_parse_error(error: TelegramError) -> bool:
    description = error.description.lower()
    return "parse entities" in description or "unsupported start tag" in description


class StreamingReply:
    """Owns the message(s) that carry one model response."""

    def __init__(
        self,
        telegram: TelegramClient,
        chat_id: int,
        *,
        reply_to: int | None = None,
        interval: float = 1.1,
        min_chars: int = 48,
    ) -> None:
        self.telegram = telegram
        self.chat_id = chat_id
        self.reply_to = reply_to
        self.interval = interval
        self.min_chars = min_chars

        self.pending = ""
        self.message_id: int | None = None
        self.sent_messages = 0
        self._last_paint = 0.0
        self._last_painted_len = 0
        self._last_display = ""
        self._plain_only = False

    # -- public API --------------------------------------------------------

    async def push(self, delta: str) -> None:
        if not delta:
            return
        self.pending += delta
        if self._should_paint():
            await self._paint(cursor=True)

    async def finish(self, footer: str = "") -> None:
        if footer:
            self.pending = f"{self.pending.rstrip()}\n\n{footer}" if self.pending.strip() else footer
        if not self.pending.strip():
            self.pending = "_(the model returned nothing)_"
        await self._paint(cursor=False, force=True)

    async def replace(self, text: str) -> None:
        """Discard the stream so far and show ``text`` instead (used for errors)."""
        self.pending = text
        self._last_display = ""
        await self._paint(cursor=False, force=True)

    # -- internals ---------------------------------------------------------

    def _should_paint(self) -> bool:
        now = time.monotonic()
        if len(self.pending) - self._last_painted_len >= CHUNK_LIMIT:
            return True
        if now - self._last_paint < self.interval:
            return False
        return len(self.pending) - self._last_painted_len >= self.min_chars

    async def _paint(self, *, cursor: bool, force: bool = False) -> None:
        # Roll finished chunks into their own messages before repainting.
        while len(self.pending) > CHUNK_LIMIT:
            head, tail = split_once(self.pending, CHUNK_LIMIT)
            if not tail:
                break
            self.pending = head
            await self._write(self._display(head, cursor=False))
            self.message_id = None
            self._last_display = ""
            self.pending = tail

        display = self._display(self.pending, cursor=cursor)
        if display == self._last_display and not force:
            return
        await self._write(display)
        self._last_display = display
        self._last_paint = time.monotonic()
        self._last_painted_len = len(self.pending)

    def _display(self, markdown: str, *, cursor: bool) -> str:
        text = close_open_fence(markdown.rstrip()) if markdown.strip() else ""
        if cursor:
            text += CURSOR
        return text or EMPTY_PLACEHOLDER

    async def _write(self, display: str) -> None:
        html_text = None if self._plain_only else markdown_to_html(display)
        for text, parse_mode in ((html_text, "HTML"), (display, None)):
            if text is None:
                continue
            try:
                await self._send_or_edit(text, parse_mode)
                return
            except TelegramError as error:
                if error.is_not_modified:
                    return
                if parse_mode == "HTML" and _looks_like_parse_error(error):
                    # Something in the model's output defeated the converter.
                    log.warning("falling back to plain text: %s", error.description)
                    self._plain_only = True
                    continue
                raise

    async def _send_or_edit(self, text: str, parse_mode: str | None) -> None:
        if self.message_id is None:
            message = await self.telegram.send_message(
                self.chat_id,
                text,
                parse_mode=parse_mode,
                reply_to=self.reply_to if self.sent_messages == 0 else None,
            )
            self.message_id = int(message["message_id"])
            self.sent_messages += 1
        else:
            await self.telegram.edit_message(
                self.chat_id, self.message_id, text, parse_mode=parse_mode
            )
