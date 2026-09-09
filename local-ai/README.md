# local-ai

A private AI that runs entirely on your Mac mini, that you talk to from
Telegram like any other chat.

No API keys, no per-token billing, no prompt leaving the machine. Close the
laptop, lose the Wi-Fi at the café, and the thing on your desk still answers.

```
  Telegram  ──►  bot (python, on the Mac)  ──►  Ollama  ──►  Apple Silicon GPU
```

## Install

On the Mac mini, from the repository root:

```bash
./local-ai/install.sh
```

It checks the chip and memory, installs Homebrew packages (Ollama, optionally
ffmpeg), creates a Python virtualenv, asks for your bot token, picks models
sized to your RAM, downloads them, and registers two launchd agents so
everything comes back after a reboot.

Re-running it is safe — it skips whatever is already done.

You need a bot token first: message **@BotFather** on Telegram, send `/newbot`,
follow the prompts, copy the token it gives you. The installer prompts for it
without echoing.

### What lands where

| Path | What |
| --- | --- |
| `local-ai/.env` | your token and settings — git-ignored, chmod 600 |
| `local-ai/.venv/` | the bot's Python environment |
| `~/.ollama/models/` | the model weights (several GB each) |
| `~/.local/share/local-ai/bot.db` | conversation history |
| `~/Library/LaunchAgents/com.local-ai.*.plist` | the two services |
| `~/Library/Logs/local-ai/` | logs |

Nothing is written outside your home directory except Homebrew packages.

## Using it

Message the bot. That is the whole interface.

| | |
| --- | --- |
| **Text** | ask anything; the reply streams in, updating as it is written |
| **Photos** | sent to a vision model — "what's this error?", "read this label" |
| **Voice notes** | transcribed with Whisper on the GPU, then answered |
| **Text files** | `.py`, `.md`, `.csv`, `.json`, logs — read inline and discussed |

| Command | |
| --- | --- |
| `/new` | forget the conversation and start over |
| `/model` | show the model; `/model qwen3:14b` to switch |
| `/models` | list what is installed |
| `/system` | show, set, or `clear` the system prompt |
| `/temp 0.2` | lower is focused, higher is loose |
| `/stats` | tokens generated, tokens/sec, history size |
| `/stop` | cancel a reply mid-stream |
| `/whoami` | your Telegram user ID |

Per-chat settings persist, so one chat can be a terse code reviewer and another
a rambling brainstorm partner.

## Running it

```bash
local-ai/lai status     # what is loaded, what is answering
local-ai/lai logs       # follow the bot log
local-ai/lai restart    # after editing .env
local-ai/lai health     # full diagnostic
local-ai/lai run        # foreground, verbose — for debugging
local-ai/lai chat       # talk to the model in the terminal, no Telegram
local-ai/lai pull qwen3:32b
local-ai/lai token      # replace the bot token
local-ai/lai uninstall  # remove the services, keep the models
```

## Which model

`install.sh` picks by memory, since on Apple Silicon the GPU shares RAM with
everything else:

| Memory | Chat | Vision | Context |
| --- | --- | --- | --- |
| 16 GB | `qwen3:8b` | `gemma3:4b` | 8k |
| 24 GB | `qwen3:14b` | `gemma3:12b` | 12k |
| 32 GB | `qwen3:30b-a3b` | `gemma3:12b` | 16k |
| 48–64 GB | `qwen3:32b` | `gemma3:27b` | 24k |
| 64 GB+ | `gpt-oss:120b` | `gemma3:27b` | 32k |

Override any of it in `.env`, or at runtime with `/model`. Model names on
[ollama.com/library](https://ollama.com/library) change over time — if a pull
fails, look up the current tag and `local-ai/lai pull <name>`.

A rough feel on an M4: an 8B model at 4-bit runs conversationally fast, a 14B
is comfortable, a 32B is usable but you watch it type. Mixture-of-experts
models like `qwen3:30b-a3b` punch well above their speed class because only a
fraction of the weights are active per token.

### Speed and memory

The Ollama agent is configured with flash attention and a quantised KV cache,
which roughly halves what a long context costs in memory — that is what makes a
large context window viable on a 16GB machine. It also keeps a model resident
for 30 minutes after use, so the second message doesn't pay for a cold load
from disk.

If the Mac starts swapping, drop `LOCAL_AI_NUM_CTX` or move to a smaller model.

## Configuration

Everything lives in `local-ai/.env` — see `.env.example` for the annotated
list. The ones worth knowing:

| Variable | |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | from @BotFather |
| `TELEGRAM_ALLOWED_USER_IDS` | comma-separated numeric IDs; **empty locks everyone out** |
| `LOCAL_AI_MODEL` | default model |
| `LOCAL_AI_VISION_MODEL` | used when you send a photo and the default can't see |
| `LOCAL_AI_SYSTEM_PROMPT` | prepended to every conversation |
| `LOCAL_AI_NUM_CTX` | context window in tokens |
| `LOCAL_AI_SHOW_THINKING` | show a reasoning model's scratchpad |

Restart after editing: `local-ai/lai restart`.

## Security

The bot is only as private as its token: anyone holding it can message your
bot, and the allowlist is what stops them getting a reply.

- **The allowlist is the real lock.** Only user IDs in
  `TELEGRAM_ALLOWED_USER_IDS` get answers. Everyone else is told their own ID
  and nothing else. An empty list refuses everybody, deliberately.
- **Ollama binds to loopback**, so the model server is not reachable from your
  network.
- **`.env` is git-ignored and chmod 600.** It is the one file worth guarding.
- **If the token has ever been in a chat, an email, a screenshot or a paste
  bin, replace it**: @BotFather → `/revoke`, then `local-ai/lai token`.
- Messages themselves still cross Telegram's servers — that part is not local.
  If you need the transport private too, this is the wrong front end.

## Troubleshooting

**The bot says nothing at all.** `local-ai/lai logs`. A bad token shows up as
a 401 within a second of starting.

**"This bot is private."** Your user ID isn't on the allowlist. The message
tells you the ID — put it in `TELEGRAM_ALLOWED_USER_IDS` and
`local-ai/lai restart`.

**"model ... is not installed."** `local-ai/lai pull <name>`.

**Replies are very slow.** `local-ai/lai status` shows what is loaded. First
message after idle pays a load from disk. If it is slow every time, the model
is too big for the RAM and the machine is swapping — go a tier down.

**Ollama won't start.** The Ollama desktop app binds the same port. Quit it
from the menu bar, or set `LOCAL_AI_MANAGE_OLLAMA=0` and let the app serve.

**Voice notes aren't transcribed.** Needs both `ffmpeg` and a Whisper CLI:
`brew install ffmpeg` and re-run `install.sh`, which offers to install
mlx-whisper.

## Development

```bash
cd local-ai
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest        # 134 tests, no network, no GPU
.venv/bin/python -m bot           # run against a real Ollama
```

The tests fake Telegram and Ollama at the HTTP boundary, so the whole
request/response path is exercised without either service running.

| Module | |
| --- | --- |
| `bot/app.py` | routing, commands, attachments, generation |
| `bot/ollama.py` | streaming client for the model server |
| `bot/telegram.py` | Bot API client, long polling |
| `bot/stream.py` | live-updating replies, message rollover |
| `bot/render.py` | Markdown → Telegram HTML, safe splitting |
| `bot/store.py` | SQLite settings and history |
| `bot/config.py` | environment loading |
| `bot/voice.py` | optional Whisper transcription |

The only runtime dependency is `httpx`.
