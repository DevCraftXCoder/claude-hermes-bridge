@echo off
title Hermes Ollama Coder7B
wsl -d Ubuntu -- bash -lc "hermes chat --provider ollama-local --model qwen2.5-coder:7b"
