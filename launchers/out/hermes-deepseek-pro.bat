@echo off
REM hermes-deepseek-pro.bat — Hermes CLI with DeepSeek V4 Pro (1M context, 1.6T MoE) via OpenRouter
REM Provider: openrouter | Model: deepseek/deepseek-v4-pro

setlocal

echo [hermes-deepseek-pro] Launching Hermes (deepseek/deepseek-v4-pro)...

where wt >nul 2>&1
if %ERRORLEVEL% == 0 (
    start "" wt.exe wsl -d Ubuntu -- bash -lc "export PATH=$HOME/.local/bin:$PATH && hermes chat --provider openrouter --model deepseek/deepseek-v4-pro"
) else (
    start "" cmd /k "wsl -d Ubuntu -- bash -lc \"export PATH=$HOME/.local/bin:$PATH && hermes chat --provider openrouter --model deepseek/deepseek-v4-pro\""
)

echo [hermes-deepseek-pro] Launched. Check your terminal window.
echo [hermes-deepseek-pro] Context: 1M tokens
echo [hermes-deepseek-pro] Dashboard: http://localhost:4333
