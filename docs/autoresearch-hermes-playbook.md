# Autoresearch ↔ Hermes LLM Playbook

How the autoresearch measurement loop uses Hermes-configured LLMs to generate improvement hypotheses.

---

## Architecture

```
autoresearch harness (scripts/autoresearch/harness.cjs)
  │
  ├── measure phase    ← deterministic (regex, file checks) — no LLM
  ├── plan phase       ← calls <domain>-planner.cjs
  │     │
  │     └── planner uses lib/llm.cjs
  │           │
  │           ├── 1. Ollama (qwen3:14b, local CPU, free)
  │           ├── 2. OpenRouter (google/gemini-2.5-flash, cloud fallback)
  │           └── 3. Hermes one-shot (wsl hermes -z, configured model)
  │
  ├── remeasure phase  ← deterministic
  ├── deep phase       ← optional second measurement pass
  ├── commit phase     ← git commit if improved
  └── revert phase     ← git revert if not improved
```

**Key insight**: Measures are always deterministic. LLMs only enter at the _plan_ phase to generate hypotheses about what code changes might improve the metric. The measure scripts (`.cjs` files in `measures/`) use regex, file reads, and structural checks — never LLM calls.

---

## Provider Chain

The `llm.cjs` helper tries providers in order until one succeeds:

| Priority | Provider | Model | Cost | Latency | Context | When |
|----------|----------|-------|------|---------|---------|------|
| 1 | Ollama | qwen3:14b | Free | ~90–130s | 65,536 | Default — local, free, private |
| 2 | OpenRouter | google/gemini-2.5-flash | Free tier | ~2–4s | 1,048,576 | When Ollama is slow or down |
| 3 | Hermes CLI | (Hermes configured model) | Free | ~8s | varies | Last resort via `hermes -z` |

### Ollama (Primary)

- Model: `qwen3:14b`
- Runs on Windows-native Ollama at `localhost:11434`
- No API key needed — completely free
- Set `OLLAMA_CONTEXT_LENGTH=65536` in env (required — default context too small)
- Pull the model: `ollama pull qwen3:14b`

### OpenRouter (Secondary)

- Model: `google/gemini-2.5-flash`
- Free tier available (1M context, fast)
- Requires `OPENROUTER_API_KEY` in env or `~/.hermes/.env`
- Get a key: https://openrouter.ai/keys
- Do NOT use the `:free` suffix — it routes through Venice's free pool which has aggressive upstream rate limits

### Hermes One-Shot (Tertiary)

- Uses whatever model/provider Hermes is configured with
- Invoked via `wsl -d Ubuntu -- bash -lc "hermes -z 'PROMPT'"`
- Slowest option (WSL overhead + model loading)
- Uses Hermes's full fallback chain internally

---

## Setup

### 1. Run the config script

```bash
wsl -d Ubuntu -- bash /mnt/c/Za/claude-hermes-bridge/autoresearch/hermes-config.sh
```

This checks:
- Hermes model set to qwen3:14b (Ollama primary)
- Ollama reachable + models available
- OpenRouter API key present (optional fallback)

### 2. Run the benchmark

```bash
cd C:/Za/claude-hermes-bridge
node autoresearch/benchmark.cjs --verbose
```

Expected output:
```
=== Autoresearch ↔ Hermes LLM Benchmark ===

Test 1: Provider connectivity...
  [PASS] ollama (qwen3:14b) — 94000ms
  [PASS] openrouter (google/gemini-2.5-flash) — 2100ms
  [PASS] hermes (hermes-configured) — 5200ms

Test 2: Full completion (hypothesis generation)...
  [PASS] ollama — 98000ms — 3 hypotheses generated

Test 3: JSON extraction from LLM response...
  [PASS] ollama — 96000ms — JSON valid: true

=== Summary ===
  Total time: 305000ms
  Results: 6 PASS / 0 WARN / 0 FAIL
```

### 3. Create a domain planner

Copy the template and customize for your domain:

```bash
cp autoresearch/measures/_planner-template.cjs \
   scripts/autoresearch/measures/my-domain-planner.cjs
```

Edit the planner:
1. Set `DOMAIN_NAME` to match your `domains/<name>.json`
2. Customize `buildPrompt()` for your domain's improvement strategy
3. The harness auto-discovers it: `<metric-command>.cjs` → `<metric-command>-planner.cjs`

---

## How It Integrates with Autoresearch

The harness (`scripts/autoresearch/harness.cjs`) has a `plan` phase that:

1. Takes the metric command path from `domains/<name>.json`
2. Replaces `.cjs` with `-planner.cjs`
3. Executes the planner — expects JSON on stdout
4. Saves the plan to `_runs/autoresearch/<domain>/research-plan.json`

The planner uses `llm.cjs` to call the LLM chain, passing:
- Domain program (from config)
- Target files
- Recent experiment history (last 5 experiments)
- Metric info (direction, threshold)

The LLM generates concrete hypotheses. The harness then applies them one at a time, measures, and keeps/reverts.

---

## Environment Variables

| Variable | Where | Description |
|----------|-------|-------------|
| `OPENROUTER_API_KEY` | Windows env or `~/.hermes/.env` | OpenRouter API key (free) |
| `OLLAMA_HOST` | Windows env | Ollama URL (default: `http://localhost:11434`) |

`llm.cjs` auto-reads the OpenRouter key from Hermes's `.env` if not set in the Windows environment.

---

## Troubleshooting

**Ollama slow (90–130s)**: Normal on CPU-only hardware. For faster autoresearch runs, switch to OpenRouter (`google/gemini-2.5-flash`) by setting `OPENROUTER_API_KEY` — the chain falls through automatically.

**Ollama connection refused**: Start Ollama on Windows (`ollama serve`). The WSL bridge auto-connects to Windows localhost.

**Ollama context too small**: Ensure `OLLAMA_CONTEXT_LENGTH=65536` is set. Without this, Hermes may truncate plans or loop on long tasks.

**OpenRouter 429 (rate limited)**: Free tier has limits. Falls through to Hermes one-shot automatically.

**Hermes one-shot hangs**: Check `wsl -d Ubuntu -- bash -lc "hermes status"`. Verify Hermes is configured and `hermes doctor` passes.

**JSON parse failures**: The `completeJSON()` helper extracts JSON from markdown code blocks or raw JSON objects. If the LLM wraps output in explanation text, it still works. Lower `temperature` to 0 for more deterministic JSON output.

---

## Benchmarking

Save JSON reports for tracking over time:

```bash
node autoresearch/benchmark.cjs --json --verbose
# Report saved to: _runs/benchmark-latest.json
```

Compare provider performance across runs to decide if the chain ordering should change.
