@echo off
REM hermes-deepseek.bat — Hermes CLI with DeepSeek V4 Flash (1M context) via OpenRouter
REM Provider: openrouter | Model: deepseek/deepseek-v4-flash
REM Requires: OPENROUTER_API_KEY in ~/.hermes/.env

setlocal

echo [hermes-deepseek] Launching Hermes (deepseek/deepseek-v4-flash)...
echo [hermes-deepseek] Context: 1M tokens

where wt >nul 2>&1
if %ERRORLEVEL% == 0 (
    start "" wt.exe wsl -d Ubuntu -- bash -lc "export PATH=$HOME/.local/bin:$PATH && hermes chat --provider openrouter --model deepseek/deepseek-v4-flash"
) else (
    start "" cmd /k "wsl -d Ubuntu -- bash -lc \"export PATH=$HOME/.local/bin:$PATH && hermes chat --provider openrouter --model deepseek/deepseek-v4-flash\""
)

echo [hermes-deepseek] Launched. Check your terminal window.
echo [hermes-deepseek] Dashboard: http://localhost:4333
