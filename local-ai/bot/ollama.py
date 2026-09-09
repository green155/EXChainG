"""Thin async client for the Ollama HTTP API.

Only the handful of endpoints the bot needs, so there is no SDK version to keep
up with. Streaming uses Ollama's newline-delimited JSON responses.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import AsyncIterator

import httpx


class OllamaError(RuntimeError):
    pass


@dataclass(slots=True)
class Chunk:
    """One streamed piece of a chat response."""

    content: str = ""
    thinking: str = ""
    done: bool = False
    eval_count: int = 0
    eval_duration_ns: int = 0
    prompt_eval_count: int = 0

    @property
    def eval_seconds(self) -> float:
        return self.eval_duration_ns / 1e9


class OllamaClient:
    def __init__(
        self,
        host: str,
        timeout: float = 600.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.host = host.rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=self.host, timeout=timeout, transport=transport
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def version(self) -> str:
        try:
            response = await self._client.get("/api/version", timeout=10.0)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise OllamaError(f"cannot reach Ollama at {self.host}: {exc}") from exc
        return str(response.json().get("version", "unknown"))

    async def list_models(self) -> list[dict]:
        try:
            response = await self._client.get("/api/tags", timeout=30.0)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise OllamaError(f"cannot list models: {exc}") from exc
        return list(response.json().get("models", []))

    async def model_names(self) -> list[str]:
        return sorted(str(m.get("name", "")) for m in await self.list_models() if m.get("name"))

    async def show(self, model: str) -> dict:
        try:
            response = await self._client.post("/api/show", json={"model": model}, timeout=30.0)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise OllamaError(f"cannot inspect {model}: {exc}") from exc
        return dict(response.json())

    async def supports_vision(self, model: str) -> bool:
        """Best-effort check for image input support."""
        try:
            info = await self.show(model)
        except OllamaError:
            return False
        families = info.get("details", {}).get("families") or []
        capabilities = info.get("capabilities") or []
        blob = " ".join(str(x) for x in [*families, *capabilities]).lower()
        return "vision" in blob or "clip" in blob or "mllama" in blob

    async def chat(
        self,
        model: str,
        messages: list[dict],
        *,
        temperature: float = 0.7,
        num_ctx: int = 8192,
        think: bool | None = None,
    ) -> AsyncIterator[Chunk]:
        """Stream a chat completion, yielding :class:`Chunk` objects."""
        payload: dict = {
            "model": model,
            "messages": messages,
            "stream": True,
            "options": {"temperature": temperature, "num_ctx": num_ctx},
        }
        if think is not None:
            payload["think"] = think

        try:
            async with self._client.stream("POST", "/api/chat", json=payload) as response:
                if response.status_code >= 400:
                    body = (await response.aread()).decode("utf-8", "replace")
                    raise OllamaError(_explain_http_error(response.status_code, body, model))
                async for line in response.aiter_lines():
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if "error" in data:
                        raise OllamaError(str(data["error"]))
                    message = data.get("message") or {}
                    yield Chunk(
                        content=message.get("content", "") or "",
                        thinking=message.get("thinking", "") or "",
                        done=bool(data.get("done")),
                        eval_count=int(data.get("eval_count") or 0),
                        eval_duration_ns=int(data.get("eval_duration") or 0),
                        prompt_eval_count=int(data.get("prompt_eval_count") or 0),
                    )
        except httpx.HTTPError as exc:
            raise OllamaError(f"Ollama request failed: {exc}") from exc


def _explain_http_error(status: int, body: str, model: str) -> str:
    detail = body.strip()
    try:
        detail = str(json.loads(body).get("error", detail))
    except (json.JSONDecodeError, AttributeError):
        pass
    if status == 404:
        return f"model {model!r} is not installed. Pull it with: ollama pull {model}"
    return f"Ollama returned HTTP {status}: {detail[:400]}"
