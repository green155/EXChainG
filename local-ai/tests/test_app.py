from __future__ import annotations

import pytest

from bot.app import Bot
from bot.config import Config
from bot.ollama import Chunk


class FakeTelegram:
    def __init__(self) -> None:
        self.sent: list[tuple[int, str]] = []
        self.files: dict[str, bytes] = {}
        self.actions: list[str] = []
        self._final: dict[int, str] = {}

    async def send_message(self, chat_id, text, *, parse_mode=None, reply_to=None, **kwargs):
        self.sent.append((chat_id, text))
        message_id = len(self.sent)
        self._final[message_id] = text
        return {"message_id": message_id}

    async def edit_message(self, chat_id, message_id, text, *, parse_mode=None, **kwargs):
        self._final[message_id] = text
        return {"message_id": message_id}

    async def send_chat_action(self, chat_id, action="typing"):
        self.actions.append(action)

    async def download_file(self, file_id, max_bytes):
        return self.files[file_id]

    @property
    def text(self) -> str:
        """Every message as it finally reads, after streaming edits."""
        return "\n".join(self._final[mid] for mid in sorted(self._final))


@pytest.fixture
def bot(tmp_path):
    config = Config(
        telegram_token="1:abc",
        allowed_user_ids={7},
        default_model="qwen3:8b",
        system_prompt="global prompt",
        data_dir=tmp_path,
    )
    bot = Bot(config)
    bot.telegram = FakeTelegram()  # type: ignore[assignment]
    yield bot
    bot.store.close()


def message(text: str = "", *, user_id: int = 7, chat_id: int = 7, **extra) -> dict:
    payload = {
        "message_id": 1,
        "chat": {"id": chat_id},
        "from": {"id": user_id, "username": "tester"},
    }
    if text:
        payload["text"] = text
    payload.update(extra)
    return payload


# -- model resolution --------------------------------------------------------


@pytest.mark.parametrize(
    "argument,expected",
    [
        ("qwen3:8b", "qwen3:8b"),
        ("gemma3", "gemma3:latest"),
        ("qwen3:1", "qwen3:14b"),
        ("GEMMA3:LATEST", "gemma3:latest"),
        ("nope", None),
    ],
)
def test_resolve_model(argument, expected):
    installed = ["qwen3:8b", "qwen3:14b", "gemma3:latest"]
    assert Bot._resolve_model(argument, installed) == expected


def test_resolve_model_refuses_an_ambiguous_prefix():
    assert Bot._resolve_model("qwen3", ["qwen3:8b", "qwen3:14b"]) is None


# -- prompt assembly ---------------------------------------------------------


def test_messages_start_with_the_global_system_prompt(bot):
    messages = bot._build_messages(7, "hello", [])
    assert messages[0] == {"role": "system", "content": "global prompt"}
    assert messages[-1] == {"role": "user", "content": "hello"}


def test_a_per_chat_system_prompt_wins(bot):
    bot.store.update_settings(7, system_prompt="chat prompt")
    assert bot._build_messages(7, "hi", [])[0]["content"] == "chat prompt"


def test_history_sits_between_system_and_the_new_message(bot):
    bot.store.add_message(7, "user", "earlier")
    bot.store.add_message(7, "assistant", "reply")
    messages = bot._build_messages(7, "now", [])
    assert [m["content"] for m in messages] == ["global prompt", "earlier", "reply", "now"]


def test_images_ride_along_with_the_user_message(bot):
    messages = bot._build_messages(7, "what is this", ["ZmFrZQ=="])
    assert messages[-1]["images"] == ["ZmFrZQ=="]


def test_another_chats_history_is_not_leaked(bot):
    bot.store.add_message(999, "user", "someone else")
    assert all("someone else" != m["content"] for m in bot._build_messages(7, "hi", []))


# -- footer ------------------------------------------------------------------


def test_footer_reports_tokens_and_speed(bot):
    chunk = Chunk(done=True, eval_count=100, eval_duration_ns=2_000_000_000)
    footer = bot._footer("qwen3:8b", chunk, 2.5, None)
    assert "100 tok" in footer
    assert "50 tok/s" in footer


def test_footer_is_empty_without_stats(bot):
    assert bot._footer("qwen3:8b", None, 1.0, None) == ""


def test_footer_keeps_the_note_even_without_stats(bot):
    assert bot._footer("qwen3:8b", None, 1.0, "_(swapped model)_") == "_(swapped model)_"


# -- access control ----------------------------------------------------------


async def test_a_stranger_is_refused_and_told_their_id(bot):
    await bot._handle(message("hello", user_id=1234))
    assert "1234" in bot.telegram.text
    assert "private" in bot.telegram.text.lower()


async def test_a_stranger_is_only_warned_once(bot):
    await bot._handle(message("hello", user_id=1234))
    await bot._handle(message("hello again", user_id=1234))
    assert len(bot.telegram.sent) == 1


async def test_a_refused_message_is_never_stored(bot):
    await bot._handle(message("secret", user_id=1234, chat_id=1234))
    assert bot.store.message_count(1234) == 0


async def test_an_empty_allowlist_refuses_everyone(tmp_path):
    bot = Bot(Config(telegram_token="1:abc", data_dir=tmp_path))
    bot.telegram = FakeTelegram()  # type: ignore[assignment]
    await bot._handle(message("hi", user_id=7))
    assert "private" in bot.telegram.text.lower()
    bot.store.close()


# -- commands ----------------------------------------------------------------


async def test_new_clears_the_history(bot):
    bot.store.add_message(7, "user", "old")
    await bot._handle(message("/new"))
    assert bot.store.message_count(7) == 0


async def test_temp_sets_a_valid_value(bot):
    await bot._handle(message("/temp 0.2"))
    assert bot.store.get_settings(7).temperature == 0.2


@pytest.mark.parametrize("argument", ["hot", "-1", "5"])
async def test_temp_rejects_bad_values(bot, argument):
    await bot._handle(message(f"/temp {argument}"))
    assert bot.store.get_settings(7).temperature is None


async def test_system_sets_and_clears(bot):
    await bot._handle(message("/system be terse"))
    assert bot.store.get_settings(7).system_prompt == "be terse"
    await bot._handle(message("/system clear"))
    assert bot.store.get_settings(7).system_prompt is None


async def test_whoami_reports_the_user_id(bot):
    await bot._handle(message("/whoami"))
    assert "7" in bot.telegram.text


async def test_a_command_addressed_to_the_bot_still_matches(bot):
    await bot._handle(message("/new@my_local_bot"))
    assert "Fresh start" in bot.telegram.text


async def test_help_lists_the_commands(bot):
    await bot._handle(message("/help"))
    assert "/model" in bot.telegram.text


# -- attachments -------------------------------------------------------------


async def test_a_text_document_is_inlined(bot):
    bot.telegram.files["f1"] = b"print('hi')\n"
    prompt, images = await bot._collect_input(
        7,
        message("explain", document={"file_id": "f1", "file_name": "a.py", "mime_type": "text/x-python"}),
        "explain",
    )
    assert "explain" in prompt
    assert "print('hi')" in prompt
    assert images == []


async def test_a_binary_document_is_refused_politely(bot):
    prompt, _ = await bot._collect_input(
        7,
        message(document={"file_id": "f1", "file_name": "a.zip", "mime_type": "application/zip"}),
        "",
    )
    assert prompt is None
    assert "only read text files" in bot.telegram.text


async def test_an_oversized_document_is_truncated(bot):
    bot.config.history_chars = 100
    bot.telegram.files["f1"] = b"x" * 5000
    prompt, _ = await bot._collect_input(
        7, message(document={"file_id": "f1", "file_name": "big.txt"}), ""
    )
    assert "truncated" in prompt
    assert len(prompt) < 1000


async def test_a_photo_becomes_base64_with_a_default_question(bot):
    bot.telegram.files["p2"] = b"\x89PNG fake"
    prompt, images = await bot._collect_input(
        7,
        message(photo=[{"file_id": "p1", "file_size": 10}, {"file_id": "p2", "file_size": 99}]),
        "",
    )
    assert len(images) == 1
    assert prompt == "What is in this image?"


async def test_a_photo_caption_is_used_as_the_prompt(bot):
    bot.telegram.files["p1"] = b"fake"
    prompt, images = await bot._collect_input(
        7, message(photo=[{"file_id": "p1", "file_size": 10}]), "whose dog is this"
    )
    assert prompt == "whose dog is this"
    assert len(images) == 1


async def test_voice_is_refused_when_disabled(bot):
    bot.config.voice_enabled = False
    prompt, _ = await bot._collect_input(7, message(voice={"file_id": "v1"}), "")
    assert prompt is None
    assert "disabled" in bot.telegram.text


# -- model selection for images ---------------------------------------------


async def test_a_vision_model_is_swapped_in_for_images(bot):
    bot.config.vision_model = "gemma3:4b"
    bot._vision_cache["qwen3:8b"] = False
    model, note = await bot._pick_model(7, has_images=True)
    assert model == "gemma3:4b"
    assert "gemma3:4b" in note


async def test_no_swap_when_the_model_already_sees(bot):
    bot._vision_cache["qwen3:8b"] = True
    model, note = await bot._pick_model(7, has_images=True)
    assert model == "qwen3:8b"
    assert note is None


async def test_text_only_never_touches_the_vision_model(bot):
    bot.config.vision_model = "gemma3:4b"
    assert await bot._pick_model(7, has_images=False) == ("qwen3:8b", None)
