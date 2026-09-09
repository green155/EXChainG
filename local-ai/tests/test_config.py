from __future__ import annotations

import pytest

from bot.config import Config, ConfigError, load_config, load_env_file, parse_user_ids


def write_env(tmp_path, body: str):
    path = tmp_path / ".env"
    path.write_text(body, encoding="utf-8")
    return path


def test_env_file_parsing_handles_quotes_comments_and_export(tmp_path):
    path = write_env(
        tmp_path,
        """
        # a comment
        export TELEGRAM_BOT_TOKEN="123:abc"
        LOCAL_AI_MODEL=qwen3:8b   # trailing comment
        EMPTY=
        QUOTED='keep # this'
        not a pair
        """.replace("        ", ""),
    )
    values = load_env_file(path)
    assert values["TELEGRAM_BOT_TOKEN"] == "123:abc"
    assert values["LOCAL_AI_MODEL"] == "qwen3:8b"
    assert values["EMPTY"] == ""
    assert values["QUOTED"] == "keep # this"
    assert "not a pair" not in values


def test_missing_env_file_is_not_an_error(tmp_path):
    assert load_env_file(tmp_path / "nope") == {}


def test_parse_user_ids_accepts_commas_and_spaces():
    assert parse_user_ids("1, 2  3") == {1, 2, 3}
    assert parse_user_ids("") == set()


def test_parse_user_ids_rejects_usernames():
    with pytest.raises(ConfigError):
        parse_user_ids("@someone")


def test_missing_token_is_a_config_error(tmp_path, monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    with pytest.raises(ConfigError, match="TELEGRAM_BOT_TOKEN"):
        load_config(env_file=tmp_path / "absent")


def test_placeholder_token_is_rejected(tmp_path, monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "REPLACE_ME")
    with pytest.raises(ConfigError, match="placeholder"):
        load_config(env_file=tmp_path / "absent")


def test_real_environment_wins_over_the_env_file(tmp_path, monkeypatch):
    path = write_env(tmp_path, "TELEGRAM_BOT_TOKEN=from-file\nLOCAL_AI_MODEL=from-file\n")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "from-shell")
    monkeypatch.delenv("LOCAL_AI_MODEL", raising=False)
    config = load_config(env_file=path)
    assert config.telegram_token == "from-shell"
    assert config.default_model == "from-file"


def test_bare_host_gets_a_scheme(tmp_path, monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "1:abc")
    monkeypatch.setenv("OLLAMA_HOST", "127.0.0.1:11434")
    assert load_config(env_file=tmp_path / "absent").ollama_host == "http://127.0.0.1:11434"


def test_trailing_slash_is_trimmed(tmp_path, monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "1:abc")
    monkeypatch.setenv("OLLAMA_HOST", "http://localhost:11434/")
    assert load_config(env_file=tmp_path / "absent").ollama_host == "http://localhost:11434"


def test_non_numeric_tuning_value_is_reported(tmp_path, monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "1:abc")
    monkeypatch.setenv("LOCAL_AI_NUM_CTX", "lots")
    with pytest.raises(ConfigError, match="LOCAL_AI_NUM_CTX"):
        load_config(env_file=tmp_path / "absent")


def test_empty_allowlist_denies_everyone():
    config = Config(telegram_token="1:abc")
    assert not config.is_allowed(42)


def test_allowlist_admits_only_listed_ids():
    config = Config(telegram_token="1:abc", allowed_user_ids={42})
    assert config.is_allowed(42)
    assert not config.is_allowed(43)
