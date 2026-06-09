@echo off
title Hermes Ollama Llama3
wsl -d Ubuntu -- bash -lc "hermes chat --provider ollama-local --model llama3.2:latest"
