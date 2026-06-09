# Claude Hermes Bridge

Auto-sync your Claude Code agents, hooks, and skills to [Hermes Agent](https://github.com/NousResearch/hermes-agent) running in WSL2.

Every time you write or edit a Claude Code agent, hook, or skill file, a PostToolUse hook fires and the file lands in Hermes's `~/.hermes/skills/` directory — immediately available to the Hermes runtime.

Also includes a **production deployment guide** for getting Hermes running on Windows + WSL2, and an **autoresearch integration** for LLM-powered hypothesis generation.

**Provider defaults:** Ollama (local, private, zero cost) is the primary provider. OpenRouter is the automatic fallback for when Ollama is unavailable or you need models with larger context windows. Supported 1M-context cloud options include Gemini 2.5 Flash, DeepSeek V4 Flash, and DeepSeek V4 Pro. No external API key required for basic local use.

📊 **[Project Roadmap](docs/roadmap.html)** — live score across sync, runtime, models, autoresearch, and launchers.

---

## What Gets Synced

| Claude Code source | Hermes destination |
|--------------------|-------------------|
| `.claude/agents/*.md` | `~/.hermes/skills/cc-agents/<name>/SKILL.md` |
| `.claude/hooks/*.cjs` | `~/.hermes/skills/cc-hooks/<name>/SKILL.md` |
| `.claude/skills/**/SKILL.md` | `~/.hermes/skills/cc-skills/<name>/SKILL.md` |

Category names are configurable via environment variables (see [Configuration](#configuration)).

---

## Quick Start

### 1. Prerequisites

- Windows 11 with WSL2 (Ubuntu) — the installer checks this and tells you what to install if missing
- Node.js >= 18 in your Windows PATH
- Claude Code CLI

**No Hermes install needed first** — the installer handles it.

### 2. Clone and run the installer

```bash
git clone https://github.com/DevCraftXCoder/claude-hermes-bridge.git
cd claude-hermes-bridge
bash sync/install.sh
```

The installer runs 6 steps automatically:

1. Verifies WSL2 + Ubuntu are available
2. Installs Hermes Agent inside WSL (skips if already installed)
3. Copies sync hooks into your `.claude/hooks/` directory
4. Drops **`hermes-chat.bat`** on your Windows Desktop and creates a **`Hermes Launchers\`** folder with all 8 model launchers ready to double-click
5. Prints the `settings.json` snippet to register the auto-sync hook
6. Prints the bulk-sync command for your first sync

```bash
# Custom .claude path:
bash sync/install.sh --dir "C:/Users/YourName/YourProject/.claude"
```

### 3. Configure your LLM provider

**Option A — Both providers (recommended):**

Use OpenRouter as your default (cloud models, 1M context) and add `ollama-local` as a named provider for local models (free, private, zero latency).

```bash
# 1. Pull local models
ollama pull qwen2.5-coder:14b   # Best local coding (9GB)
ollama pull qwen2.5-coder:7b    # Lighter coding (4.7GB)
ollama pull llama3.2:latest      # General chat (2GB, supports tool calling)
```

Hermes config (`~/.hermes/config.yaml`):
```yaml
model:
  default: "google/gemini-2.5-flash"
  provider: "openrouter"
  context_length: 1048576
compression:
  enabled: false

# Named provider for local Ollama — used by --provider ollama-local
providers:
  ollama-local:
    base_url: http://localhost:11434/v1
    api_key: ollama
    request_timeout_seconds: 300
```

Hermes env (`~/.hermes/.env`):
```bash
OPENROUTER_API_KEY=sk-or-v1-your-key-here

# IMPORTANT: Do NOT set OPENAI_API_KEY here — it overrides the
# ollama-local provider's api_key and routes local models to OpenRouter.
# Only set OLLAMA_HOST for Ollama connectivity:
OLLAMA_HOST=http://localhost:11434
```

Usage:
```bash
hermes chat --provider openrouter --model google/gemini-2.5-flash
hermes chat --provider ollama-local --model qwen2.5-coder:14b
```

**Option B — Ollama only (no API key needed):**

```bash
ollama pull qwen3:14b
```

Hermes config (`~/.hermes/config.yaml`):
```yaml
model:
  default: "qwen3:14b"
  provider: "ollama-local"
  context_length: 65536
compression:
  enabled: false

providers:
  ollama-local:
    base_url: http://localhost:11434/v1
    api_key: ollama
    request_timeout_seconds: 300
```

No `.env` keys needed — Ollama runs locally without auth.

**Option C — OpenRouter only:**

```bash
echo "OPENROUTER_API_KEY=sk-or-v1-..." >> ~/.hermes/.env
```

Hermes config (`~/.hermes/config.yaml`):
```yaml
model:
  default: "google/gemini-2.5-flash"
  provider: "openrouter"
  context_length: 1048576
compression:
  enabled: false
```

> **Important:** After changing providers, wipe `~/.hermes/auth.json` credential cache:
> ```bash
> echo '{"providers":{},"credential_pool":{},"active_provider":""}' > ~/.hermes/auth.json
> ```
> Hermes caches provider credentials in `auth.json` and will ignore `config.yaml` changes if stale credentials exist.

### Ollama model compatibility

Not all Ollama models support tool calling, which Hermes requires. Models that **work**:
- `qwen2.5-coder:7b` / `qwen2.5-coder:14b` — tool support, great for coding
- `llama3.2:latest` (3B) — tool support, general chat
- `qwen3:14b` — tool support, strong reasoning

Models that **don't work** (no tool calling):
- `llama3:latest` (8B) — returns "does not support tools" error
- `codellama:latest` — no tool support
- `gemma:latest` — no tool support

Check before pulling: `ollama show <model> --template | grep -i tool`

### 4. Register the hook in Claude Code settings

Add the snippet printed by the installer to your `.claude/settings.json`:

```json
{
  "hooks": {
    "postToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/.claude/hooks/sync-hermes.cjs"
          }
        ]
      }
    ]
  }
}
```

### 5. Run the initial bulk sync

Sync all existing agents, hooks, and skills in one shot:

```bash
node .claude/hooks/bulk-sync-hermes.cjs
```

### 6. Generate model launchers

After install, generate `.bat` launchers and desktop shortcuts for all supported models:

```bash
pnpm launchers        # .bat files + desktop shortcuts
pnpm launchers:bat-only  # .bat files only (no shortcuts)
```

This creates 8 launchers — 5 OpenRouter (cloud) + 3 Ollama (local):

| Shortcut | Provider | Model | Notes |
|----------|----------|-------|-------|
| Hermes Gemini | OpenRouter | `google/gemini-2.5-flash` | 1M context, fast |
| Hermes Codex | OpenRouter | `openai/gpt-4o` | GPT-4o via OpenRouter |
| Hermes Qwen | OpenRouter | `qwen/qwen3-30b-a3b` | Qwen3 30B MoE |
| Hermes DeepSeek 1M | OpenRouter | `deepseek/deepseek-v4-flash` | 1M context, MoE 284B/13B active, cheapest 1M option |
| Hermes DeepSeek Pro 1M | OpenRouter | `deepseek/deepseek-v4-pro` | 1M context, 1.6T/49B active MoE, premium tier |
| Hermes Ollama Coder14B | Ollama local | `qwen2.5-coder:14b` | Best local coding model |
| Hermes Ollama Coder7B | Ollama local | `qwen2.5-coder:7b` | Lighter coding model |
| Hermes Ollama Llama3 | Ollama local | `llama3.2:latest` | General chat, 3B |

Each launcher runs directly in your current terminal window via WSL.

**Custom launchers:** Edit the `LAUNCHERS` array in `launchers/generate-launchers.cjs` to add your own models — any model available on OpenRouter or pulled in Ollama works.

### 7. Verify

```bash
wsl -d Ubuntu -- ls ~/.hermes/skills/
# Expected: cc-agents  cc-hooks  cc-skills

# Or double-click any Hermes shortcut on your Desktop
```

---

## Provider Resolution Order

Hermes resolves providers in this priority (highest wins):

1. `~/.hermes/auth.json` → `credential_pool` (cached tokens)
2. `~/.hermes/auth.json` → `active_provider`
3. `~/.hermes/.env` auto-detection (`OPENROUTER_API_KEY`, `OPENAI_API_KEY`)
4. `~/.hermes/config.yaml` → `model.provider` + `model.base_url`

**This means `auth.json` overrides everything.** If you change providers in `config.yaml` but Hermes still uses the old one, wipe `auth.json` (see step 3 above).

The `base_url` field in `config.yaml` is the real routing control — it determines where API calls go regardless of the `provider` name.

---

## Discord Gateway Bot

Hermes includes a Discord gateway bot that responds to messages in configured channels.

```bash
# Add to ~/.hermes/.env
DISCORD_BOT_TOKEN=your_bot_token
DISCORD_HOME_CHANNEL=your_channel_id
DISCORD_FREE_RESPONSE_CHANNELS=your_channel_id

# Start gateway in tmux (persistent)
wsl -d Ubuntu -- bash -c "tmux new-session -d -s hermes-gw 'hermes gateway run 2>&1 | tee ~/.hermes/logs/gateway.log'"

# Or use the Windows launcher
# Copy hermes-launcher.bat to Desktop for one-click startup
```

The gateway requires a model that supports tool use. OpenRouter models (e.g. `google/gemini-2.5-flash`) support this out of the box. Ollama models may not support tool use depending on the model.

---

## Configuration

All settings are optional — the hook auto-detects your WSL username and uses generic category names by default.

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `HERMES_WSL_DISTRO` | `Ubuntu` | WSL distro to sync into |
| `HERMES_WSL_USER` | auto-detected | WSL username (via `wsl whoami`) |
| `HERMES_CATEGORY_AGENTS` | `cc-agents` | Hermes skills category for agents |
| `HERMES_CATEGORY_HOOKS` | `cc-hooks` | Hermes skills category for hooks |
| `HERMES_CATEGORY_SKILLS` | `cc-skills` | Hermes skills category for skills |

Set them in your shell profile or prepend to the node command:

```bash
HERMES_WSL_USER=alice HERMES_CATEGORY_AGENTS=my-agents node bulk-sync-hermes.cjs
```

---

## How It Works

### Auto-sync hook (`sync-hermes.cjs`)

A Claude Code **PostToolUse Write|Edit** hook. Every time Claude writes or edits a file, it checks if the file is an agent, hook, or skill. If so:

1. Reads the file content
2. Wraps it in a `SKILL.md` envelope with metadata
3. Writes to a Windows temp file
4. Uses `wsl -- bash -c "cp ..."` to copy it into `~/.hermes/skills/<category>/<name>/`
5. 5-second per-file debounce prevents redundant syncs on burst edits
6. Always exits 0 — never blocks Claude Code writes

The **Windows temp -> WSL copy** strategy avoids all bash escaping issues with complex file content.

### Bulk sync (`bulk-sync-hermes.cjs`)

A standalone script that walks your entire `.claude/` directory tree and syncs everything at once. Run once on setup, or any time you want to re-sync everything.

Auto-detects your `.claude/` directory from:
1. `<cwd>/.claude`
2. `%USERPROFILE%/.claude`
3. `~/.claude`
4. `CLAUDE_CONFIG_DIR` env var

Or pass `--dir` explicitly.

---

## Claude Code Integrations

### /paste Plugin

The Claude Code `/paste` plugin gives Claude access to a 3931-prompt library directly in conversation. Install it to unlock `paste_search`, `paste_use`, `paste_featured`, `paste_random`, `paste_browse`, `paste_stats`, `paste_copy`, and `paste_help` tools.

Once installed, you can ask Claude things like:
- `/paste search refactoring` — find prompts by keyword
- `/paste featured` — see curated top prompts
- `/paste random` — get a random prompt
- `/paste browse` — browse all categories

> The paste plugin is especially useful alongside Hermes — paste prompts can seed Hermes memory, define agent personas, or provide structured instructions for skill workflows.

---

## Autoresearch Integration

The `autoresearch/` directory adds LLM-powered hypothesis generation to the autoresearch measurement loop. Measures stay deterministic — LLMs only enter at the **plan** phase.

### Provider Chain

| Priority | Provider | Model | Cost | Latency |
|----------|----------|-------|------|---------|
| 1 | Ollama | qwen3:14b | Free (local) | ~2-12s |
| 2 | OpenRouter | google/gemini-2.5-flash | Free tier | ~2s |
| 3 | Hermes CLI | (inherits config.yaml model) | Depends on config | ~8s |

### Benchmark (2026-05-21)

```
5 PASS / 0 WARN / 0 FAIL — all providers operational
  ollama: 2.3s | openrouter: 2.3s | hermes: 9.5s
```

### Quick Start

```bash
# 1. Configure providers (Ollama is default — no key needed)
pnpm hermes-config

# 2. (Optional) Add OpenRouter key for fallback
echo "OPENROUTER_API_KEY=sk-or-v1-..." >> .env

# 3. Run the benchmark to verify all providers
pnpm benchmark

# 4. Save JSON report for tracking
pnpm benchmark:json
```

### Creating a Domain Planner

```bash
cp autoresearch/measures/_planner-template.cjs \
   scripts/autoresearch/measures/my-domain-planner.cjs
```

Edit `DOMAIN_NAME` and `buildPrompt()` — the harness auto-discovers `<metric>-planner.cjs` files.

See [docs/autoresearch-hermes-playbook.md](docs/autoresearch-hermes-playbook.md) for the full architecture, setup guide, and troubleshooting.

---

## Troubleshooting

### Ollama models route to OpenRouter instead of localhost
**Root cause:** `OPENAI_API_KEY` is set in `~/.hermes/.env`. Hermes uses this key for the `custom` provider, and it takes precedence over the `ollama-local` provider's `api_key` field. **Fix:** Comment out or remove `OPENAI_API_KEY` from `~/.hermes/.env`. OpenRouter uses `OPENROUTER_API_KEY` (separate key), so commenting out `OPENAI_API_KEY` doesn't break OpenRouter models.

### Ollama model hangs / times out
Small Ollama models (7B, 14B) can be slow on the first request because Ollama needs to load the model into memory. Pre-warm the model: `ollama run qwen2.5-coder:7b "hi"`. Subsequent requests are fast. Also, Hermes sends tool definitions in every request — models under 3B may struggle with the payload size.

### "does not support tools" error
The Ollama model doesn't support tool calling. Switch to a model that does: `qwen2.5-coder:7b`, `qwen2.5-coder:14b`, `llama3.2:latest`, or `qwen3:14b`. See the [Ollama model compatibility](#ollama-model-compatibility) table.

### Hermes ignores my config.yaml changes
Wipe the credential cache: `echo '{"providers":{},"credential_pool":{},"active_provider":""}' > ~/.hermes/auth.json`

### "context window too small" / compression model errors
Set `compression: enabled: false` in config.yaml. Hermes requires 64K minimum context for both main and compression models — disabling compression avoids this.

### Slow responses (minutes instead of seconds)
Check `hermes doctor` output. Common cause: Hermes is retrying a dead provider (3 attempts x exponential backoff) before falling through to the configured one. Fix by wiping auth.json and ensuring config.yaml points to the correct base_url.

### "No LLM provider configured"
Hermes needs either: (a) `OPENROUTER_API_KEY` in .env, or (b) a `providers:` block in config.yaml with valid base_url/api_key, or (c) a valid `active_provider` in auth.json.

### AMD GPU (RDNA4) not detected by Ollama
Ollama v0.18.x doesn't support RDNA4 (RX 9060 XT). CPU inference works fine. Check for Ollama updates — ROCm support is being added.

---

## Files

```
claude-hermes-bridge/
├── README.md
├── PRODUCTION_GUIDE.md              Full Hermes + Windows/WSL2 deployment guide
├── package.json                     pnpm project file
├── hermes-chat.bat                  Desktop shortcut — double-click to open Hermes chat (default model)
├── hermes-deepseek.bat              Shortcut — Hermes with DeepSeek V4 Flash (1M context)
├── sync/
│   ├── sync-hermes.cjs              PostToolUse auto-sync hook
│   ├── bulk-sync-hermes.cjs         One-time bulk sync script
│   └── install.sh                   Full installer (installs Hermes + hooks + Desktop shortcut)
├── launchers/
│   └── generate-launchers.cjs       Generates .bat + desktop shortcuts for all models
├── autoresearch/
│   ├── lib/
│   │   └── llm.cjs                  LLM client — provider fallback chain
│   ├── measures/
│   │   └── _planner-template.cjs    Copy + customize for your domain
│   ├── benchmark.cjs                QA benchmark (connectivity, completion, JSON)
│   └── hermes-config.sh             One-time Hermes provider setup
└── docs/
    └── autoresearch-hermes-playbook.md  Full integration playbook
```

---

## Production Guide

See [PRODUCTION_GUIDE.md](PRODUCTION_GUIDE.md) for the complete setup guide covering:

- Installing Hermes on WSL2 Ubuntu
- Configuring Ollama as the default local provider
- Setting up OpenRouter as automatic fallback
- Discord gateway bot integration
- tmux persistent service setup
- Provider resolution order and auth.json gotchas
- Security hardening
- QA checklist
- Backup strategy
- Useful commands reference

---

## Platform Notes

**Currently Windows-only** (requires `wsl` command).

Linux/Mac users: replace the `syncToHermes()` function in `sync-hermes.cjs` with a direct `fs.mkdirSync` + `fs.writeFileSync` call — no WSL needed, just write straight to `~/.hermes/skills/`.

```javascript
// Linux/Mac replacement for syncToHermes():
function syncToHermes(name, content, category) {
  const skillDir = path.join(os.homedir(), '.hermes', 'skills', category, name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf8');
}
```

---

## Requirements

- Node.js >= 18
- Windows 11 with WSL2
- Hermes Agent v0.14.0+ in WSL (`~/.hermes/`)
- Claude Code CLI
- **Local inference (optional):** Ollama with qwen3:14b or similar
- **Cloud inference (optional):** OpenRouter API key (free tier available)

---

## License

MIT
