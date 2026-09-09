#!/usr/bin/env bash
# Report the Mac's chip and memory, and pick models that fit in it.
# Prints KEY=VALUE lines so other scripts can `eval` the output.
set -euo pipefail

chip="unknown"
ram_gb=0

if [[ "$(uname -s)" == "Darwin" ]]; then
  chip="$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo unknown)"
  mem_bytes="$(sysctl -n hw.memsize 2>/dev/null || echo 0)"
  ram_gb=$(( mem_bytes / 1024 / 1024 / 1024 ))
  cores="$(sysctl -n hw.ncpu 2>/dev/null || echo 0)"
else
  # Linux fallback so the script stays testable off a Mac.
  ram_gb=$(( $(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0) / 1024 / 1024 ))
  cores="$(nproc 2>/dev/null || echo 0)"
fi

# Ollama can address roughly 75% of unified memory by default, and the OS wants
# a few GB. These tiers leave headroom for a browser and an IDE alongside.
if   (( ram_gb <= 10 )); then tier=tiny
elif (( ram_gb <= 18 )); then tier=small
elif (( ram_gb <= 26 )); then tier=medium
elif (( ram_gb <= 40 )); then tier=large
elif (( ram_gb <= 72 )); then tier=xl
else                          tier=xxl
fi

case "$tier" in
  tiny)   chat="qwen3:4b";      vision="gemma3:4b";   small="llama3.2:3b"; ctx=4096  ;;
  small)  chat="qwen3:8b";      vision="gemma3:4b";   small="qwen3:4b";    ctx=8192  ;;
  medium) chat="qwen3:14b";     vision="gemma3:12b";  small="qwen3:4b";    ctx=12288 ;;
  large)  chat="qwen3:30b-a3b"; vision="gemma3:12b";  small="qwen3:8b";    ctx=16384 ;;
  xl)     chat="qwen3:32b";     vision="gemma3:27b";  small="qwen3:8b";    ctx=24576 ;;
  xxl)    chat="gpt-oss:120b";  vision="gemma3:27b";  small="qwen3:14b";   ctx=32768 ;;
esac

# One loaded model at a time below 32GB, so a vision swap does not thrash.
if (( ram_gb <= 26 )); then max_loaded=1; else max_loaded=2; fi

cat <<EOF
CHIP="$chip"
CORES=$cores
RAM_GB=$ram_gb
TIER=$tier
CHAT_MODEL="$chat"
VISION_MODEL="$vision"
SMALL_MODEL="$small"
EMBED_MODEL="nomic-embed-text"
NUM_CTX=$ctx
MAX_LOADED_MODELS=$max_loaded
EOF
