"""One message in, one streamed reply out -- with only the network faked."""

from __future__ import annotations

import json

import httpx
import pytest

from bot.app import Bot
from bot.config import Config
from bot.ollama import OllamaClient
from tests.test_app import FakeTelegram, message


def ndjson(*objects) -> bytes:
    return b"".join(json.dumps(o).encode() + b"\n" for o in objects)


def reply_stream(text: str, *, tokens: int = 12) -> bytes:
    pieces = [{"message": {"content": part}, "done": False} for part in text.split(" ")]
    for piece in pieces[1:]:
        piece["message"]["content"] = " " + piece["message"]["content"]
    pieces.append(
        {
            "message": {"content": ""},
            "done": True,
            "eval_count": tokens,
            "eval_duration": 1_000_000_000,
        }
    )
    return ndjson(*pieces)


@pytest.fixture
def wired(tmp_path):
    """A bot whose Telegram and Ollama sides are both fakes."""
    seen: list[dict] = []
    responses: list[httpx.Response] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/chat":
            seen.append(json.loads(request.content))
        return responses.pop(0) if responses else httpx.Response(200, content=reply_stream("ok"))

    config = Config(
        telegram_token="1:abc",
        allowed_user_ids={7},
        default_model="qwen3:8b",
        data_dir=tmp_path,
        stream_interval=0.0,
        stream_min_chars=0,
    )
    bot = Bot(config)
    bot.telegram = FakeTelegram()  # type: ignore[assignment]
    bot.ollama = OllamaClient("http://ollama.test", transport=httpx.MockTransport(handler))
    yield bot, seen, responses
    bot.store.close()


async def test_a_message_gets_a_streamed_reply(wired):
    bot, seen, _ = wired
    await bot._handle(message("what is 2+2"))

    assert bot.telegram.sent, "the bot never sent anything"
    assert "ok" in bot.telegram.text
    assert seen[0]["model"] == "qwen3:8b"
    assert seen[0]["messages"][-1]["content"] == "what is 2+2"


async def test_the_prompt_contains_each_turn_exactly_once(wired):
    bot, seen, _ = wired
    await bot._handle(message("hi"))
    assert [m["content"] for m in seen[0]["messages"]] == ["hi"]


async def test_the_exchange_is_remembered(wired):
    bot, _, _ = wired
    await bot._handle(message("first"))

    history = bot.store.history(7, 10, 10_000)
    assert [m["role"] for m in history] == ["user", "assistant"]
    assert history[0]["content"] == "first"
    assert history[1]["content"] == "ok"


async def test_the_second_message_carries_the_first(wired):
    bot, seen, _ = wired
    await bot._handle(message("first"))
    await bot._handle(message("second"))

    contents = [m["content"] for m in seen[1]["messages"]]
    assert contents == ["first", "ok", "second"]


async def test_stats_are_recorded(wired):
    bot, _, _ = wired
    await bot._handle(message("hi"))

    stats = bot.store.get_stats(7)
    assert stats["replies"] == 1
    assert stats["eval_tokens"] == 12


async def test_the_footer_names_the_model(wired):
    bot, _, _ = wired
    await bot._handle(message("hi"))
    assert "qwen3:8b" in bot.telegram.text


async def test_per_chat_settings_reach_the_request(wired):
    bot, seen, _ = wired
    bot.store.update_settings(7, model="qwen3:14b", temperature=0.1, system_prompt="be brief")
    await bot._handle(message("hi"))

    assert seen[0]["model"] == "qwen3:14b"
    assert seen[0]["options"]["temperature"] == 0.1
    assert seen[0]["messages"][0] == {"role": "system", "content": "be brief"}


async def test_a_missing_model_is_explained_not_crashed(wired):
    bot, _, responses = wired
    responses.append(httpx.Response(404, json={"error": "model not found"}))
    await bot._handle(message("hi"))

    assert "ollama pull qwen3:8b" in bot.telegram.text


async def test_a_long_reply_arrives_in_several_messages(wired):
    bot, _, responses = wired
    responses.append(httpx.Response(200, content=reply_stream("sentence " * 2000)))
    await bot._handle(message("write a lot"))

    assert len(bot.telegram.sent) >= 2


async def test_thinking_is_not_stored_in_history(wired):
    bot, _, responses = wired
    responses.append(
        httpx.Response(
            200,
            content=ndjson(
                {"message": {"content": "<think>scratch</think>the answer"}, "done": True},
            ),
        )
    )
    await bot._handle(message("hi"))

    stored = bot.store.history(7, 10, 10_000)[-1]["content"]
    assert stored == "the answer"


async def test_an_ollama_outage_does_not_kill_the_handler(wired):
    bot, _, _ = wired

    def dead(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    bot.ollama = OllamaClient("http://ollama.test", transport=httpx.MockTransport(dead))
    await bot._handle(message("hi"))

    assert "⚠️" in bot.telegram.text
