"""The renderer is what stands between model output and a Telegram 400."""

from __future__ import annotations

import re

import pytest

from bot.render import (
    CHUNK_LIMIT,
    close_open_fence,
    markdown_to_html,
    open_fence_language,
    render_chunks,
    split_markdown,
    split_once,
    strip_thinking,
    truncate,
)


def test_plain_text_is_escaped_not_mangled():
    assert markdown_to_html("5 < 6 & 7 > 2") == "5 &lt; 6 &amp; 7 &gt; 2"


def test_bold_italic_and_strike():
    assert markdown_to_html("**bold**") == "<b>bold</b>"
    assert markdown_to_html("*italic*") == "<i>italic</i>"
    assert markdown_to_html("_italic_") == "<i>italic</i>"
    assert markdown_to_html("~~gone~~") == "<s>gone</s>"


def test_snake_case_is_not_italicised():
    # A bare identifier must survive: this is the classic MarkdownV2 failure.
    assert markdown_to_html("call some_function_name now") == "call some_function_name now"


def test_inline_code_contents_are_escaped_and_untouched_by_emphasis():
    assert markdown_to_html("`a < b **not bold**`") == "<code>a &lt; b **not bold**</code>"


def test_fenced_block_keeps_language_and_escapes_body():
    html = markdown_to_html('```python\nif a < b:\n    print("hi")\n```')
    assert html.startswith('<pre><code class="language-python">')
    assert "a &lt; b" in html
    assert '&quot;hi&quot;' in html or '"hi"' in html


def test_fenced_block_without_language():
    assert markdown_to_html("```\nraw\n```") == "<pre><code>raw\n</code></pre>"


def test_headings_become_bold():
    assert markdown_to_html("## Title") == "<b>Title</b>"


def test_links_are_rendered_and_javascript_urls_are_not():
    assert markdown_to_html("[docs](https://x.dev)") == '<a href="https://x.dev">docs</a>'
    assert "<a" not in markdown_to_html("[x](javascript:alert(1))")


def test_html_in_model_output_cannot_inject_tags():
    html = markdown_to_html("<script>alert(1)</script>")
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_strip_thinking_removes_scratchpad():
    assert strip_thinking("<think>hmm</think>answer") == "answer"
    assert strip_thinking("<think>unterminated") == ""


def test_close_open_fence_only_when_unbalanced():
    assert close_open_fence("```py\nx = 1") == "```py\nx = 1\n```"
    assert close_open_fence("```py\nx = 1\n```") == "```py\nx = 1\n```"


def test_open_fence_language_distinguishes_none_from_empty():
    assert open_fence_language("```python\nx") == "python"
    assert open_fence_language("```\nx") == ""
    assert open_fence_language("```\nx\n```") is None


def test_short_text_is_not_split():
    assert split_markdown("hello") == ["hello"]


def test_split_respects_the_limit():
    text = "\n\n".join(f"Paragraph number {i}." for i in range(400))
    chunks = split_markdown(text)
    assert len(chunks) > 1
    assert all(len(chunk) <= CHUNK_LIMIT + 8 for chunk in chunks)


def test_split_keeps_every_fence_balanced():
    body = "\n".join(f"line_{i} = {i}" for i in range(1200))
    chunks = split_markdown(f"before\n\n```python\n{body}\n```\n\nafter")
    assert len(chunks) > 1
    for chunk in chunks:
        assert chunk.count("```") % 2 == 0, chunk[:120]


def test_split_reopens_the_fence_with_its_language():
    body = "\n".join(f"x{i} = {i}" for i in range(1200))
    chunks = split_markdown(f"```python\n{body}\n```")
    assert chunks[1].startswith("```python\n")


def test_split_once_returns_empty_tail_when_it_fits():
    head, tail = split_once("short", 100)
    assert (head, tail) == ("short", "")


def test_split_terminates_on_text_with_no_break_points():
    chunks = split_markdown("x" * (CHUNK_LIMIT * 3))
    assert len(chunks) >= 3
    assert "".join(chunks) == "x" * (CHUNK_LIMIT * 3)


def test_render_chunks_pairs_html_with_source():
    pairs = render_chunks("**hi**")
    assert pairs == [("<b>hi</b>", "**hi**")]


def test_every_chunk_of_a_long_reply_survives_html_conversion():
    text = ("Some **bold** text with `code` and <angles>.\n\n" * 300)
    for chunk in split_markdown(text):
        html = markdown_to_html(chunk)
        # No stray placeholder leaked through, and tags are balanced.
        assert "\x00" not in html
        assert html.count("<b>") == html.count("</b>")


@pytest.mark.parametrize("bad", ["*", "**", "`", "```", "~~", "[", "]()", "_ _"])
def test_degenerate_markdown_does_not_raise(bad):
    assert isinstance(markdown_to_html(bad), str)


def test_truncate_adds_an_ellipsis_and_respects_the_limit():
    assert truncate("abcdef", 4) == "abc…"
    assert truncate("abc", 10) == "abc"


def test_no_unescaped_ampersand_escapes_the_renderer():
    html = markdown_to_html("Tom & Jerry <b>fake</b>")
    assert re.search(r"&(?!amp;|lt;|gt;|quot;|#)", html) is None
