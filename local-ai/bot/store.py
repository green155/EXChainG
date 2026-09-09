"""SQLite-backed conversation state.

One file under ``~/.local/share/local-ai/bot.db`` holds per-chat settings and
message history, so restarting the bot (or rebooting the Mac) does not wipe a
conversation.
"""

from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS chats (
    chat_id       INTEGER PRIMARY KEY,
    model         TEXT,
    system_prompt TEXT,
    temperature   REAL,
    updated_at    REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id    INTEGER NOT NULL,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    images     TEXT,
    created_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS messages_chat_idx ON messages (chat_id, id);

CREATE TABLE IF NOT EXISTS stats (
    chat_id      INTEGER PRIMARY KEY,
    replies      INTEGER NOT NULL DEFAULT 0,
    eval_tokens  INTEGER NOT NULL DEFAULT 0,
    eval_seconds REAL    NOT NULL DEFAULT 0
);
"""


@dataclass(slots=True)
class ChatSettings:
    chat_id: int
    model: str | None = None
    system_prompt: str | None = None
    temperature: float | None = None


class Store:
    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    # -- per-chat settings -------------------------------------------------

    def get_settings(self, chat_id: int) -> ChatSettings:
        row = self.conn.execute(
            "SELECT chat_id, model, system_prompt, temperature FROM chats WHERE chat_id = ?",
            (chat_id,),
        ).fetchone()
        if row is None:
            return ChatSettings(chat_id=chat_id)
        return ChatSettings(
            chat_id=row["chat_id"],
            model=row["model"],
            system_prompt=row["system_prompt"],
            temperature=row["temperature"],
        )

    def update_settings(self, chat_id: int, **fields: object) -> None:
        allowed = {"model", "system_prompt", "temperature"}
        unknown = set(fields) - allowed
        if unknown:
            raise ValueError(f"unknown chat setting(s): {sorted(unknown)}")
        current = self.get_settings(chat_id)
        merged = {
            "model": current.model,
            "system_prompt": current.system_prompt,
            "temperature": current.temperature,
        }
        merged.update(fields)
        self.conn.execute(
            """
            INSERT INTO chats (chat_id, model, system_prompt, temperature, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(chat_id) DO UPDATE SET
                model = excluded.model,
                system_prompt = excluded.system_prompt,
                temperature = excluded.temperature,
                updated_at = excluded.updated_at
            """,
            (
                chat_id,
                merged["model"],
                merged["system_prompt"],
                merged["temperature"],
                time.time(),
            ),
        )
        self.conn.commit()

    # -- history -----------------------------------------------------------

    def add_message(
        self,
        chat_id: int,
        role: str,
        content: str,
        images: list[str] | None = None,
    ) -> None:
        self.conn.execute(
            "INSERT INTO messages (chat_id, role, content, images, created_at) VALUES (?, ?, ?, ?, ?)",
            (chat_id, role, content, json.dumps(images) if images else None, time.time()),
        )
        self.conn.commit()

    def history(self, chat_id: int, turns: int, max_chars: int) -> list[dict]:
        """Return the most recent messages, newest-last, within both budgets.

        ``turns`` counts messages, ``max_chars`` approximates a token budget so
        a long conversation degrades into a sliding window instead of blowing
        past the model's context.
        """
        rows = self.conn.execute(
            "SELECT role, content, images FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?",
            (chat_id, max(turns, 1)),
        ).fetchall()

        selected: list[dict] = []
        budget = max_chars
        for row in rows:
            cost = len(row["content"])
            if selected and cost > budget:
                break
            budget -= cost
            message: dict = {"role": row["role"], "content": row["content"]}
            if row["images"]:
                message["images"] = json.loads(row["images"])
            selected.append(message)

        selected.reverse()
        # Never open the window on an assistant turn -- some models choke on it.
        while selected and selected[0]["role"] == "assistant":
            selected.pop(0)
        return selected

    def clear_history(self, chat_id: int) -> int:
        cursor = self.conn.execute("DELETE FROM messages WHERE chat_id = ?", (chat_id,))
        self.conn.commit()
        return cursor.rowcount

    def message_count(self, chat_id: int) -> int:
        row = self.conn.execute(
            "SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?", (chat_id,)
        ).fetchone()
        return int(row["n"])

    # -- stats -------------------------------------------------------------

    def record_reply(self, chat_id: int, eval_tokens: int, eval_seconds: float) -> None:
        self.conn.execute(
            """
            INSERT INTO stats (chat_id, replies, eval_tokens, eval_seconds)
            VALUES (?, 1, ?, ?)
            ON CONFLICT(chat_id) DO UPDATE SET
                replies = replies + 1,
                eval_tokens = eval_tokens + excluded.eval_tokens,
                eval_seconds = eval_seconds + excluded.eval_seconds
            """,
            (chat_id, eval_tokens, eval_seconds),
        )
        self.conn.commit()

    def get_stats(self, chat_id: int) -> dict:
        row = self.conn.execute(
            "SELECT replies, eval_tokens, eval_seconds FROM stats WHERE chat_id = ?",
            (chat_id,),
        ).fetchone()
        if row is None:
            return {"replies": 0, "eval_tokens": 0, "eval_seconds": 0.0}
        return {
            "replies": row["replies"],
            "eval_tokens": row["eval_tokens"],
            "eval_seconds": row["eval_seconds"],
        }
