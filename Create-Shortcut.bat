@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=[Environment]::GetFolderPath('Desktop');$s=(New-Object -ComObject WScript.Shell).CreateShortcut($d+'\LocalCode.lnk');$s.TargetPath='%~dp0LocalCode.vbs';$s.WorkingDirectory='%~dp0';$i='%~dp0icon.ico';if(Test-Path $i){$s.IconLocation=$i}else{$s.IconLocation='shell32.dll,13'};$s.Save()"
if errorlevel 1 (echo Failed to create shortcut) else (echo Shortcut "LocalCode" created on the Desktop)
pause
