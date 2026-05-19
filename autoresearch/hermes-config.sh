#!/usr/bin/env bash
# hermes-config.sh — Configure Hermes for autoresearch LLM chain
#
# Sets owl-alpha as primary model, adds ollama as fallback.
# Run once after Hermes installation:
#   wsl -d Ubuntu -- bash /mnt/c/Za/claude-hermes-bridge/autoresearch/hermes-config.sh

set -euo pipefail

echo "=== Hermes Autoresearch Provider Setup ==="

# 1. Set primary model to owl-alpha via OpenRouter
echo "[1/3] Setting primary model to openrouter/owl-alpha..."
hermes config set model.default "openrouter/owl-alpha" 2>/dev/null || {
  echo "  (hermes config set not available — edit ~/.hermes/config.yaml manually)"
  echo "  Set model.default to 'openrouter/owl-alpha'"
}

# 2. Check OpenRouter API key
if grep -q '^OPENROUTER_API_KEY=' ~/.hermes/.env 2>/dev/null; then
  echo "[2/3] OpenRouter API key: found"
else
  echo "[2/3] WARNING: OPENROUTER_API_KEY not set in ~/.hermes/.env"
  echo "  Get a free key at: https://openrouter.ai/keys"
  echo "  Add to ~/.hermes/.env: OPENROUTER_API_KEY=sk-or-v1-..."
fi

# 3. Check Ollama availability (Windows-native, accessed via localhost)
echo "[3/3] Checking Ollama (Windows-native at localhost:11434)..."
if curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
  MODELS=$(curl -sf http://localhost:11434/api/tags | python3 -c "
import sys, json
data = json.load(sys.stdin)
for m in data.get('models', []):
    print(f\"  - {m['name']}\")
" 2>/dev/null || echo "  (could not parse models)")
  echo "  Ollama is running. Available models:"
  echo "$MODELS"
else
  echo "  Ollama not reachable at localhost:11434"
  echo "  Start Ollama on Windows: ollama serve"
  echo "  Pull a model: ollama pull qwen2.5-coder:14b"
fi

echo ""
echo "=== Provider Chain (autoresearch/lib/llm.cjs) ==="
echo "  1. OpenRouter → owl-alpha (free, cloud)"
echo "  2. Ollama → qwen2.5-coder:14b (free, local CPU)"
echo "  3. Hermes one-shot → uses configured model (fallback)"
echo ""
echo "Done. Run benchmark: node autoresearch/benchmark.cjs"
