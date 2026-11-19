@echo off
rem Afterlife starten: Doppelklick (Windows).
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
    echo Node.js wurde nicht gefunden. Installiere es von https://nodejs.org
    pause
    exit /b 1
)
node relay\launcher.js %*
if errorlevel 1 pause
