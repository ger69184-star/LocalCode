@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal
title LocalCode - install model
set "OL=ollama"
where ollama >nul 2>nul || set "OL=%LOCALAPPDATA%\Programs\Ollama\ollama.exe"
if not exist "%OL%" if /i not "%OL%"=="ollama" (
  echo Ollama not found. Install it from https://ollama.com/download and run this file again.
  pause
  exit /b 1
)
echo Starting Ollama if needed...
powershell -NoProfile -Command "try{Invoke-WebRequest -UseBasicParsing http://127.0.0.1:11434/api/version -TimeoutSec 2 | Out-Null}catch{Start-Process -WindowStyle Hidden -FilePath '%OL%' -ArgumentList 'serve'; Start-Sleep 4}"
echo.
echo Downloading model qwen2.5-coder:1.5b (about 1 GB). Wait until it says success.
"%OL%" pull qwen2.5-coder:1.5b
if errorlevel 1 (
  echo.
  echo Official registry failed. Trying Hugging Face mirror...
  "%OL%" pull hf.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M
)
echo.
"%OL%" list
echo.
echo If the list above shows a model - start LocalCode and pick it in Settings.
echo If you see network errors - check internet or enable a VPN and try again.
pause
