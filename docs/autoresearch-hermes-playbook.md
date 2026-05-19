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
  │           ├── 1. OpenRouter (owl-alpha, free)
  │           ├── 2. Ollama (qwen2.5-coder:14b, local CPU)
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

| Priority | Provider | Model | Cost | Latency | When |
|----------|----------|-------|------|---------|------|
| 1 | OpenRouter | owl-alpha (Hermes 3 405B) | Free | ~3-8s | Default — fast, capable |
| 2 | Ollama | qwen2.5-coder:14b | Free | ~10-30s | When OpenRouter is down or rate-limited |
| 3 | Hermes CLI | configured model | Varies | ~15-60s | Emergency fallback via `hermes -z` |

### OpenRouter (Primary)

- Model: `nousresearch/hermes-3-llama-3.1-405b:free`
- Free tier, no credit card needed
- Requires `OPENROUTER_API_KEY` in env or `~/.hermes/.env`
- Get a key: https://openrouter.ai/keys

### Ollama (Secondary)

- Model: `qwen2.5-coder:14b`
- Runs on Windows-native Ollama at `localhost:11434`
- No API key needed
- Pull the model: `ollama pull qwen2.5-coder:14b`

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
- Hermes model set to owl-alpha
- OpenRouter API key present
- Ollama reachable + models available

### 2. Run the benchmark

```bash
cd C:/Za/claude-hermes-bridge
node autoresearch/benchmark.cjs --verbose
```

Expected output:
```
=== Autoresearch ↔ Hermes LLM Benchmark ===

Test 1: Provider connectivity...
  [PASS] openrouter (nousresearch/hermes-3-llama-3.1-405b:free) — 2340ms
  [PASS] ollama (qwen2.5-coder:14b) — 890ms
  [PASS] hermes (hermes-configured) — 5200ms

Test 2: Full completion (hypothesis generation)...
  [PASS] openrouter — 4100ms — 3 hypotheses generated

Test 3: JSON extraction from LLM response...
  [PASS] openrouter — 1800ms — JSON valid: true

=== Summary ===
  Total time: 14330ms
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

**OpenRouter 429 (rate limited)**: Free tier has limits. Falls through to Ollama automatically.

**Ollama connection refused**: Start Ollama on Windows (`ollama serve`). The WSL bridge auto-connects to Windows localhost.

**Hermes one-shot hangs**: Check `wsl -d Ubuntu -- bash -lc "hermes status"`. May need `hermes login` for Nous Portal.

**JSON parse failures**: The `completeJSON()` helper extracts JSON from markdown code blocks or raw JSON objects. If the LLM wraps output in explanation text, it still works. Lower `temperature` to 0 for more deterministic JSON output.

---

## Benchmarking

Save JSON reports for tracking over time:

```bash
node autoresearch/benchmark.cjs --json --verbose
# Report saved to: _runs/benchmark-latest.json
```

Compare provider performance across runs to decide if the chain ordering should change.
