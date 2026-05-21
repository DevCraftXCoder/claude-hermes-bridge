# Hermes Agent — Production Deployment Guide

Windows 11 + WSL2 + Ollama + OpenRouter + Discord

---

## Overview

This guide covers a production-grade Hermes Agent deployment on Windows using WSL2 Ubuntu. It uses **Ollama (`qwen3:14b`) as the primary provider** — free, local, no API key required, full tool use support. **OpenRouter (`google/gemini-2.5-flash`)** is the cloud fallback for faster responses when needed.

**Architecture:**

```text
Discord (your bot)
  ↓
Hermes Orchestrator (WSL2 Ubuntu ~/.hermes/)
  ↓
Routing Layer
  ├─ Ollama (PRIMARY — qwen3:14b, localhost:11434, free, full tool use)
  ├─ OpenRouter (FALLBACK — google/gemini-2.5-flash, 1M context, free tier)
  └─ Codex / worker agents
```

**Official sources:**
- Hermes GitHub: https://github.com/NousResearch/hermes-agent
- Hermes Docs: https://hermes-agent.nousresearch.com/docs/
- Quickstart: https://hermes-agent.nousresearch.com/docs/getting-started/quickstart

---

## System Requirements

### Confirmed Working Configuration

- Windows 11 Home / Pro
- WSL2 Ubuntu (24.04 recommended)
- CPU-only (no GPU required — Ollama runs on CPU, OpenRouter is cloud)
- Ollama on Windows host, accessible from WSL via `localhost:11434`

### Recommended

- Windows 11
- WSL2 Ubuntu 24.04
- 32 GB RAM
- 100 GB free storage
- GPU optional (both Ollama and OpenRouter work without GPU)

### Minimum

- 16 GB RAM
- 8-core CPU
- 50 GB free disk

---

## WSL2 Configuration

Run in PowerShell:

```powershell
notepad $env:USERPROFILE\.wslconfig
```

Recommended config:

```ini
[wsl2]
memory=16GB
processors=8
swap=8GB
localhostForwarding=true
```

> `localhostForwarding=true` is required for Ollama access from WSL (`localhost:11434` → Windows host).

Restart WSL after editing:

```powershell
wsl --shutdown
```

---

## Install Hermes Agent

Inside Ubuntu / WSL2:

```bash
# Review the script before running (recommended):
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | less

# Then install:
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
```

Add to PATH (add to `~/.bashrc` and `~/.profile`):

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Reload:

```bash
source ~/.bashrc
```

Verify install:

```bash
hermes doctor
```

Pin stable channel only:

```bash
hermes update --channel stable
```

> Do NOT auto-track nightly/unstable releases in production.

---

## Hermes Directory Structure

```text
~/.hermes/
  .env               ← secrets (chmod 600)
  config.yaml        ← general config
  sessions/          ← session history
  memory/            ← persistent memory
  skills/            ← installed skills
    cc-agents/       ← synced Claude Code agents (from this bridge)
    cc-hooks/        ← synced Claude Code hooks
    cc-skills/       ← synced Claude Code skills
```

---

## Model Provider Setup

Run the provider wizard:

```bash
hermes model
```

**Select Ollama as the primary provider. Use `qwen3:14b` as the model. Optionally configure OpenRouter (`google/gemini-2.5-flash`) as a fallback.**

---

## Provider Priority

### 1. Ollama (Primary — Free, Local, No API Key)

**Ollama is the default primary provider.** It runs locally on the Windows host, is completely free, supports full tool use (required for Discord gateway), and keeps all data on-device.

#### Why Ollama is primary

| | Ollama (qwen3:14b) | OpenRouter (gemini-2.5-flash) |
|--|-------------------|-------------------------------|
| **Discord gateway** | Yes — full tool use | Yes — full tool use |
| **Response time** | ~90–130 seconds on CPU | ~3–6 seconds |
| **GPU required** | No | No (cloud) |
| **Cost** | Free (electricity only) | Free tier available |
| **Context length** | 65,536 tokens | 1,048,576 tokens (1M) |
| **Privacy** | Full (local) | Cloud (data leaves device) |
| **Tool use** | Full support | Full support |

**The critical requirement:** The Hermes Discord gateway sends 29 tools per API request. Your provider **must** support tool use (function calling). Both Ollama and OpenRouter support it.

Ollama runs on **Windows host** — accessed from WSL via `localhost:11434` (mirrored networking).

Install on Windows: https://ollama.com/

Pull recommended models (Windows terminal / PowerShell):

```powershell
ollama pull qwen3:14b
ollama pull qwen2.5-coder:14b
```

Add to `~/.hermes/.env`:

```env
OLLAMA_HOST=http://localhost:11434
OLLAMA_CONTEXT_LENGTH=65536
```

> Without 64k context, Hermes may loop, forget tasks, truncate plans, or fail memory operations.

Configure in `~/.hermes/config.yaml`:

```yaml
model:
  default: "qwen3:14b"
  provider: "ollama"
  base_url: "http://localhost:11434/v1"
  context_length: 65536
```

**Minimum context requirement:** 64,000 tokens. Verify your selected model meets this.

---

### 2. OpenRouter (Fallback — Faster, 1M Context)

Use OpenRouter for **faster responses or tasks requiring very long context** (>64K tokens). The free tier of `google/gemini-2.5-flash` provides 1M context and fast response times.

> **Speed advantage:** A 5-second response vs a 124-second response changes how you work. Multi-step tasks that take 20 minutes on local CPU complete in 2 minutes on OpenRouter. Use as fallback when Ollama is too slow for interactive work.

Setup:
1. Create an account at https://openrouter.ai/
2. Add your API key to `~/.hermes/.env`:
   ```env
   OPENROUTER_API_KEY=your_key_here
   ```
3. Run `hermes model` and select OpenRouter when needed
4. Set model to `google/gemini-2.5-flash`

Or edit `~/.hermes/config.yaml` directly:

```yaml
model:
  default: "google/gemini-2.5-flash"
  provider: "auto"
  base_url: "https://openrouter.ai/api/v1"
  context_length: 1048576
```

---

## Recommended Models

### Ollama (primary — local, free)

| Purpose | Model |
|---------|-------|
| **Default agent (recommended)** | `qwen3:14b` |
| Code-heavy tasks | `qwen2.5-coder:14b` |
| Heavy planning | `qwen3:32b` |
| Low RAM | `mistral-small` |

> Expect 90–130s+ response times on CPU. Use OpenRouter fallback for interactive work when speed matters.

### OpenRouter (fallback — cloud, fast)

| Purpose | Model |
|---------|-------|
| **Default fallback (recommended)** | `google/gemini-2.5-flash` (1M context, free tier) |
| Extended context | `anthropic/claude-opus-4.6` |
| Cost-efficient | `qwen/qwen3-32b` |
| Vision | `google/gemini-2.5-pro` |

---

## Environment File (~/.hermes/.env)

Minimum required config:

```env
# Ollama — primary provider (local, free, no API key needed)
OLLAMA_HOST=http://localhost:11434
OLLAMA_CONTEXT_LENGTH=65536

# Discord
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_FREE_RESPONSE_CHANNELS=your_channel_id_here

# Allow all Discord users to interact
GATEWAY_ALLOW_ALL_USERS=true

# Optional: OpenRouter fallback (cloud, faster responses, 1M context)
OPENROUTER_API_KEY=your_key_here
```

Lock permissions:

```bash
chmod 600 ~/.hermes/.env
```

---

## config.yaml — Default Working Config

```yaml
model:
  default: "qwen3:14b"
  provider: "ollama"
  base_url: "http://localhost:11434/v1"
  context_length: 65536

platform_toolsets:
  cli: [hermes-cli]
  telegram: [hermes-telegram]
  discord: [hermes-discord]    # keep this — DO NOT use discord: [] (breaks tool use)
  whatsapp: [hermes-whatsapp]
  slack: [hermes-slack]
```

> **Do NOT set `discord: []`** — this strips all tool access from Discord and makes Hermes unable to use memory, skills, or execute any tasks. With Ollama or OpenRouter, `discord: [hermes-discord]` works correctly.

To switch to OpenRouter as primary (when you need faster responses or >64K context):

```yaml
model:
  default: "google/gemini-2.5-flash"
  provider: "auto"
  base_url: "https://openrouter.ai/api/v1"
  context_length: 1048576
```

---

## Discord Integration

### Architecture

Use **Discord Gateway Bot** for interactive conversations with memory and session continuity.

> Webhooks are notification-only — they do NOT provide memory, sessions, or tool routing.

### Bot Setup

1. Go to https://discord.com/developers/applications
2. Create a new application
3. Create a bot under the application
4. Enable intents:
   - Message Content Intent
   - Server Members Intent
5. Copy the bot token
6. Invite the bot to your server with appropriate permissions
7. Add the token to `~/.hermes/.env` as `DISCORD_BOT_TOKEN`
8. Set your channel ID: `DISCORD_FREE_RESPONSE_CHANNELS=<channel_id>`

### Start Gateway

```bash
hermes gateway
```

Check status:

```bash
hermes gateway status
```

View logs:

```bash
cat ~/.hermes/logs/gateway.log
```

---

## Production Service Mode

Run Hermes in a persistent **tmux session** — not a foreground terminal.

```bash
tmux new-session -d -s hermes-discord 'hermes gateway run'
```

Reattach:

```bash
tmux attach -t hermes-discord
```

Check if running:

```bash
tmux list-sessions | grep hermes-discord
hermes gateway status
```

---

## Windows Launchers

Create these batch files on Windows to start/restart Hermes without opening WSL manually.

### CLI Launcher (`hermes-cli.bat`)

Opens an interactive Hermes CLI session:

```bat
@echo off
wt -d . wsl -d Ubuntu -- bash -c "cd ~ && hermes"
```

### Gateway Launcher (`hermes-gateway.bat`)

Starts/restarts the Discord gateway daemon:

```bat
@echo off
wsl -d Ubuntu -- bash -c "tmux kill-session -t hermes-discord 2>/dev/null; tmux new-session -d -s hermes-discord 'hermes gateway run'; sleep 2; hermes gateway status"
pause
```

### WSL Restart Script (`hermes-restart.sh`)

Full restart from Claude Code or another Windows process:

```bash
#!/usr/bin/env bash
tmux kill-session -t hermes-discord 2>/dev/null || true
sleep 1
tmux new-session -d -s hermes-discord 'hermes gateway run'
sleep 2
hermes gateway status
```

Run from Windows:

```powershell
wsl -d Ubuntu -- bash /path/to/hermes-restart.sh
```

---

## Claude Code → Hermes Skill Sync

See [README.md](README.md) for the full sync setup.

What gets synced automatically via the PostToolUse hook:

| Source | Hermes destination |
|--------|--------------------|
| `.claude/agents/*.md` | `~/.hermes/skills/cc-agents/<name>/SKILL.md` |
| `.claude/hooks/*.cjs` | `~/.hermes/skills/cc-hooks/<name>/SKILL.md` |
| `.claude/skills/**/SKILL.md` | `~/.hermes/skills/cc-skills/<name>/SKILL.md` |

One-time bulk sync of all existing files:

```bash
node .claude/hooks/bulk-sync-hermes.cjs
```

---

## Dashboard

HTTP dashboard at: `http://localhost:4333`

Launch manually:

```bash
hermes dashboard
```

Or TUI mode:

```bash
hermes --tui
```

---

## Security Hardening

**Never expose:**
- `~/.hermes/.env`
- Discord bot tokens
- API keys

Lock env file:

```bash
chmod 600 ~/.hermes/.env
```

Dashboard is localhost-only by default. If you want to be sure:

```bash
sudo ufw deny 4333
```

Do not expose the dashboard publicly without:
- A reverse proxy
- Authentication
- HTTPS

---

## Backup Strategy

```bash
tar -czf hermes_backup_$(date +%F).tar.gz ~/.hermes
```

Minimum backup contents:
- `~/.hermes/config.yaml`
- `~/.hermes/.env` (keep an offline copy of secrets separately)
- `~/.hermes/sessions/`
- `~/.hermes/memory/`
- `~/.hermes/skills/`

Recommended: weekly backup, copy off-machine.

---

## Session Recovery

```bash
hermes doctor
hermes repair
```

If lock file issue:

```bash
rm ~/.hermes/session.lock
```

Restart gateway:

```bash
tmux kill-session -t hermes-discord 2>/dev/null; \
tmux new-session -d -s hermes-discord 'hermes gateway'
```

---

## Brain Dump (First Session)

On your first Discord conversation with Hermes, provide:
- Your name and role
- Active projects and their tech stacks
- Tools you use daily
- Workflows you want to automate
- Goals and automation interests

> Do NOT keep this short. Hermes memory quality depends on initialization depth.

After brain dump, ask:

```text
Based on what you know about me:
- what workflows should we automate?
- what skills should we install?
- what agents should we create?
- what routines should run daily?
```

---

## Autonomous Guardrails (Initial Deployment)

Restrict until validated:

```text
- max 2 workers
- no unrestricted computer use
- require confirmations on destructive actions
- disable recursive loops
```

Especially be careful with:
- Browser control
- Shell execution
- Autonomous coding
- File deletion

---

## API Cost Protection

- Set request caps and daily budgets on OpenRouter
- Fall back to Ollama for offline / private work (free)
- Avoid recursive loops and uncontrolled background agents
- Set worker limits

---

## QA Checklist

Run these inside WSL to verify a healthy deployment:

```bash
# 1. Version
hermes --version
# Expected: 0.14.0 or higher

# 2. Diagnostics
hermes doctor
# Expected: all checks green

# 3. OpenRouter reachable
curl -s -o /dev/null -w "%{http_code}" https://openrouter.ai/api/v1/models \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" | grep -q "200" && echo "OpenRouter: PASS" || echo "OpenRouter: FAIL"

# 4. Ollama reachable (optional)
curl -s http://localhost:11434/api/tags | grep -o '"name":"[^"]*"' | head -5

# 5. Dashboard reachable (returns dashboard SPA HTML — HTTP 200 means service is up)
curl -s http://localhost:4333 > /dev/null && echo "PASS" || echo "FAIL"

# 6. Gateway status
hermes gateway status

# 7. tmux session
tmux list-sessions | grep hermes-discord

# 8. Discord log
tail -20 ~/.hermes/logs/gateway.log
# Look for: [Discord] Connected as <YourBot>

# 9. Skills synced
ls ~/.hermes/skills/

# 10. .env permissions
stat -c "%a" ~/.hermes/.env
# Expected: 600

# 11. Config check — verify model and provider
grep -A4 "^model:" ~/.hermes/config.yaml
# Expected (Ollama primary): qwen3:14b + provider: ollama
# Expected (OpenRouter fallback): google/gemini-2.5-flash + provider: auto
```

Full QA in one pass:

```bash
echo "=== Hermes QA ===" && \
echo -n "[1] Version: " && hermes --version && \
echo -n "[2] OpenRouter: " && curl -sf -o /dev/null -H "Authorization: Bearer $OPENROUTER_API_KEY" https://openrouter.ai/api/v1/models && echo "PASS" || echo "FAIL" && \
echo -n "[3] Dashboard: " && curl -sf http://localhost:4333 > /dev/null && echo "PASS" || echo "FAIL" && \
echo -n "[4] Gateway: " && hermes gateway status 2>&1 | head -1 && \
echo -n "[5] tmux: " && tmux list-sessions 2>/dev/null | grep hermes-discord && \
echo -n "[6] .env perms: " && stat -c "%a" ~/.hermes/.env && \
echo -n "[7] Provider: " && grep "provider:" ~/.hermes/config.yaml | head -1 && \
echo "=== QA Complete ==="
```

---

## Production Acceptance Checklist

```text
[ ] Hermes v0.14.0+ launches without error
[ ] Ollama running on Windows host (localhost:11434 reachable from WSL)
[ ] qwen3:14b pulled in Ollama
[ ] config.yaml: default = "qwen3:14b"
[ ] config.yaml: provider = "ollama", base_url = "http://localhost:11434/v1"
[ ] config.yaml: context_length = 65536
[ ] config.yaml: discord: [hermes-discord] (NOT discord: [])
[ ] Active model context >= 64,000 tokens
[ ] Discord bot token in ~/.hermes/.env
[ ] DISCORD_FREE_RESPONSE_CHANNELS set
[ ] GATEWAY_ALLOW_ALL_USERS set (if open access desired)
[ ] Gateway running in tmux hermes-discord
[ ] Bot connected (verified in gateway.log)
[ ] Discord test message receives a response
[ ] Memory persists across sessions
[ ] Dashboard accessible at localhost:4333
[ ] Windows launchers created (cli.bat, gateway.bat, restart.sh)
[ ] sync-hermes.cjs registered in Claude Code settings.json
[ ] Bulk sync completed (all agents/hooks/skills in ~/.hermes/skills/)
[ ] .env is chmod 600
[ ] localhostForwarding=true in .wslconfig
[ ] Stable channel pinned
[ ] Backups configured
[ ] Brain dump completed in Discord
[ ] (Optional) OpenRouter API key in ~/.hermes/.env for cloud fallback
```

---

## Useful Commands

```bash
hermes                         # Launch interactive
hermes --continue              # Continue last session
hermes --tui                   # Open TUI
hermes doctor                  # Diagnostics
hermes repair                  # Auto-repair
hermes model                   # Provider setup wizard
hermes gateway                 # Start Discord gateway daemon
hermes gateway status          # Check gateway health
hermes dashboard               # Web dashboard (localhost:4333)
hermes update --channel stable # Update (stable channel only)
hermes memory list             # List memory entries
```

---

## Config Locations

```text
~/.hermes/.env         ← secrets
~/.hermes/config.yaml  ← general config
```

Prefer the CLI over manual edits:

```bash
hermes config set
```

---

## Production Recommendations

- Use Ollama (`qwen3:14b`) as default (free, local, full tool use, Discord-compatible)
- Use OpenRouter (`google/gemini-2.5-flash`) as cloud fallback for faster responses or >64K context
- Set `context_length: 65536` for Ollama, `context_length: 1048576` for OpenRouter/Gemini Flash
- Disable Hermes compression if using the minimum 64K context — it requires a separate model call that reduces usable context
- Use `tmux hermes-discord` for persistent gateway operation
- Use a restart script for recoveries from Windows side
- Pin stable channel — never unstable nightly
- Audit logs weekly
- Keep `.env` chmod 600
- Back up `~/.hermes/` weekly
- Use sync-hermes.cjs to keep skills current automatically
