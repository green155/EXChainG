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


# -- username allowlist ------------------------------------------------------


def test_usernames_are_normalised():
    from bot.config import parse_usernames

    assert parse_usernames("@Mac_Owner, other_name") == {"mac_owner", "other_name"}


def test_empty_username_list_is_empty():
    from bot.config import parse_usernames

    assert parse_usernames("") == set()


@pytest.mark.parametrize("bad", ["ab", "has spaces!", "with-dash", "x" * 33])
def test_invalid_usernames_are_rejected(bad):
    from bot.config import parse_usernames

    with pytest.raises(ConfigError):
        parse_usernames(bad)


def test_a_username_grants_access_case_insensitively():
    config = Config(telegram_token="1:abc", allowed_usernames={"mac_owner"})
    assert config.is_allowed(999, "Mac_Owner")
    assert config.is_allowed(999, "@mac_owner")


def test_a_username_alone_is_not_enough_for_a_different_name():
    config = Config(telegram_token="1:abc", allowed_usernames={"mac_owner"})
    assert not config.is_allowed(999, "someone_else")


def test_a_numeric_id_works_without_a_username():
    config = Config(telegram_token="1:abc", allowed_user_ids={7})
    assert config.is_allowed(7, None)


def test_a_user_with_no_username_is_not_admitted_by_the_name_list():
    config = Config(telegram_token="1:abc", allowed_usernames={"mac_owner"})
    assert not config.is_allowed(999, None)


def test_has_allowlist_reflects_either_list():
    assert not Config(telegram_token="1:abc").has_allowlist
    assert Config(telegram_token="1:abc", allowed_user_ids={1}).has_allowlist
    assert Config(telegram_token="1:abc", allowed_usernames={"a_name"}).has_allowlist


def test_usernames_load_from_the_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "1:abc")
    monkeypatch.setenv("TELEGRAM_ALLOWED_USERNAMES", "@Mac_Owner")
    assert load_config(env_file=tmp_path / "absent").allowed_usernames == {"mac_owner"}


def test_a_username_in_the_id_list_is_explained(tmp_path, monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "1:abc")
    monkeypatch.setenv("TELEGRAM_ALLOWED_USER_IDS", "@mac_owner")
    with pytest.raises(ConfigError, match="TELEGRAM_ALLOWED_USERNAMES"):
        load_config(env_file=tmp_path / "absent")
