# Claude Hermes Bridge

Auto-sync your Claude Code agents, hooks, and skills to [Hermes Agent](https://github.com/NousResearch/hermes-agent) running in WSL2.

Every time you write or edit a Claude Code agent, hook, or skill file, a PostToolUse hook fires and the file lands in Hermes's `~/.hermes/skills/` directory — immediately available to the Hermes runtime.

Also includes a **production deployment guide** for getting Hermes running on Windows + WSL2.

**Provider recommendation:** Use **OpenRouter** with `openrouter/owl-alpha` as your default provider. It supports tool use (required for Discord gateway), responds in seconds, and works on any hardware. Ollama (local CPU) works for offline/private work. **Nous Portal is NOT recommended** — it does not support tool use and causes HTTP 404 on every Discord message.

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

### 2. Install the sync hook

```bash
# Clone this repo
git clone https://github.com/DevCraftXCoder/claude-hermes-bridge.git
cd claude-hermes-bridge

# Run installer (auto-detects your .claude dir)
bash sync/install.sh

# Or specify a path explicitly
bash sync/install.sh --dir "C:/Users/YourName/YourProject/.claude"
```

The installer copies `sync-hermes.cjs` and `bulk-sync-hermes.cjs` into your `.claude/hooks/` directory and prints the `settings.json` registration snippet.

### 3. Register in Claude Code settings

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

### 4. Run the initial bulk sync

Sync all existing agents, hooks, and skills in one shot:

```bash
node .claude/hooks/bulk-sync-hermes.cjs
```

### 5. Verify

```bash
wsl -d Ubuntu -- ls ~/.hermes/skills/
# Expected: cc-agents  cc-hooks  cc-skills

wsl -d Ubuntu -- ls ~/.hermes/skills/cc-agents | wc -l
# Number of agents synced
```

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

The **Windows temp → WSL copy** strategy avoids all bash escaping issues with complex file content.

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

**Install the plugin** via Claude Code's plugin manager (or manually via your Claude Code settings). After installation, Claude will have access to all `/paste` tools in every session automatically.

> The paste plugin is especially useful alongside Hermes — paste prompts can seed Hermes memory, define agent personas, or provide structured instructions for skill workflows.

---

## Autoresearch ↔ Hermes LLM Integration

The `autoresearch/` directory adds LLM-powered hypothesis generation to the autoresearch measurement loop. Measures stay deterministic — LLMs only enter at the **plan** phase.

### Provider Chain

| Priority | Provider | Model | Cost | Latency |
|----------|----------|-------|------|---------|
| 1 | OpenRouter | Hermes 3 405B (via DeepInfra) | Free | ~2s |
| 2 | Ollama | qwen2.5-coder:14b | Free (local) | ~2-12s |
| 3 | Hermes CLI | openrouter/owl-alpha | Free | ~8s |

### Benchmark (2026-05-19)

```
5 PASS / 0 WARN / 0 FAIL — all 3 providers operational
  openrouter: 2.3s | ollama: 2.3s | hermes: 8s
```

### Quick Start

```bash
# 1. Add your OpenRouter key to .env
echo "OPENROUTER_API_KEY=sk-or-v1-..." > .env

# 2. Configure Hermes for autoresearch
pnpm hermes-config

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
│   │   └── llm.cjs                  LLM client — 3-provider fallback chain
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
- Configuring OpenRouter with owl-alpha (default)
- Setting up Ollama as a local offline fallback
- Discord gateway bot integration
- tmux persistent service setup
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

- Node.js ≥ 18
- Windows 11 with WSL2
- Hermes Agent v0.14.0+ in WSL (`~/.hermes/`)
- Claude Code CLI

---

## License

MIT
