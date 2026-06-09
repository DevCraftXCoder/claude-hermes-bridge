@echo off
REM hermes-ollama-coder7b.bat — Hermes CLI with Qwen2.5-Coder 7B (local Ollama)
REM Provider: ollama-local | Model: qwen2.5-coder:7b

setlocal

echo [hermes-ollama-coder7b] Launching Hermes (qwen2.5-coder:7b)...

where wt >nul 2>&1
if %ERRORLEVEL% == 0 (
    start "" wt.exe wsl -d Ubuntu -- bash -lc "export PATH=$HOME/.local/bin:$PATH && hermes chat --provider ollama-local --model qwen2.5-coder:7b"
) else (
    start "" cmd /k "wsl -d Ubuntu -- bash -lc \"export PATH=$HOME/.local/bin:$PATH && hermes chat --provider ollama-local --model qwen2.5-coder:7b\""
)

echo [hermes-ollama-coder7b] Launched. Check your terminal window.
echo [hermes-ollama-coder7b] Requires: Ollama running on localhost:11434
