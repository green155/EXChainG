#!/usr/bin/env bash
# Set up a private, offline AI on an Apple Silicon Mac, reachable from Telegram.
#
#   ./local-ai/install.sh                 interactive, does everything
#   ./local-ai/install.sh --yes           accept every default, no questions
#   ./local-ai/install.sh --token X --allow Y --yes     fully unattended
#   ./local-ai/install.sh --skip-models   set up the software, pull models later
#   ./local-ai/install.sh --models "qwen3:8b gemma3:4b"
#
# --token takes a @BotFather token, --allow takes your numeric Telegram user
# ID or your @username. Both are only read when .env does not already have
# them, so re-running is safe. A token passed as a flag lands in your shell
# history -- omit it to be prompted instead, or rotate later with `lai token`.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
assume_yes=0
skip_models=0
skip_service=0
model_override=""
token_arg=""
allow_arg=""

while (( $# )); do
  case "$1" in
    -y|--yes)       assume_yes=1 ;;
    --skip-models)  skip_models=1 ;;
    --skip-service) skip_service=1 ;;
    --models)       model_override="${2:-}"; shift ;;
    --token)        token_arg="${2:-}"; shift ;;
    --allow)        allow_arg="${2:-}"; shift ;;
    # Print the header comment, however long it happens to be.
    -h|--help)      awk 'NR==1{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
step()  { printf '\n\033[1;34m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
info()  { printf '    %s\n' "$*"; }
warn()  { printf '    \033[33m!\033[0m %s\n' "$*"; }
die()   { printf '\n\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

confirm() {
  (( assume_yes )) && return 0
  local reply
  read -r -p "    $1 [Y/n] " reply
  [[ -z "$reply" || "$reply" =~ ^[Yy] ]]
}

# ---------------------------------------------------------------- preflight --

step "Checking the machine"

if [[ "$(uname -s)" != "Darwin" ]]; then
  die "this installer targets macOS. On Linux, install Ollama yourself and run 'local-ai/lai run'."
fi

eval "$("$root/scripts/detect-hardware.sh")"
info "$CHIP"
info "${RAM_GB}GB unified memory · ${CORES} cores · tier ${TIER}"

if [[ "$(uname -m)" != "arm64" ]]; then
  warn "this is an Intel Mac; models will run on CPU and be slow."
elif (( RAM_GB <= 10 )); then
  warn "under 16GB is tight. Sticking to small models."
fi

# ------------------------------------------------------------------ homebrew --

step "Homebrew"

if ! command -v brew >/dev/null 2>&1; then
  for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    [[ -x "$candidate" ]] && eval "$("$candidate" shellenv)" && break
  done
fi

if ! command -v brew >/dev/null 2>&1; then
  warn "Homebrew is not installed."
  info "Install it first, then re-run this script:"
  info '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
  die "Homebrew required"
fi
info "$(brew --version | head -1)"

brew_install() {
  local formula="$1" description="$2"
  if brew list --formula "$formula" >/dev/null 2>&1 || command -v "$formula" >/dev/null 2>&1; then
    info "$formula already installed"
    return 0
  fi
  if confirm "Install $formula ($description)?"; then
    brew install "$formula"
  else
    warn "skipped $formula"
    return 1
  fi
}

# -------------------------------------------------------------------- ollama --

step "Ollama"
brew_install ollama "the local model runtime" || die "Ollama is required"
info "$(ollama --version 2>/dev/null | tail -1)"

step "Optional extras"
brew_install ffmpeg "decodes Telegram voice notes" || true

# -------------------------------------------------------------------- python --

step "Python environment"

find_python() {
  for candidate in python3.13 python3.12 python3.11 python3; do
    local path
    path="$(command -v "$candidate" || true)"
    [[ -z "$path" ]] && continue
    if "$path" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)'; then
      echo "$path"
      return 0
    fi
  done
  return 1
}

python_bin="$(find_python || true)"
if [[ -z "$python_bin" ]]; then
  warn "no Python 3.10+ found (macOS ships 3.9, which is too old)."
  brew_install python@3.12 "the bot needs 3.10 or newer" || die "Python 3.10+ required"
  python_bin="$(find_python || true)"
  [[ -n "$python_bin" ]] || die "still no Python 3.10+ on PATH"
fi
info "using $python_bin ($("$python_bin" --version))"

if [[ ! -d "$root/.venv" ]]; then
  "$python_bin" -m venv "$root/.venv"
  info "created $root/.venv"
fi
"$root/.venv/bin/python3" -m pip install --quiet --upgrade pip
"$root/.venv/bin/python3" -m pip install --quiet -r "$root/requirements.txt"
info "dependencies installed"

if confirm "Install mlx-whisper so voice notes get transcribed on the GPU?"; then
  "$root/.venv/bin/python3" -m pip install --quiet mlx-whisper || warn "mlx-whisper failed to install"
  # The bot shells out to the CLI, so expose it on PATH via a symlink.
  if [[ -x "$root/.venv/bin/mlx_whisper" ]]; then
    mkdir -p "$HOME/.local/bin"
    ln -sf "$root/.venv/bin/mlx_whisper" "$HOME/.local/bin/mlx_whisper"
    info "linked mlx_whisper into ~/.local/bin"
  fi
fi

# ----------------------------------------------------------------------- env --

step "Telegram configuration"

env_file="$root/.env"
if [[ -f "$env_file" ]]; then
  info ".env already exists — leaving it alone"
else
  cp "$root/.env.example" "$env_file"
  chmod 600 "$env_file"
  info "created .env from the template (chmod 600)"
fi

set_env() {
  # Rewrite KEY=value in place. Deliberately not sed: a bot token is arbitrary
  # text, and every sed metacharacter in it would need escaping (and BSD and
  # GNU sed disagree about -i anyway).
  local key="$1" value="$2" tmp line
  if ! grep -q "^${key}=" "$env_file"; then
    printf '%s=%s\n' "$key" "$value" >> "$env_file"
    return
  fi
  tmp="$(mktemp)"
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == "${key}="* ]]; then
      printf '%s=%s\n' "$key" "$value"
    else
      printf '%s\n' "$line"
    fi
  done < "$env_file" > "$tmp"
  # Truncate rather than move, so the file keeps its 600 permissions.
  cat "$tmp" > "$env_file"
  rm -f "$tmp"
}

current_token="$(grep '^TELEGRAM_BOT_TOKEN=' "$env_file" | cut -d= -f2- || true)"
if [[ -n "$current_token" && "$current_token" != "REPLACE_ME" ]]; then
  info "token already set"
elif [[ -n "$token_arg" ]]; then
  set_env TELEGRAM_BOT_TOKEN "$token_arg"
  info "token saved to .env (from --token)"
elif [[ ! -t 0 ]]; then
  die "no token. Re-run with --token <token from @BotFather>, or run this script interactively."
else
  echo
  info "Open Telegram, message @BotFather, send /newbot, and copy the token."
  info "It is typed in, not echoed — nothing is written to your shell history."
  read -r -s -p "    Bot token: " token
  echo
  [[ -n "$token" ]] || die "no token given; edit $env_file by hand and re-run"
  set_env TELEGRAM_BOT_TOKEN "$token"
  info "token saved to .env"
fi

current_ids="$(grep '^TELEGRAM_ALLOWED_USER_IDS=' "$env_file" | cut -d= -f2- || true)"
current_names="$(grep '^TELEGRAM_ALLOWED_USERNAMES=' "$env_file" | cut -d= -f2- || true)"

# Store whichever identifier we were given: digits are a user ID, anything
# else is a @username.
save_allow() {
  local who="${1#@}"
  if [[ "$who" =~ ^[0-9,\ ]+$ ]]; then
    set_env TELEGRAM_ALLOWED_USER_IDS "$who"
    info "allowlist saved (user ID)"
  else
    set_env TELEGRAM_ALLOWED_USERNAMES "$who"
    info "allowlist saved (username)"
    warn "a username can be released and reclaimed by someone else. Send the"
    warn "bot /whoami and move your numeric ID into TELEGRAM_ALLOWED_USER_IDS."
  fi
}

if [[ -n "$current_ids" || -n "$current_names" ]]; then
  info "allowlist already set"
elif [[ -n "$allow_arg" ]]; then
  save_allow "$allow_arg"
elif [[ ! -t 0 ]]; then
  warn "no allowlist. Re-run with --allow <your ID or @username>, or message"
  warn "the bot once — it replies with the user ID you need to add."
else
  echo
  info "Only people on the allowlist get answers. Give either your numeric"
  info "Telegram user ID (ask @userinfobot) or your @username."
  read -r -p "    Your Telegram ID or @username (blank to do it later): " who
  if [[ -z "${who// /}" ]]; then
    warn "allowlist left empty — the bot refuses everyone, but it replies with"
    warn "the sender's user ID, so message it once and add what it tells you."
  else
    save_allow "$who"
  fi
fi

set_env LOCAL_AI_MODEL "$CHAT_MODEL"
set_env LOCAL_AI_VISION_MODEL "$VISION_MODEL"
set_env LOCAL_AI_NUM_CTX "$NUM_CTX"
info "defaults tuned for ${RAM_GB}GB: model $CHAT_MODEL, context $NUM_CTX"

# ------------------------------------------------------------------ services --

step "Background services"

install_services=0
if (( skip_service )); then
  info "skipped (--skip-service)"
elif confirm "Run Ollama and the bot at login via launchd?"; then
  install_services=1
  # The model server goes up first so the download below has something to talk
  # to; the bot follows once the models are on disk.
  "$root/scripts/install-service.sh" --ollama-only || warn "could not start the Ollama agent"
else
  info "not installing services; start things by hand with 'local-ai/lai run'"
fi

# -------------------------------------------------------------------- models --

step "Models"

if (( skip_models )); then
  info "skipped (--skip-models)"
else
  # The pull needs a live server whether or not launchd is managing one.
  if ! curl -fsS --max-time 3 "http://127.0.0.1:11434/api/version" >/dev/null 2>&1; then
    info "starting ollama serve in the background for the download"
    ollama serve >/tmp/local-ai-ollama-install.log 2>&1 &
    for _ in $(seq 1 30); do
      curl -fsS --max-time 1 "http://127.0.0.1:11434/api/version" >/dev/null 2>&1 && break
      sleep 1
    done
  fi

  info "this downloads several GB and can take a while"
  if [[ -n "$model_override" ]]; then
    # shellcheck disable=SC2086 - deliberate word splitting into separate models
    "$root/scripts/pull-models.sh" $model_override || warn "some models failed"
  else
    "$root/scripts/pull-models.sh" || warn "some models failed"
  fi
fi

if (( install_services )); then
  step "Starting the bot"
  "$root/scripts/install-service.sh" --bot-only || warn "could not start the bot agent"
fi

# --------------------------------------------------------------------- done --

step "Checking everything"
"$root/scripts/health.sh" || true

echo
bold "Done."
echo
info "Open Telegram, find your bot, and send it a message."
echo
info "  local-ai/lai status     what is running"
info "  local-ai/lai logs       follow the bot log"
info "  local-ai/lai restart    after editing .env"
info "  local-ai/lai health     re-run these checks"
echo
warn "Anyone holding the bot token can talk to your bot. If it has ever been"
warn "pasted into a chat, an email or a screenshot, get a new one from"
warn "@BotFather (/revoke), then: local-ai/lai token"
