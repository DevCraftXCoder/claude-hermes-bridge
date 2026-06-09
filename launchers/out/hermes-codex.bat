@echo off
REM hermes-codex.bat — Hermes CLI with OpenAI GPT-4o via OpenRouter
REM Provider: openrouter | Model: openai/gpt-4o

setlocal

echo [hermes-codex] Launching Hermes (openai/gpt-4o)...

where wt >nul 2>&1
if %ERRORLEVEL% == 0 (
    start "" wt.exe wsl -d Ubuntu -- bash -lc "export PATH=$HOME/.local/bin:$PATH && hermes chat --provider openrouter --model openai/gpt-4o"
) else (
    start "" cmd /k "wsl -d Ubuntu -- bash -lc \"export PATH=$HOME/.local/bin:$PATH && hermes chat --provider openrouter --model openai/gpt-4o\""
)

echo [hermes-codex] Launched. Check your terminal window.
echo [hermes-codex] Dashboard: http://localhost:4333
