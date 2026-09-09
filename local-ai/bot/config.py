"""Configuration loading for the local AI Telegram bridge.

Everything is driven by environment variables, optionally seeded from a
``.env`` file living next to the ``local-ai`` directory. Secrets never live in
this repository -- ``.env`` is git-ignored and read at start-up only.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ENV_FILE = REPO_ROOT / ".env"


class ConfigError(RuntimeError):
    """Raised when the environment is missing something the bot cannot run without."""


def load_env_file(path: Path) -> dict[str, str]:
    """Parse a minimal ``KEY=value`` env file.

    Supports ``#`` comments, blank lines, an optional ``export`` prefix and
    single or double quoted values. Deliberately tiny: this is the only thing
    standing between us and a python-dotenv dependency.
    """
    values: dict[str, str] = {}
    if not path.exists():
        return values

    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        elif "#" in value:
            # Strip trailing inline comments from unquoted values.
            value = value.split("#", 1)[0].strip()
        if key:
            values[key] = value
    return values


def apply_env_file(path: Path = DEFAULT_ENV_FILE) -> None:
    """Load ``path`` into ``os.environ`` without clobbering real env vars."""
    for key, value in load_env_file(path).items():
        os.environ.setdefault(key, value)


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer, got {raw!r}") from exc


def _float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be a number, got {raw!r}") from exc


def parse_user_ids(raw: str) -> set[int]:
    """Parse a comma/space separated allowlist of Telegram numeric user IDs."""
    ids: set[int] = set()
    for chunk in raw.replace(",", " ").split():
        try:
            ids.add(int(chunk))
        except ValueError as exc:
            raise ConfigError(
                "TELEGRAM_ALLOWED_USER_IDS must contain numeric Telegram user IDs, "
                f"got {chunk!r}. If that is a @username, put it in "
                "TELEGRAM_ALLOWED_USERNAMES instead."
            ) from exc
    return ids


def parse_usernames(raw: str) -> set[str]:
    """Parse a comma/space separated allowlist of Telegram @usernames.

    Normalised to lowercase without the leading ``@``, because Telegram treats
    usernames case-insensitively.
    """
    names: set[str] = set()
    for chunk in raw.replace(",", " ").split():
        name = chunk.strip().lstrip("@").lower()
        if not name:
            continue
        if not re.fullmatch(r"[a-z0-9_]{4,32}", name):
            raise ConfigError(
                f"{chunk!r} is not a valid Telegram username (letters, digits "
                "and underscores, 5-32 characters)."
            )
        names.add(name)
    return names


def default_data_dir() -> Path:
    override = os.environ.get("LOCAL_AI_DATA_DIR", "").strip()
    if override:
        return Path(override).expanduser()
    return Path.home() / ".local" / "share" / "local-ai"


@dataclass(slots=True)
class Config:
    telegram_token: str
    allowed_user_ids: set[int] = field(default_factory=set)
    allowed_usernames: set[str] = field(default_factory=set)
    ollama_host: str = "http://127.0.0.1:11434"
    default_model: str = "qwen3:8b"
    vision_model: str = ""
    system_prompt: str = ""
    temperature: float = 0.7
    num_ctx: int = 8192
    history_turns: int = 24
    history_chars: int = 24000
    data_dir: Path = field(default_factory=default_data_dir)
    request_timeout: float = 600.0
    poll_timeout: int = 30
    stream_interval: float = 1.1
    stream_min_chars: int = 48
    show_thinking: bool = False
    voice_enabled: bool = True
    whisper_model: str = "mlx-community/whisper-large-v3-turbo"
    max_file_mb: int = 20

    @property
    def db_path(self) -> Path:
        return self.data_dir / "bot.db"

    @property
    def has_allowlist(self) -> bool:
        return bool(self.allowed_user_ids or self.allowed_usernames)

    def is_allowed(self, user_id: int, username: str | None = None) -> bool:
        """Numeric IDs are the real lock; usernames are a convenience.

        A username can be released and claimed by someone else, so a numeric ID
        is the only identifier that stays pinned to one person.
        """
        if user_id in self.allowed_user_ids:
            return True
        if username and username.lstrip("@").lower() in self.allowed_usernames:
            return True
        return False


def load_config(env_file: Path | None = DEFAULT_ENV_FILE) -> Config:
    if env_file is not None:
        apply_env_file(env_file)

    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        raise ConfigError(
            "TELEGRAM_BOT_TOKEN is not set. Copy local-ai/.env.example to "
            "local-ai/.env and put your @BotFather token in it."
        )
    if token.lower().startswith("your") or token == "REPLACE_ME":
        raise ConfigError("TELEGRAM_BOT_TOKEN still holds the placeholder value.")

    config = Config(
        telegram_token=token,
        allowed_user_ids=parse_user_ids(os.environ.get("TELEGRAM_ALLOWED_USER_IDS", "")),
        allowed_usernames=parse_usernames(os.environ.get("TELEGRAM_ALLOWED_USERNAMES", "")),
        ollama_host=os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").strip().rstrip("/"),
        default_model=os.environ.get("LOCAL_AI_MODEL", "qwen3:8b").strip(),
        vision_model=os.environ.get("LOCAL_AI_VISION_MODEL", "").strip(),
        system_prompt=os.environ.get("LOCAL_AI_SYSTEM_PROMPT", "").strip(),
        temperature=_float("LOCAL_AI_TEMPERATURE", 0.7),
        num_ctx=_int("LOCAL_AI_NUM_CTX", 8192),
        history_turns=_int("LOCAL_AI_HISTORY_TURNS", 24),
        history_chars=_int("LOCAL_AI_HISTORY_CHARS", 24000),
        data_dir=default_data_dir(),
        request_timeout=_float("LOCAL_AI_REQUEST_TIMEOUT", 600.0),
        poll_timeout=_int("TELEGRAM_POLL_TIMEOUT", 30),
        stream_interval=_float("LOCAL_AI_STREAM_INTERVAL", 1.1),
        show_thinking=_bool("LOCAL_AI_SHOW_THINKING", False),
        voice_enabled=_bool("LOCAL_AI_VOICE", True),
        whisper_model=os.environ.get(
            "LOCAL_AI_WHISPER_MODEL", "mlx-community/whisper-large-v3-turbo"
        ).strip(),
        max_file_mb=_int("LOCAL_AI_MAX_FILE_MB", 20),
    )

    if not config.ollama_host.startswith(("http://", "https://")):
        config.ollama_host = f"http://{config.ollama_host}"
    return config
