"""Turn model output into something Telegram will actually render.

Telegram's MarkdownV2 requires escaping a dozen punctuation characters and
rejects the whole message if one of them slips through -- which a language
model will do constantly. HTML mode has a tiny tag set and forgiving rules, so
we convert Markdown to that instead and fall back to plain text if anything
looks off.
"""

from __future__ import annotations

import html
import re

TELEGRAM_LIMIT = 4096
# Leave headroom so a chunk plus a re-opened code fence still fits.
CHUNK_LIMIT = 3800

_FENCE_RE = re.compile(r"```([^\n`]*)\n?(.*?)(?:```|\Z)", re.DOTALL)
_INLINE_CODE_RE = re.compile(r"`([^`\n]+)`")
_BOLD_RE = re.compile(r"(?<!\w)(\*\*|__)(?=\S)(.+?)(?<=\S)\1", re.DOTALL)
_ITALIC_RE = re.compile(r"(?<![\w*_])([*_])(?=[^\s*_])(.+?)(?<=[^\s*_])\1(?![\w*_])", re.DOTALL)
_STRIKE_RE = re.compile(r"~~(?=\S)(.+?)(?<=\S)~~", re.DOTALL)
_LINK_RE = re.compile(r"\[([^\]\n]+)\]\(([^)\s]+)\)")
_HEADING_RE = re.compile(r"^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$", re.MULTILINE)
_THINK_RE = re.compile(r"<think>.*?(?:</think>|\Z)", re.DOTALL | re.IGNORECASE)

_PLACEHOLDER = "\x00BLOCK{}\x00"


def strip_thinking(text: str) -> str:
    """Remove ``<think>...</think>`` spans emitted by reasoning models."""
    return _THINK_RE.sub("", text)


def count_open_fences(text: str) -> int:
    return text.count("```")


def close_open_fence(text: str) -> str:
    """Close a trailing unterminated code fence so partial streams still render."""
    if count_open_fences(text) % 2 == 1:
        suffix = "\n```" if not text.endswith("\n") else "```"
        return text + suffix
    return text


def _safe_url(url: str) -> str | None:
    lowered = url.strip().lower()
    if lowered.startswith(("http://", "https://", "tg://", "mailto:")):
        return html.escape(url.strip(), quote=True)
    return None


def markdown_to_html(text: str) -> str:
    """Convert a useful subset of Markdown into Telegram-flavoured HTML."""
    blocks: list[str] = []

    def stash(rendered: str) -> str:
        blocks.append(rendered)
        return _PLACEHOLDER.format(len(blocks) - 1)

    def fence_sub(match: re.Match[str]) -> str:
        language = match.group(1).strip()
        body = html.escape(match.group(2))
        if language and re.fullmatch(r"[\w+#.-]+", language):
            opening = f'<pre><code class="language-{html.escape(language, quote=True)}">'
        else:
            opening = "<pre><code>"
        return stash(f"{opening}{body}</code></pre>")

    text = _FENCE_RE.sub(fence_sub, text)
    text = _INLINE_CODE_RE.sub(lambda m: stash(f"<code>{html.escape(m.group(1))}</code>"), text)

    text = html.escape(text)

    text = _HEADING_RE.sub(lambda m: f"<b>{m.group(2)}</b>", text)
    text = _BOLD_RE.sub(lambda m: f"<b>{m.group(2)}</b>", text)
    text = _ITALIC_RE.sub(lambda m: f"<i>{m.group(2)}</i>", text)
    text = _STRIKE_RE.sub(lambda m: f"<s>{m.group(1)}</s>", text)

    def link_sub(match: re.Match[str]) -> str:
        url = _safe_url(html.unescape(match.group(2)))
        if url is None:
            return match.group(0)
        return f'<a href="{url}">{match.group(1)}</a>'

    text = _LINK_RE.sub(link_sub, text)

    for index, rendered in enumerate(blocks):
        text = text.replace(_PLACEHOLDER.format(index), rendered)
    return text


def _find_cut(text: str, limit: int) -> int:
    """Pick the nicest place to break ``text`` at or before ``limit`` characters."""
    window = text[:limit]
    for candidate in (window.rfind("\n\n"), window.rfind("\n"), window.rfind(" ")):
        if candidate >= limit // 3:
            return candidate
    return limit


def open_fence_language(text: str) -> str | None:
    """Return the language of an unterminated code fence, or ``None`` if balanced.

    An unterminated fence with no language yields ``""``, which is falsy but not
    ``None`` -- callers must test against ``None`` explicitly.
    """
    fences = re.findall(r"```([^\n`]*)", text)
    if len(fences) % 2 == 0:
        return None
    return fences[-1].strip()


def split_once(text: str, limit: int = CHUNK_LIMIT) -> tuple[str, str]:
    """Split ``text`` into a sendable head and the remaining tail.

    The head is closed off if the cut lands inside a fenced code block, and the
    tail re-opens that fence so both halves render on their own. Returns
    ``(text, "")`` when no split is needed.
    """
    if len(text) <= limit:
        return text, ""

    cut = _find_cut(text, limit)
    head, tail = text[:cut], text[cut:].lstrip("\n")
    language = open_fence_language(head)
    if language is not None:
        head = head.rstrip() + "\n```"
        tail = f"```{language}\n{tail}" if language else f"```\n{tail}"
    return head, tail


def split_markdown(text: str, limit: int = CHUNK_LIMIT) -> list[str]:
    """Split Markdown into chunks under ``limit``, keeping code fences balanced."""
    if not text:
        return [""]

    chunks: list[str] = []
    remaining = text
    while True:
        head, remaining = split_once(remaining, limit)
        chunks.append(head)
        if not remaining:
            break
    return [c for c in chunks if c.strip()] or [""]


def render_chunks(text: str, limit: int = CHUNK_LIMIT) -> list[tuple[str, str]]:
    """Return ``(html, plain)`` pairs ready to hand to the Telegram API."""
    result: list[tuple[str, str]] = []
    for chunk in split_markdown(text, limit):
        result.append((markdown_to_html(chunk), chunk))
    return result


def truncate(text: str, limit: int = TELEGRAM_LIMIT) -> str:
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"
