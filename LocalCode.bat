@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal
title LocalCode

rem --- 1. Node.js
where node >nul 2>nul
if errorlevel 1 set "PATH=%PATH%;%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Run install.bat first, or install it from https://nodejs.org
  pause
  exit /b 1
)

rem --- 2. Ollama (optional, for offline mode): start if installed and not running
set OLLAMA_NUM_PARALLEL=1
set OLLAMA_MAX_LOADED_MODELS=1
set OLLAMA_KEEP_ALIVE=30m
set "OLLAMA_EXE="
where ollama >nul 2>nul && set "OLLAMA_EXE=ollama"
if not defined OLLAMA_EXE if exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" set "OLLAMA_EXE=%LOCALAPPDATA%\Programs\Ollama\ollama.exe"
if defined OLLAMA_EXE (
  powershell -NoProfile -Command "try{Invoke-WebRequest -UseBasicParsing http://127.0.0.1:11434/api/version -TimeoutSec 2 | Out-Null}catch{Start-Process -WindowStyle Hidden -FilePath '%OLLAMA_EXE%' -ArgumentList 'serve'}" >nul 2>nul
) else (
  echo [info] Ollama not found - offline mode unavailable, use Online mode with an API key.
)

rem --- 3. Server file
set "SRV=server.js"
if not exist "%SRV%" if exist "app\server.js" set "SRV=app\server.js"
if not exist "%SRV%" (
  echo server.js not found in %CD%
  pause
  exit /b 1
)

rem --- 4. Start the app (opens the browser window automatically)
echo Starting LocalCode... Do not close this window while you work.
echo Close it to stop the program.
node "%SRV%" --open %*
echo.
echo LocalCode stopped.
pause
