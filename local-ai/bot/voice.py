"""Optional speech-to-text for Telegram voice notes.

Uses whichever transcriber is on PATH, preferring MLX Whisper because it runs
on the Mac's GPU. If nothing is installed the bot still works -- it just tells
you voice is unavailable instead of crashing.
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import tempfile
from pathlib import Path

log = logging.getLogger("local-ai.voice")


class VoiceUnavailable(RuntimeError):
    pass


def available_backend() -> str | None:
    for command in ("mlx_whisper", "whisper"):
        if shutil.which(command):
            return command
    return None


def _first_transcript(directory: Path) -> str:
    for path in sorted(directory.glob("*.txt")):
        text = path.read_text(encoding="utf-8", errors="replace").strip()
        if text:
            return text
    return ""


async def transcribe(audio: bytes, suffix: str = ".ogg", model: str = "") -> str:
    """Transcribe ``audio`` bytes to text. Raises :class:`VoiceUnavailable`."""
    backend = available_backend()
    if backend is None:
        raise VoiceUnavailable(
            "no transcriber installed. Run: uv tool install mlx-whisper "
            "(and brew install ffmpeg)"
        )
    if not shutil.which("ffmpeg"):
        raise VoiceUnavailable("ffmpeg is not installed. Run: brew install ffmpeg")

    with tempfile.TemporaryDirectory(prefix="local-ai-voice-") as tmp:
        tmpdir = Path(tmp)
        source = tmpdir / f"note{suffix}"
        source.write_bytes(audio)

        command = [backend, str(source), "--output-dir", str(tmpdir), "--output-format", "txt"]
        if model:
            command += ["--model", model]

        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await process.communicate()
        if process.returncode != 0:
            detail = stderr.decode("utf-8", "replace").strip().splitlines()
            tail = detail[-1] if detail else f"exit code {process.returncode}"
            raise VoiceUnavailable(f"{backend} failed: {tail}")

        text = _first_transcript(tmpdir)

    if not text:
        raise VoiceUnavailable("transcription came back empty")
    return text
