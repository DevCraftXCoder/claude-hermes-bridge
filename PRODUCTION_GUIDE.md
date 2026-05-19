# Hermes Agent — Production Deployment Guide

Windows 11 + WSL2 + Nous Portal + Ollama + Discord

---

## Overview

This guide covers a production-grade Hermes Agent deployment on Windows using WSL2 Ubuntu. It uses **Nous Portal as the default provider** — a free-tier cloud inference service that removes the GPU requirement entirely. Ollama serves as a local fallback for offline or private work.

**Architecture:**

```text
Discord (your bot)
  ↓
Hermes Orchestrator (WSL2 Ubuntu ~/.hermes/)
  ↓
Routing Layer
  ├─ Nous Portal (DEFAULT — free, no GPU required)
  ├─ Ollama local (secondary — localhost:11434)
  ├─ OpenRouter (paid fallback)
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
- CPU-only inference (no GPU required when using Nous Portal)
- Ollama on Windows host, accessible from WSL via `localhost:11434`

### Recommended

- Windows 11
- WSL2 Ubuntu 24.04
- 32 GB RAM
- 100 GB free storage
- GPU optional (Nous Portal removes the GPU requirement)

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

**Select Nous Portal as the first/default provider.**

---

## Provider Priority

### 1. Nous Portal (Default — Set This First)

**This is the recommended default provider.**

Advantages:
- Free tier available
- No local GPU required
- Fastest onboarding
- Works on CPU-only machines

Setup:
1. Run `hermes model`
2. Select Nous Portal
3. Sign in with your Nous account (or create one at nousresearch.com)
4. Select the free tier model

**Minimum context requirement:** 64,000 tokens. Verify your selected model meets this.

---

### 2. Ollama Local (Secondary)

Ollama runs on **Windows host** — accessed from WSL via `localhost:11434` (mirrored networking).

Install on Windows: https://ollama.com/

Pull recommended models (Windows terminal / PowerShell):

```powershell
ollama pull qwen2.5-coder:14b
ollama pull qwen3:14b
```

Add to `~/.hermes/.env`:

```env
OLLAMA_HOST=http://localhost:11434
OLLAMA_CONTEXT_LENGTH=65536
```

> Without 64k context, Hermes may loop, forget tasks, truncate plans, or fail memory operations.

---

### 3. OpenRouter (Fallback)

Create account: https://openrouter.ai/

Add to `~/.hermes/.env`:

```env
OPENROUTER_API_KEY=your_key_here
```

---

## Recommended Models

### Ollama

| Purpose | Model |
|---------|-------|
| Fast agent | `qwen2.5-coder:14b` |
| Fast agent alt | `qwen3:14b` |
| Heavy planning | `qwen3:32b` |
| Low RAM | `mistral-small` |

### OpenRouter

| Purpose | Model |
|---------|-------|
| Cheap orchestration | `qwen/qwen3-32b` |
| Premium coding | `anthropic/claude-opus` |
| Vision | `google/gemini-2.5-pro` |

---

## Environment File (~/.hermes/.env)

Minimum required config:

```env
# Provider
OLLAMA_HOST=http://localhost:11434
OLLAMA_CONTEXT_LENGTH=65536

# Discord
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_FREE_RESPONSE_CHANNELS=your_channel_id_here

# Allow all Discord users to interact
GATEWAY_ALLOW_ALL_USERS=true

# Optional fallback
OPENROUTER_API_KEY=your_key_here
```

Lock permissions:

```bash
chmod 600 ~/.hermes/.env
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
tmux new-session -d -s hermes-discord 'hermes gateway'
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
wsl -d Ubuntu -- bash -c "tmux kill-session -t hermes-discord 2>/dev/null; tmux new-session -d -s hermes-discord 'hermes gateway'; sleep 2; hermes gateway status"
pause
```

### WSL Restart Script (`hermes-restart.sh`)

Full restart from Claude Code or another Windows process:

```bash
#!/usr/bin/env bash
tmux kill-session -t hermes-discord 2>/dev/null || true
sleep 1
tmux new-session -d -s hermes-discord 'hermes gateway'
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

- Set request caps and daily budgets
- Prefer Nous Portal (free) before OpenRouter (paid)
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

# 3. Ollama reachable
curl -s http://localhost:11434/api/tags | grep -o '"name":"[^"]*"' | head -5
# Expected: at least one model listed

# 4. Dashboard
curl -s http://localhost:4333 > /dev/null && echo "PASS" || echo "FAIL"

# 5. Gateway status
hermes gateway status

# 6. tmux session
tmux list-sessions | grep hermes-discord

# 7. Discord log
tail -20 ~/.hermes/logs/gateway.log
# Look for: [Discord] Connected as <YourBot>

# 8. Skills synced
ls ~/.hermes/skills/

# 9. .env permissions
stat -c "%a" ~/.hermes/.env
# Expected: 600
```

Full QA in one pass:

```bash
echo "=== Hermes QA ===" && \
echo -n "[1] Version: " && hermes --version && \
echo -n "[2] Ollama: " && curl -sf http://localhost:11434/api/tags > /dev/null && echo "PASS" || echo "FAIL" && \
echo -n "[3] Dashboard: " && curl -sf http://localhost:4333 > /dev/null && echo "PASS" || echo "FAIL" && \
echo -n "[4] Gateway: " && hermes gateway status 2>&1 | head -1 && \
echo -n "[5] tmux: " && tmux list-sessions 2>/dev/null | grep hermes-discord && \
echo -n "[6] .env perms: " && stat -c "%a" ~/.hermes/.env && \
echo "=== QA Complete ==="
```

---

## Production Acceptance Checklist

```text
[ ] Hermes v0.14.0+ launches without error
[ ] Nous Portal configured as default provider
[ ] Active model context >= 64,000 tokens
[ ] Ollama reachable at localhost:11434
[ ] OpenRouter fallback configured (optional)
[ ] Discord bot token in ~/.hermes/.env
[ ] DISCORD_FREE_RESPONSE_CHANNELS set
[ ] GATEWAY_ALLOW_ALL_USERS set (if open access desired)
[ ] Gateway running in tmux hermes-discord
[ ] Bot connected (verified in gateway.log)
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

- Use Nous Portal as default (free, no GPU, zero local compute)
- Fall back to Ollama for offline / private work
- Use `tmux hermes-discord` for persistent gateway operation
- Use a restart script for recoveries from Windows side
- Pin stable channel — never unstable nightly
- Audit logs weekly
- Keep `.env` chmod 600
- Back up `~/.hermes/` weekly
- Use sync-hermes.cjs to keep skills current automatically
