#!/usr/bin/env bash
# Install the launchd agents so Ollama and the bot start at login and stay up.
#
#   install-service.sh                 both agents
#   install-service.sh --ollama-only   just the model server
#   install-service.sh --bot-only      just the Telegram bot
set -euo pipefail

want_ollama=1
want_bot=1
while (( $# )); do
  case "$1" in
    --ollama-only) want_bot=0 ;;
    --bot-only)    want_ollama=0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
agents_dir="$HOME/Library/LaunchAgents"
log_dir="$HOME/Library/Logs/local-ai"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "launchd is macOS-only. On another OS run the bot with: local-ai/lai run" >&2
  exit 1
fi

ollama_bin="$(command -v ollama || true)"
if [[ -z "$ollama_bin" ]]; then
  echo "ollama is not on PATH. Run local-ai/install.sh first." >&2
  exit 1
fi

python_bin="$root/.venv/bin/python3"
if (( want_bot )); then
  if [[ ! -x "$python_bin" ]]; then
    echo "No virtualenv at $root/.venv. Run local-ai/install.sh first." >&2
    exit 1
  fi
  if [[ ! -f "$root/.env" ]]; then
    echo "No local-ai/.env. Run local-ai/install.sh first." >&2
    exit 1
  fi
fi

eval "$("$here/detect-hardware.sh")"
mkdir -p "$agents_dir" "$log_dir"

render() {
  local template="$1" target="$2"
  sed \
    -e "s|@@OLLAMA_BIN@@|$ollama_bin|g" \
    -e "s|@@PYTHON@@|$python_bin|g" \
    -e "s|@@WORKDIR@@|$root|g" \
    -e "s|@@HOME@@|$HOME|g" \
    -e "s|@@PATH@@|/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin|g" \
    -e "s|@@LOG_DIR@@|$log_dir|g" \
    -e "s|@@MAX_LOADED_MODELS@@|$MAX_LOADED_MODELS|g" \
    -e "s|@@NUM_CTX@@|$NUM_CTX|g" \
    "$template" > "$target"
}

load() {
  local label="$1" plist="$2"
  # bootout first so a re-run picks up template changes.
  launchctl bootout "gui/$UID/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$UID" "$plist"
  launchctl enable "gui/$UID/$label"
  echo "  loaded $label"
}

echo "Installing launchd agents into $agents_dir"

if (( want_ollama )) && [[ "${LOCAL_AI_MANAGE_OLLAMA:-1}" == "1" ]]; then
  if pgrep -qf "Ollama.app" 2>/dev/null; then
    echo
    echo "  ! The Ollama desktop app is running. It binds port 11434 too."
    echo "    Quit it (menu bar icon -> Quit) so this agent can own the port,"
    echo "    or re-run with LOCAL_AI_MANAGE_OLLAMA=0 to keep using the app."
    echo
  fi
  render "$root/launchd/com.local-ai.ollama.plist.template" \
         "$agents_dir/com.local-ai.ollama.plist"
  load com.local-ai.ollama "$agents_dir/com.local-ai.ollama.plist"
fi

if (( want_bot )); then
  render "$root/launchd/com.local-ai.telegram-bot.plist.template" \
         "$agents_dir/com.local-ai.telegram-bot.plist"
  load com.local-ai.telegram-bot "$agents_dir/com.local-ai.telegram-bot.plist"
fi

echo
echo "Agents start at login and restart on crash."
echo "Logs:   $log_dir"
echo "Status: local-ai/lai status"
