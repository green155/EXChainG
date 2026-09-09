#!/usr/bin/env bash
# Download the models that suit this Mac. Safe to re-run: Ollama skips what it
# already has. Pass model names to override the recommendation.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v ollama >/dev/null 2>&1; then
  echo "ollama is not installed. Run local-ai/install.sh first." >&2
  exit 1
fi

if ! curl -fsS --max-time 3 "${OLLAMA_HOST:-http://127.0.0.1:11434}/api/version" >/dev/null 2>&1; then
  echo "Ollama is not running. Start it with: local-ai/lai start" >&2
  exit 1
fi

if (( $# > 0 )); then
  models=("$@")
else
  eval "$("$here/detect-hardware.sh")"
  echo "Detected: ${CHIP} · ${RAM_GB}GB · tier ${TIER}"
  models=("$CHAT_MODEL" "$VISION_MODEL" "$SMALL_MODEL")
fi

failed=()
for model in "${models[@]}"; do
  [[ -z "$model" ]] && continue
  echo
  echo "==> ollama pull $model"
  if ! ollama pull "$model"; then
    failed+=("$model")
  fi
done

echo
if (( ${#failed[@]} )); then
  echo "Could not pull: ${failed[*]}"
  echo "Model tags change over time -- check https://ollama.com/library for the"
  echo "current name, then re-run:  local-ai/scripts/pull-models.sh <model>"
fi

echo
echo "Installed models:"
ollama list
