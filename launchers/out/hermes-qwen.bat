@echo off
REM hermes-qwen.bat — Hermes CLI with Qwen3 30B via OpenRouter
REM Provider: openrouter | Model: qwen/qwen3-30b-a3b

setlocal

echo [hermes-qwen] Launching Hermes (qwen/qwen3-30b-a3b)...

where wt >nul 2>&1
if %ERRORLEVEL% == 0 (
    start "" wt.exe wsl -d Ubuntu -- bash -lc "export PATH=$HOME/.local/bin:$PATH && hermes chat --provider openrouter --model qwen/qwen3-30b-a3b"
) else (
    start "" cmd /k "wsl -d Ubuntu -- bash -lc \"export PATH=$HOME/.local/bin:$PATH && hermes chat --provider openrouter --model qwen/qwen3-30b-a3b\""
)

echo [hermes-qwen] Launched. Check your terminal window.
echo [hermes-qwen] Dashboard: http://localhost:4333
