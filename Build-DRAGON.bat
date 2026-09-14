@echo off
setlocal
cd /d "%~dp0"
echo.
echo Starting DRAGON Windows installer build...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File ".\desktop\scripts\build-local.ps1"
echo.
pause
