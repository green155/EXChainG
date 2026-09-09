"""Minimal async Telegram Bot API client (long polling).

Deliberately small: the bot needs a dozen methods, and hand-rolling them keeps
the dependency list at ``httpx`` alone and the failure modes visible.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

log = logging.getLogger("local-ai.telegram")


class TelegramError(RuntimeError):
    def __init__(self, method: str, description: str, error_code: int | None = None) -> None:
        super().__init__(f"{method} failed: {description}")
        self.method = method
        self.description = description
        self.error_code = error_code

    @property
    def is_not_modified(self) -> bool:
        return "message is not modified" in self.description.lower()

    @property
    def is_rate_limited(self) -> bool:
        return self.error_code == 429


class TelegramClient:
    def __init__(self, token: str, timeout: float = 90.0) -> None:
        self._token = token
        self._base = f"https://api.telegram.org/bot{token}"
        self._file_base = f"https://api.telegram.org/file/bot{token}"
        self._client = httpx.AsyncClient(timeout=timeout)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def call(self, method: str, **params: Any) -> Any:
        payload = {k: v for k, v in params.items() if v is not None}
        for attempt in range(4):
            try:
                response = await self._client.post(f"{self._base}/{method}", json=payload)
            except httpx.HTTPError as exc:
                if attempt == 3:
                    raise TelegramError(method, f"network error: {exc}") from exc
                await asyncio.sleep(2**attempt)
                continue

            data = response.json()
            if data.get("ok"):
                return data.get("result")

            description = str(data.get("description", "unknown error"))
            error_code = data.get("error_code")
            if error_code == 429:
                retry_after = int((data.get("parameters") or {}).get("retry_after", 3))
                log.warning("rate limited by Telegram, sleeping %ss", retry_after)
                await asyncio.sleep(retry_after + 0.5)
                continue
            raise TelegramError(method, description, error_code)
        raise TelegramError(method, "gave up after repeated failures")

    # -- updates -----------------------------------------------------------

    async def get_me(self) -> dict:
        return await self.call("getMe")

    async def get_updates(self, offset: int | None, timeout: int) -> list[dict]:
        return await self.call(
            "getUpdates",
            offset=offset,
            timeout=timeout,
            allowed_updates=["message", "edited_message"],
        )

    async def delete_webhook(self) -> None:
        """Long polling and webhooks are mutually exclusive; make sure we win."""
        try:
            await self.call("deleteWebhook", drop_pending_updates=False)
        except TelegramError as exc:
            log.debug("deleteWebhook: %s", exc)

    # -- messages ----------------------------------------------------------

    async def send_message(
        self,
        chat_id: int,
        text: str,
        *,
        parse_mode: str | None = None,
        reply_to: int | None = None,
        disable_preview: bool = True,
    ) -> dict:
        return await self.call(
            "sendMessage",
            chat_id=chat_id,
            text=text,
            parse_mode=parse_mode,
            reply_to_message_id=reply_to,
            link_preview_options={"is_disabled": True} if disable_preview else None,
        )

    async def edit_message(
        self,
        chat_id: int,
        message_id: int,
        text: str,
        *,
        parse_mode: str | None = None,
        disable_preview: bool = True,
    ) -> dict | None:
        try:
            return await self.call(
                "editMessageText",
                chat_id=chat_id,
                message_id=message_id,
                text=text,
                parse_mode=parse_mode,
                link_preview_options={"is_disabled": True} if disable_preview else None,
            )
        except TelegramError as exc:
            if exc.is_not_modified:
                return None
            raise

    async def send_chat_action(self, chat_id: int, action: str = "typing") -> None:
        try:
            await self.call("sendChatAction", chat_id=chat_id, action=action)
        except TelegramError as exc:
            log.debug("sendChatAction: %s", exc)

    async def set_my_commands(self, commands: list[dict]) -> None:
        try:
            await self.call("setMyCommands", commands=commands)
        except TelegramError as exc:
            log.warning("could not register commands: %s", exc)

    # -- files -------------------------------------------------------------

    async def download_file(self, file_id: str, max_bytes: int) -> bytes:
        info = await self.call("getFile", file_id=file_id)
        size = int(info.get("file_size") or 0)
        if size > max_bytes:
            raise TelegramError("getFile", f"file is {size // 1024}KB, over the configured limit")
        path = info.get("file_path")
        if not path:
            raise TelegramError("getFile", "Telegram returned no file path")
        response = await self._client.get(f"{self._file_base}/{path}")
        response.raise_for_status()
        return response.content
