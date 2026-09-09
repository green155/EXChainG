from __future__ import annotations

from bot.render import CHUNK_LIMIT
from bot.stream import CURSOR, StreamingReply
from bot.telegram import TelegramError


class FakeTelegram:
    """Records what the bot would have sent to Telegram."""

    def __init__(self, *, fail_html: bool = False, not_modified: bool = False) -> None:
        self.fail_html = fail_html
        self.not_modified = not_modified
        self.sent: list[dict] = []
        self.edits: list[dict] = []
        self._next_id = 100

    def _guard(self, parse_mode):
        if self.fail_html and parse_mode == "HTML":
            raise TelegramError("sendMessage", "Bad Request: can't parse entities", 400)

    async def send_message(self, chat_id, text, *, parse_mode=None, reply_to=None, **kwargs):
        self._guard(parse_mode)
        self._next_id += 1
        self.sent.append(
            {"chat_id": chat_id, "text": text, "parse_mode": parse_mode, "reply_to": reply_to}
        )
        return {"message_id": self._next_id}

    async def edit_message(self, chat_id, message_id, text, *, parse_mode=None, **kwargs):
        self._guard(parse_mode)
        if self.not_modified:
            raise TelegramError("editMessageText", "Bad Request: message is not modified", 400)
        self.edits.append({"message_id": message_id, "text": text, "parse_mode": parse_mode})
        return {"message_id": message_id}

    @property
    def messages(self) -> list[str]:
        """Final text of each distinct message, in order."""
        latest: dict[int, str] = {}
        order: list[int] = []
        for index, call in enumerate(self.sent):
            message_id = 101 + index
            latest[message_id] = call["text"]
            order.append(message_id)
        for edit in self.edits:
            latest[edit["message_id"]] = edit["text"]
        return [latest[mid] for mid in order]


def reply_for(telegram, **kwargs) -> StreamingReply:
    return StreamingReply(telegram, chat_id=1, interval=0.0, min_chars=0, **kwargs)


async def test_a_simple_stream_produces_one_message_without_a_cursor():
    telegram = FakeTelegram()
    reply = reply_for(telegram)
    await reply.push("Hello ")
    await reply.push("world")
    await reply.finish()

    assert len(telegram.sent) == 1
    assert telegram.messages == ["Hello world"]
    assert CURSOR.strip() not in telegram.messages[0]


async def test_intermediate_paints_carry_a_cursor():
    telegram = FakeTelegram()
    reply = reply_for(telegram)
    await reply.push("thinking")
    assert telegram.sent[0]["text"].endswith(CURSOR.strip())
    await reply.finish()


async def test_the_first_message_is_a_reply_and_later_ones_are_not():
    telegram = FakeTelegram()
    reply = reply_for(telegram, reply_to=55)
    await reply.push("x" * (CHUNK_LIMIT * 2))
    await reply.finish()

    assert telegram.sent[0]["reply_to"] == 55
    assert all(call["reply_to"] is None for call in telegram.sent[1:])


async def test_long_output_rolls_into_several_messages():
    telegram = FakeTelegram()
    reply = reply_for(telegram)
    await reply.push("word " * 3000)
    await reply.finish()

    assert len(telegram.sent) >= 2
    assert all(len(text) <= 4096 for text in telegram.messages)


async def test_a_code_block_split_across_messages_stays_balanced():
    telegram = FakeTelegram()
    reply = reply_for(telegram)
    body = "\n".join(f"line_{i} = {i}" for i in range(1500))
    await reply.push(f"```python\n{body}\n```")
    await reply.finish()

    assert len(telegram.sent) >= 2
    for text in telegram.messages:
        assert text.count("<pre>") == text.count("</pre>")


async def test_html_is_used_when_telegram_accepts_it():
    telegram = FakeTelegram()
    reply = reply_for(telegram)
    await reply.push("**bold**")
    await reply.finish()

    assert telegram.sent[0]["parse_mode"] == "HTML"
    assert "<b>bold</b>" in telegram.messages[0]


async def test_a_parse_failure_falls_back_to_plain_text_and_stays_there():
    telegram = FakeTelegram(fail_html=True)
    reply = reply_for(telegram)
    await reply.push("**bold**")
    await reply.push(" more")
    await reply.finish()

    assert telegram.sent[0]["parse_mode"] is None
    assert "**bold**" in telegram.messages[0]
    assert all(edit["parse_mode"] is None for edit in telegram.edits)


async def test_not_modified_is_swallowed():
    telegram = FakeTelegram(not_modified=True)
    reply = reply_for(telegram)
    await reply.push("hello")
    await reply.push(" again")
    await reply.finish()  # would raise if the error escaped


async def test_finish_appends_a_footer():
    telegram = FakeTelegram()
    reply = reply_for(telegram)
    await reply.push("answer")
    await reply.finish("_qwen3:8b · 12 tok/s_")

    assert "answer" in telegram.messages[0]
    assert "12 tok/s" in telegram.messages[0]


async def test_an_empty_stream_still_says_something():
    telegram = FakeTelegram()
    reply = reply_for(telegram)
    await reply.finish()

    assert telegram.messages
    assert telegram.messages[0].strip()


async def test_replace_discards_the_partial_stream():
    telegram = FakeTelegram()
    reply = reply_for(telegram)
    await reply.push("half an answer")
    await reply.replace("⚠️ out of memory")

    assert telegram.messages[-1] == "⚠️ out of memory"


async def test_a_partial_code_fence_is_closed_while_streaming():
    telegram = FakeTelegram()
    reply = reply_for(telegram)
    await reply.push("```python\nx = 1")

    assert "<pre>" in telegram.sent[0]["text"]
    assert "</pre>" in telegram.sent[0]["text"]
    await reply.finish()


async def test_throttling_skips_paints_inside_the_interval():
    telegram = FakeTelegram()
    reply = StreamingReply(telegram, chat_id=1, interval=60.0, min_chars=10_000)
    await reply.push("a")
    await reply.push("b")
    assert telegram.sent == []  # nothing painted yet
    await reply.finish()
    assert telegram.messages == ["ab"]
