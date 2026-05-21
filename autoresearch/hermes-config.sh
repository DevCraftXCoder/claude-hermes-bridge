#!/usr/bin/env bash
# hermes-config.sh — Configure Hermes for autoresearch LLM chain
#
# Sets Ollama as primary provider, OpenRouter as fallback.
# Run once after Hermes installation:
#   wsl -d Ubuntu -- bash /mnt/c/Za/claude-hermes-bridge/autoresearch/hermes-config.sh

set -euo pipefail

echo "=== Hermes Autoresearch Provider Setup ==="

# 1. Check Ollama availability (Windows-native, accessed via localhost)
echo "[1/3] Checking Ollama (Windows-native at localhost:11434)..."
if curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
  MODELS=$(curl -sf http://localhost:11434/api/tags | python3 -c "
import sys, json
data = json.load(sys.stdin)
for m in data.get('models', []):
    print(f\"  - {m['name']}\")
" 2>/dev/null || echo "  (could not parse models)")
  echo "  Ollama is running. Available models:"
  echo "$MODELS"
  echo ""
  echo "  Recommended: ollama pull qwen3:14b"
else
  echo "  Ollama not reachable at localhost:11434"
  echo "  Start Ollama on Windows: ollama serve"
  echo "  Pull a model: ollama pull qwen3:14b"
fi

# 2. Check OpenRouter API key (fallback provider)
if grep -q '^OPENROUTER_API_KEY=' ~/.hermes/.env 2>/dev/null; then
  echo "[2/3] OpenRouter API key: found (fallback ready)"
else
  echo "[2/3] OpenRouter API key not set (optional fallback)"
  echo "  Get a free key at: https://openrouter.ai/keys"
  echo "  Add to ~/.hermes/.env: OPENROUTER_API_KEY=sk-or-v1-..."
fi

# 3. Set primary model config
echo "[3/3] Setting Hermes config..."
hermes config set model.default "qwen3:14b" 2>/dev/null || {
  echo "  (hermes config set not available — edit ~/.hermes/config.yaml manually)"
  echo "  Set model.default to 'qwen3:14b'"
}

echo ""
echo "=== Provider Chain (autoresearch/lib/llm.cjs) ==="
echo "  1. Ollama → qwen3:14b (free, local CPU — primary)"
echo "  2. OpenRouter → google/gemini-2.5-flash (free tier, cloud — fallback)"
echo "  3. Hermes one-shot → uses configured model (last resort)"
echo ""
echo "Done. Run benchmark: node autoresearch/benchmark.cjs"
