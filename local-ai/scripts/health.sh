#!/usr/bin/env bash
# One-shot check that every moving part is where it should be.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
host="${OLLAMA_HOST:-http://127.0.0.1:11434}"
[[ "$host" == http* ]] || host="http://$host"
problems=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; problems=$((problems + 1)); }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }

echo "Hardware"
eval "$("$here/detect-hardware.sh")"
ok "${CHIP} · ${RAM_GB}GB · tier ${TIER}"

echo "Tooling"
command -v ollama >/dev/null 2>&1 && ok "ollama $(ollama --version 2>/dev/null | tail -1)" || bad "ollama not installed"
[[ -x "$root/.venv/bin/python3" ]] && ok "python venv" || bad "no venv (run install.sh)"
command -v ffmpeg >/dev/null 2>&1 && ok "ffmpeg" || warn "ffmpeg missing (voice notes disabled)"
if command -v mlx_whisper >/dev/null 2>&1; then ok "mlx-whisper"
elif command -v whisper >/dev/null 2>&1; then ok "whisper (CPU)"
else warn "no transcriber (voice notes disabled)"; fi

echo "Configuration"
if [[ -f "$root/.env" ]]; then
  ok ".env present"
  grep -q '^TELEGRAM_BOT_TOKEN=REPLACE_ME' "$root/.env" && bad "TELEGRAM_BOT_TOKEN is still the placeholder"
  if grep -qE '^TELEGRAM_ALLOWED_USER_IDS=[0-9]' "$root/.env"; then
    ok "allowlist configured"
  else
    bad "TELEGRAM_ALLOWED_USER_IDS is empty -- the bot will refuse everyone"
  fi
  perms="$(stat -f '%Lp' "$root/.env" 2>/dev/null || stat -c '%a' "$root/.env" 2>/dev/null)"
  [[ "$perms" == "600" ]] && ok ".env is chmod 600" || warn ".env is chmod $perms (want 600)"
else
  bad "no .env (run install.sh)"
fi

echo "Services"
if curl -fsS --max-time 5 "$host/api/version" >/dev/null 2>&1; then
  ok "ollama answering at $host"
  count="$(curl -fsS "$host/api/tags" | grep -o '"name"' | wc -l | tr -d ' ')"
  [[ "$count" -gt 0 ]] && ok "$count model(s) installed" || bad "no models (run scripts/pull-models.sh)"
else
  bad "ollama not answering at $host"
fi

if [[ "$(uname -s)" == "Darwin" ]]; then
  for label in com.local-ai.ollama com.local-ai.telegram-bot; do
    if launchctl print "gui/$UID/$label" >/dev/null 2>&1; then
      ok "$label loaded"
    else
      warn "$label not loaded (run scripts/install-service.sh)"
    fi
  done
fi

echo
if (( problems )); then
  echo "$problems problem(s) found."
  exit 1
fi
echo "All good."
