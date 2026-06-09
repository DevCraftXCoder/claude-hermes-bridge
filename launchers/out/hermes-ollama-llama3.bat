@echo off
REM hermes-ollama-llama3.bat — Hermes CLI with Llama 3.2 3B (local Ollama)
REM Provider: ollama-local | Model: llama3.2:latest

setlocal

echo [hermes-ollama-llama3] Launching Hermes (llama3.2:latest)...

where wt >nul 2>&1
if %ERRORLEVEL% == 0 (
    start "" wt.exe wsl -d Ubuntu -- bash -lc "export PATH=$HOME/.local/bin:$PATH && hermes chat --provider ollama-local --model llama3.2:latest"
) else (
    start "" cmd /k "wsl -d Ubuntu -- bash -lc \"export PATH=$HOME/.local/bin:$PATH && hermes chat --provider ollama-local --model llama3.2:latest\""
)

echo [hermes-ollama-llama3] Launched. Check your terminal window.
echo [hermes-ollama-llama3] Requires: Ollama running on localhost:11434
