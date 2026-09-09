from __future__ import annotations

import pytest

from bot.store import Store


@pytest.fixture
def store(tmp_path):
    store = Store(tmp_path / "nested" / "bot.db")
    yield store
    store.close()


def test_database_is_created_with_its_parent_directory(tmp_path):
    store = Store(tmp_path / "a" / "b" / "bot.db")
    assert (tmp_path / "a" / "b" / "bot.db").exists()
    store.close()


def test_unknown_chat_has_empty_defaults(store):
    settings = store.get_settings(999)
    assert settings.model is None
    assert settings.system_prompt is None
    assert settings.temperature is None


def test_settings_round_trip_and_merge(store):
    store.update_settings(1, model="qwen3:8b")
    store.update_settings(1, temperature=0.2)
    settings = store.get_settings(1)
    assert settings.model == "qwen3:8b"
    assert settings.temperature == 0.2


def test_settings_can_be_cleared(store):
    store.update_settings(1, system_prompt="be terse")
    store.update_settings(1, system_prompt=None)
    assert store.get_settings(1).system_prompt is None


def test_unknown_setting_is_rejected(store):
    with pytest.raises(ValueError, match="unknown chat setting"):
        store.update_settings(1, nonsense="x")


def test_history_is_oldest_first(store):
    for index in range(4):
        store.add_message(1, "user" if index % 2 == 0 else "assistant", f"m{index}")
    history = store.history(1, turns=10, max_chars=10_000)
    assert [m["content"] for m in history] == ["m0", "m1", "m2", "m3"]


def test_history_is_scoped_per_chat(store):
    store.add_message(1, "user", "mine")
    store.add_message(2, "user", "theirs")
    assert [m["content"] for m in store.history(1, 10, 10_000)] == ["mine"]


def test_history_respects_the_turn_limit(store):
    for index in range(20):
        store.add_message(1, "user", f"m{index}")
    history = store.history(1, turns=5, max_chars=10_000)
    assert [m["content"] for m in history] == [f"m{i}" for i in range(15, 20)]


def test_history_respects_the_character_budget(store):
    store.add_message(1, "user", "x" * 500)
    store.add_message(1, "user", "y" * 500)
    store.add_message(1, "user", "z" * 500)
    history = store.history(1, turns=10, max_chars=600)
    assert len(history) == 1
    assert history[0]["content"].startswith("z")


def test_a_single_oversized_message_is_still_returned(store):
    store.add_message(1, "user", "x" * 5000)
    assert len(store.history(1, turns=10, max_chars=100)) == 1


def test_history_never_opens_on_an_assistant_turn(store):
    store.add_message(1, "assistant", "a" * 400)
    store.add_message(1, "user", "b" * 400)
    store.add_message(1, "assistant", "c" * 400)
    history = store.history(1, turns=10, max_chars=10_000)
    assert history[0]["role"] == "user"


def test_images_survive_the_round_trip(store):
    store.add_message(1, "user", "look", images=["ZmFrZQ=="])
    assert store.history(1, 10, 10_000)[0]["images"] == ["ZmFrZQ=="]


def test_messages_without_images_have_no_images_key(store):
    store.add_message(1, "user", "hi")
    assert "images" not in store.history(1, 10, 10_000)[0]


def test_clear_history_reports_and_empties(store):
    store.add_message(1, "user", "a")
    store.add_message(1, "user", "b")
    assert store.clear_history(1) == 2
    assert store.history(1, 10, 10_000) == []
    assert store.message_count(1) == 0


def test_stats_accumulate(store):
    store.record_reply(1, 100, 2.0)
    store.record_reply(1, 50, 1.0)
    stats = store.get_stats(1)
    assert stats == {"replies": 2, "eval_tokens": 150, "eval_seconds": 3.0}


def test_stats_for_an_unseen_chat_are_zero(store):
    assert store.get_stats(7)["replies"] == 0


def test_state_survives_reopening(tmp_path):
    path = tmp_path / "bot.db"
    first = Store(path)
    first.update_settings(1, model="qwen3:14b")
    first.add_message(1, "user", "remember me")
    first.close()

    second = Store(path)
    assert second.get_settings(1).model == "qwen3:14b"
    assert second.history(1, 10, 10_000)[0]["content"] == "remember me"
    second.close()
