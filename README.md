# Claude Hermes Bridge

Auto-sync your Claude Code agents, hooks, and skills to [Hermes Agent](https://github.com/NousResearch/hermes-agent) running in WSL2.

Every time you write or edit a Claude Code agent, hook, or skill file, a PostToolUse hook fires and the file lands in Hermes's `~/.hermes/skills/` directory — immediately available to the Hermes runtime.

Also includes a **production deployment guide** for getting Hermes running on Windows + WSL2, and an **autoresearch integration** for LLM-powered hypothesis generation.

**Provider defaults:** Ollama (local, private, zero cost) is the primary provider. OpenRouter is the automatic fallback for when Ollama is unavailable or you need models with larger context windows (e.g. Gemini 2.5 Flash with 1M context). No external API key required for basic local use.

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

- Windows 11 with WSL2 (Ubuntu)
- [Hermes Agent](https://github.com/NousResearch/hermes-agent) installed in WSL (`~/.hermes/`)
- Node.js available in your Windows PATH
- Claude Code CLI

### 2. One-shot install

```bash
git clone https://github.com/DevCraftXCoder/claude-hermes-bridge.git
cd claude-hermes-bridge
pnpm install
```

This sets up the sync hooks and configures Hermes with correct defaults:
- **Primary model:** `qwen3:14b` via Ollama (local, free, no API key needed)
- **Fallback model:** `google/gemini-2.5-flash` via OpenRouter (free tier, 1M context)
- **Compression:** disabled (avoids 64K context window requirement on compression model)
- **Context length:** 65536 minimum (Hermes hard requirement)

### 3. Configure your LLM provider

**Option A — Ollama only (default, no API key needed):**

```bash
# Make sure Ollama is running
ollama serve

# Pull a model (14B recommended for CPU inference)
ollama pull qwen3:14b
```

Hermes config (`~/.hermes/config.yaml`):
```yaml
model:
  default: "qwen3:14b"
  provider: "custom"
  base_url: "http://localhost:11434/v1"
  context_length: 65536
compression:
  enabled: false
```

Hermes env (`~/.hermes/.env`):
```bash
OPENAI_API_KEY=ollama
OPENAI_BASE_URL=http://localhost:11434/v1
```

**Option B — OpenRouter (faster, larger context, free tier available):**

```bash
# Add your OpenRouter key
echo "OPENROUTER_API_KEY=sk-or-v1-..." >> ~/.hermes/.env
```

Hermes config (`~/.hermes/config.yaml`):
```yaml
model:
  default: "google/gemini-2.5-flash"
  provider: "openrouter"
  base_url: "https://openrouter.ai/api/v1"
  context_length: 1048576
compression:
  enabled: false
```

> **Important:** After changing providers, wipe `~/.hermes/auth.json` credential cache:
> ```bash
> echo '{"providers":{},"credential_pool":{},"active_provider":""}' > ~/.hermes/auth.json
> ```
> Hermes caches provider credentials in `auth.json` and will ignore `config.yaml` changes if stale credentials exist.

### 4. Install the sync hook

```bash
bash sync/install.sh

# Or specify a path explicitly
bash sync/install.sh --dir "C:/Users/YourName/YourProject/.claude"
```

### 5. Register in Claude Code settings

Add to your `.claude/settings.json`:

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

### 6. Run the initial bulk sync

Sync all existing agents, hooks, and skills in one shot:

```bash
node .claude/hooks/bulk-sync-hermes.cjs
```

### 7. Verify

```bash
wsl -d Ubuntu -- ls ~/.hermes/skills/
# Expected: cc-agents  cc-hooks  cc-skills

wsl -d Ubuntu -- bash -lc "hermes chat"
# Should respond within seconds (Ollama) or ~2s (OpenRouter)
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

### Hermes ignores my config.yaml changes
Wipe the credential cache: `echo '{"providers":{},"credential_pool":{},"active_provider":""}' > ~/.hermes/auth.json`

### "context window too small" / compression model errors
Set `compression: enabled: false` in config.yaml. Hermes requires 64K minimum context for both main and compression models — disabling compression avoids this.

### Slow responses (minutes instead of seconds)
Check `hermes doctor` output. Common cause: Hermes is retrying a dead provider (3 attempts x exponential backoff) before falling through to the configured one. Fix by wiping auth.json and ensuring config.yaml points to the correct base_url.

### "No LLM provider configured"
Hermes needs either: (a) `OPENROUTER_API_KEY` in .env, or (b) `OPENAI_API_KEY` + `OPENAI_BASE_URL` in .env, or (c) a valid `active_provider` in auth.json. The simplest fix: add `OPENAI_API_KEY=ollama` and `OPENAI_BASE_URL=http://localhost:11434/v1` to `~/.hermes/.env`.

### AMD GPU (RDNA4) not detected by Ollama
Ollama v0.18.x doesn't support RDNA4 (RX 9060 XT). CPU inference works fine. Check for Ollama updates — ROCm support is being added.

---

## Files

```
claude-hermes-bridge/
├── README.md
├── PRODUCTION_GUIDE.md              Full Hermes + Windows/WSL2 deployment guide
├── package.json                     pnpm project file
├── sync/
│   ├── sync-hermes.cjs              PostToolUse auto-sync hook
│   ├── bulk-sync-hermes.cjs         One-time bulk sync script
│   └── install.sh                   Quick installer
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
