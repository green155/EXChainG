from __future__ import annotations

import json

import httpx
import pytest

from bot.ollama import OllamaClient, OllamaError


def client_for(handler) -> OllamaClient:
    return OllamaClient("http://ollama.test", transport=httpx.MockTransport(handler))


def ndjson(*objects) -> bytes:
    return b"".join(json.dumps(o).encode() + b"\n" for o in objects)


async def collect(client, **kwargs):
    return [chunk async for chunk in client.chat("m", [{"role": "user", "content": "hi"}], **kwargs)]


async def test_version_is_parsed():
    client = client_for(lambda r: httpx.Response(200, json={"version": "0.5.0"}))
    assert await client.version() == "0.5.0"
    await client.aclose()


async def test_unreachable_server_is_explained():
    def handler(request):
        raise httpx.ConnectError("connection refused", request=request)

    client = client_for(handler)
    with pytest.raises(OllamaError, match="cannot reach Ollama"):
        await client.version()
    await client.aclose()


async def test_model_names_are_sorted():
    client = client_for(
        lambda r: httpx.Response(200, json={"models": [{"name": "b:1"}, {"name": "a:1"}]})
    )
    assert await client.model_names() == ["a:1", "b:1"]
    await client.aclose()


async def test_streamed_chunks_are_decoded():
    payload = ndjson(
        {"message": {"content": "Hel"}, "done": False},
        {"message": {"content": "lo"}, "done": False},
        {"message": {"content": ""}, "done": True, "eval_count": 7, "eval_duration": 2_000_000_000},
    )
    client = client_for(lambda r: httpx.Response(200, content=payload))
    chunks = await collect(client)
    assert "".join(c.content for c in chunks) == "Hello"
    assert chunks[-1].done is True
    assert chunks[-1].eval_count == 7
    assert chunks[-1].eval_seconds == 2.0
    await client.aclose()


async def test_thinking_is_kept_separate_from_content():
    payload = ndjson({"message": {"thinking": "hmm", "content": ""}, "done": False})
    client = client_for(lambda r: httpx.Response(200, content=payload))
    chunks = await collect(client)
    assert chunks[0].thinking == "hmm"
    assert chunks[0].content == ""
    await client.aclose()


async def test_blank_and_malformed_lines_are_skipped():
    payload = b'\n\nnot json\n' + ndjson({"message": {"content": "ok"}, "done": True})
    client = client_for(lambda r: httpx.Response(200, content=payload))
    assert "".join(c.content for c in await collect(client)) == "ok"
    await client.aclose()


async def test_missing_model_suggests_a_pull():
    client = client_for(lambda r: httpx.Response(404, json={"error": "model not found"}))
    with pytest.raises(OllamaError, match="ollama pull m"):
        await collect(client)
    await client.aclose()


async def test_mid_stream_error_object_is_raised():
    payload = ndjson({"message": {"content": "partial"}}, {"error": "out of memory"})
    client = client_for(lambda r: httpx.Response(200, content=payload))
    with pytest.raises(OllamaError, match="out of memory"):
        await collect(client)
    await client.aclose()


async def test_options_are_sent_and_think_is_omitted_by_default():
    seen: dict = {}

    def handler(request):
        seen.update(json.loads(request.content))
        return httpx.Response(200, content=ndjson({"message": {"content": "x"}, "done": True}))

    client = client_for(handler)
    await collect(client, temperature=0.25, num_ctx=4096)
    assert seen["options"] == {"temperature": 0.25, "num_ctx": 4096}
    assert seen["stream"] is True
    assert "think" not in seen
    await client.aclose()


async def test_think_is_sent_when_requested():
    seen: dict = {}

    def handler(request):
        seen.update(json.loads(request.content))
        return httpx.Response(200, content=ndjson({"message": {"content": "x"}, "done": True}))

    client = client_for(handler)
    await collect(client, think=True)
    assert seen["think"] is True
    await client.aclose()


@pytest.mark.parametrize(
    "info,expected",
    [
        ({"details": {"families": ["gemma3", "clip"]}}, True),
        ({"capabilities": ["completion", "vision"]}, True),
        ({"details": {"families": ["qwen3"]}, "capabilities": ["completion"]}, False),
        ({}, False),
    ],
)
async def test_vision_detection(info, expected):
    client = client_for(lambda r: httpx.Response(200, json=info))
    assert await client.supports_vision("m") is expected
    await client.aclose()


async def test_vision_detection_is_false_when_show_fails():
    client = client_for(lambda r: httpx.Response(500, text="boom"))
    assert await client.supports_vision("m") is False
    await client.aclose()
