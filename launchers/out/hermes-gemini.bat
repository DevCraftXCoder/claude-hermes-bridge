@echo off
title Hermes Gemini
wsl -d Ubuntu -- bash -lc "hermes chat --provider openrouter --model google/gemini-2.5-flash"
