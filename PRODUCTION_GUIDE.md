# Hermes Agent — Production Deployment Guide

Windows 11 + WSL2 + OpenRouter + Ollama + Discord

---

## Overview

This guide covers a production-grade Hermes Agent deployment on Windows using WSL2 Ubuntu. It uses **OpenRouter with `openrouter/owl-alpha` as the default provider** — a cloud inference service that supports tool use (required for Discord gateway), responds in seconds, and works on any hardware.

**Architecture:**

```text
Discord (your bot)
  ↓
Hermes Orchestrator (WSL2 Ubuntu ~/.hermes/)
  ↓
Routing Layer
  ├─ OpenRouter (DEFAULT — owl-alpha, supports tool use, required for Discord)
  ├─ Ollama local (secondary — localhost:11434, offline/private work)
  └─ Codex / worker agents
```

> **Nous Portal is NOT supported for Discord gateway.** Nous Portal does not support tool use (function calling). The Hermes Discord gateway sends 29 tools per request — Nous Portal returns HTTP 404 "Couldn't find that, sorry" on every message. Do not use Nous Portal if you want Discord to work.

**Official sources:**
- Hermes GitHub: https://github.com/NousResearch/hermes-agent
- Hermes Docs: https://hermes-agent.nousresearch.com/docs/
- Quickstart: https://hermes-agent.nousresearch.com/docs/getting-started/quickstart

---

## System Requirements

### Confirmed Working Configuration

- Windows 11 Home / Pro
- WSL2 Ubuntu (24.04 recommended)
- CPU-only (no GPU required when using OpenRouter)
- Ollama on Windows host, accessible from WSL via `localhost:11434`

### Recommended

- Windows 11
- WSL2 Ubuntu 24.04
- 32 GB RAM
- 100 GB free storage
- GPU optional (OpenRouter removes the GPU requirement)

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

**Select OpenRouter as the provider. Use `openrouter/owl-alpha` as the model.**

---

## Provider Priority

### 1. OpenRouter (Default — Set This First)

**This is the strongly recommended default provider. Required for Discord gateway.**

#### Why OpenRouter wins

| | OpenRouter (owl-alpha) | Ollama (local CPU) |
|--|------------------------|-------------------|
| **Discord gateway** | **Yes** — tool use supported | Yes — tool use supported |
| **Response time** | ~3–6 seconds | ~90–130 seconds on CPU |
| **GPU required** | No (cloud) | No (but CPU is slow) |
| **Cost** | Low (pay-per-token) | Free (electricity only) |
| **Tool use** | Full support | Full support |

**The critical requirement:** The Hermes Discord gateway sends 29 tools per API request. Your provider **must** support tool use (function calling). OpenRouter supports it. Ollama supports it. Nous Portal does NOT — it returns HTTP 404 on every Discord message.

**The speed advantage:** A 5-second response vs a 124-second response changes how you work. Multi-step tasks that take 20 minutes on local CPU complete in 2 minutes on OpenRouter.

Setup:
1. Create an account at https://openrouter.ai/
2. Add your API key to `~/.hermes/.env`:
   ```env
   OPENROUTER_API_KEY=your_key_here
   ```
3. Run `hermes model` and select OpenRouter
4. Set model to `openrouter/owl-alpha`

Or edit `~/.hermes/config.yaml` directly:

```yaml
model:
  default: "openrouter/owl-alpha"
  provider: "auto"
  base_url: "https://openrouter.ai/api/v1"
```

**Minimum context requirement:** 64,000 tokens. Verify your selected model meets this.

---

### 2. Ollama Local (Secondary — Offline/Private Work)

Use Ollama for **offline work or private/sensitive tasks** where you can't send data to a cloud provider. Ollama supports tool use, so the Discord gateway works. Expect significantly slower responses on CPU-only hardware.

> **Performance note:** qwen3:14b and qwen2.5-coder:14b are solid models but not optimized for the Hermes agent protocol. Response times of 90–130+ seconds per turn are normal on CPU. For interactive use, OpenRouter is a dramatically better experience.

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

To switch to Ollama temporarily in `~/.hermes/config.yaml`:

```yaml
model:
  default: "qwen3:14b"
  provider: "ollama"
  base_url: "http://localhost:11434/v1"
```

---

### ⚠️ Nous Portal — NOT Recommended (Discord Incompatible)

**Nous Portal does not support tool use and will break the Discord gateway.**

Root cause: Every Discord message triggers an API call with 29 tools in the request body. Nous Portal returns HTTP 404 "Couldn't find that, sorry" on any request containing a `tools` array. HERMES will never respond to Discord messages on Nous Portal.

The only workaround is `discord: []` in `platform_toolsets` — which strips all tool access from Discord interactions, making Hermes unable to use memory, run tasks, or access any skills. This is not a viable production configuration.

**If you need a free provider:** Use Ollama locally. It's free, supports tool use, and works with Discord.

---

## Recommended Models

### OpenRouter (default — use this first)

| Purpose | Model |
|---------|-------|
| **Default agent (recommended)** | `openrouter/owl-alpha` |
| Extended context | `anthropic/claude-opus-4.6` (via OpenRouter) |
| Cost-efficient | `qwen/qwen3-32b` |
| Vision | `google/gemini-2.5-pro` |

### Ollama (offline / private fallback only)

| Purpose | Model |
|---------|-------|
| Fast agent | `qwen2.5-coder:14b` |
| Fast agent alt | `qwen3:14b` |
| Heavy planning | `qwen3:32b` |
| Low RAM | `mistral-small` |

> Expect 90–130s+ response times on CPU. Use OpenRouter for interactive work.

---

## Environment File (~/.hermes/.env)

Minimum required config:

```env
# OpenRouter — default provider (required for Discord gateway)
OPENROUTER_API_KEY=your_key_here

# Discord
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_FREE_RESPONSE_CHANNELS=your_channel_id_here

# Allow all Discord users to interact
GATEWAY_ALLOW_ALL_USERS=true

# Optional: Ollama fallback (offline/private work)
OLLAMA_HOST=http://localhost:11434
OLLAMA_CONTEXT_LENGTH=65536
```

Lock permissions:

```bash
chmod 600 ~/.hermes/.env
```

---

## config.yaml — Default Working Config

```yaml
model:
  default: "openrouter/owl-alpha"
  provider: "auto"
  base_url: "https://openrouter.ai/api/v1"

platform_toolsets:
  cli: [hermes-cli]
  telegram: [hermes-telegram]
  discord: [hermes-discord]    # keep this — DO NOT use discord: [] (breaks tool use)
  whatsapp: [hermes-whatsapp]
  slack: [hermes-slack]
```

> **Do NOT set `discord: []`** — this strips all tool access from Discord and makes Hermes unable to use memory, skills, or execute any tasks. Only required as a workaround for Nous Portal (which is not recommended). With OpenRouter or Ollama, `discord: [hermes-discord]` works correctly.

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

# 5. Dashboard
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

# 11. Config check — verify provider is NOT nous
grep -A3 "^model:" ~/.hermes/config.yaml
# Expected: openrouter/owl-alpha + provider: auto
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
[ ] OpenRouter API key in ~/.hermes/.env
[ ] config.yaml: default = "openrouter/owl-alpha"
[ ] config.yaml: provider = "auto", base_url = "https://openrouter.ai/api/v1"
[ ] config.yaml: discord: [hermes-discord] (NOT discord: [])
[ ] Active model context >= 64,000 tokens
[ ] Discord bot token in ~/.hermes/.env
[ ] DISCORD_FREE_RESPONSE_CHANNELS set
[ ] GATEWAY_ALLOW_ALL_USERS set (if open access desired)
[ ] Gateway running in tmux hermes-discord
[ ] Bot connected (verified in gateway.log)
[ ] Discord test message receives a response (verify in <6s with OpenRouter)
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
[ ] Nous Portal NOT configured as default provider
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

- Use OpenRouter as default (fast, supports tool use, Discord-compatible)
- Use `openrouter/owl-alpha` as the default model
- Fall back to Ollama for offline / private work (free, tool use supported)
- **Never use Nous Portal for Discord gateway** — no tool use support → HTTP 404
- Use `tmux hermes-discord` for persistent gateway operation
- Use a restart script for recoveries from Windows side
- Pin stable channel — never unstable nightly
- Audit logs weekly
- Keep `.env` chmod 600
- Back up `~/.hermes/` weekly
- Use sync-hermes.cjs to keep skills current automatically
