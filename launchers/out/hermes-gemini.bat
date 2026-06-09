@echo off
REM hermes-gemini.bat — Hermes CLI with Gemini 2.5 Flash via OpenRouter
REM Provider: openrouter | Model: google/gemini-2.5-flash

setlocal

echo [hermes-gemini] Launching Hermes (google/gemini-2.5-flash)...

where wt >nul 2>&1
if %ERRORLEVEL% == 0 (
    start "" wt.exe wsl -d Ubuntu -- bash -lc "export PATH=$HOME/.local/bin:$PATH && hermes chat --provider openrouter --model google/gemini-2.5-flash"
) else (
    start "" cmd /k "wsl -d Ubuntu -- bash -lc \"export PATH=$HOME/.local/bin:$PATH && hermes chat --provider openrouter --model google/gemini-2.5-flash\""
)

echo [hermes-gemini] Launched. Check your terminal window.
echo [hermes-gemini] Dashboard: http://localhost:4333
