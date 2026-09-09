"""Entry point: ``python -m bot`` from the ``local-ai`` directory."""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys

from .app import Bot
from .config import ConfigError, load_config


def setup_logging() -> None:
    level = os.environ.get("LOCAL_AI_LOG_LEVEL", "INFO").upper()
    logging.basicConfig(
        level=getattr(logging, level, logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)


async def amain() -> int:
    try:
        config = load_config()
    except ConfigError as error:
        print(f"config error: {error}", file=sys.stderr)
        return 2

    bot = Bot(config)
    loop = asyncio.get_running_loop()
    stop = loop.create_future()
    for signal_name in ("SIGINT", "SIGTERM"):
        try:
            loop.add_signal_handler(
                getattr(signal, signal_name),
                lambda: stop.done() or stop.set_result(None),
            )
        except (NotImplementedError, AttributeError):  # pragma: no cover - non-POSIX
            pass

    runner = asyncio.create_task(bot.run())
    done, _ = await asyncio.wait({runner, stop}, return_when=asyncio.FIRST_COMPLETED)

    if runner in done:
        return 0 if runner.exception() is None else 1

    logging.getLogger("local-ai").info("shutting down")
    bot.request_stop()
    runner.cancel()
    try:
        await runner
    except asyncio.CancelledError:
        pass
    return 0


def main() -> int:
    setup_logging()
    try:
        return asyncio.run(amain())
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
