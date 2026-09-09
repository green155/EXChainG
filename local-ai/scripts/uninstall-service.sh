#!/usr/bin/env bash
# Remove the launchd agents. Models, .env and conversation history are kept.
set -uo pipefail

agents_dir="$HOME/Library/LaunchAgents"

for label in com.local-ai.telegram-bot com.local-ai.ollama; do
  plist="$agents_dir/$label.plist"
  if launchctl bootout "gui/$UID/$label" 2>/dev/null; then
    echo "unloaded $label"
  fi
  if [[ -f "$plist" ]]; then
    rm -f "$plist"
    echo "removed  $plist"
  fi
done

echo
echo "Done. Models are still in ~/.ollama, history in ~/.local/share/local-ai."
echo "To remove those too:  rm -rf ~/.ollama ~/.local/share/local-ai"
