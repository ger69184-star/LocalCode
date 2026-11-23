@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal
title LocalCode installer

where node >nul 2>nul
if not errorlevel 1 goto have_node

echo Node.js not found. Installing via winget...
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
set "PATH=%PATH%;%ProgramFiles%\nodejs"
where node >nul 2>nul
if not errorlevel 1 goto have_node

echo winget did not work. Downloading the Node.js installer directly...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try{$j=Invoke-RestMethod https://nodejs.org/dist/index.json;$v=($j|Where-Object{$_.lts}|Select-Object -First 1).version;$f=Join-Path $env:TEMP 'node-setup.msi';Invoke-WebRequest ('https://nodejs.org/dist/'+$v+'/node-'+$v+'-x64.msi') -OutFile $f;Start-Process msiexec.exe -ArgumentList '/i',$f,'/passive','/norestart' -Wait}catch{Write-Host $_.Exception.Message}"
set "PATH=%PATH%;%ProgramFiles%\nodejs"
where node >nul 2>nul
if not errorlevel 1 goto have_node
echo.
echo Could not install Node.js automatically.
echo Download it from https://nodejs.org (LTS version), install it, then run install.bat again.
pause
exit /b 1

:have_node
if exist "installer\install.js" (
  node "installer\install.js" %*
) else if exist "install.js" (
  node "install.js" %*
) else (
  echo install.js not found next to install.bat
  pause
  exit /b 1
)
echo.
echo Installer finished. Run Create-Shortcut.bat, then start LocalCode from the Desktop icon.
pause
