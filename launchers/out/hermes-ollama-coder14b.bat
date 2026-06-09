@echo off
title Hermes Ollama Coder14B
wsl -d Ubuntu -- bash -lc "hermes chat --provider ollama-local --model qwen2.5-coder:14b"
