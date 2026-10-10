@echo off
cd /d "%~dp0"
where node >nul 2>&1 || (echo [!] Node.js not found. Install from https://nodejs.org & pause & exit /b)
echo Getting the latest version from GitHub...
git pull --ff-only || echo [!] Could not update from GitHub (offline or local changes). Starting with the current files.
echo Gwave server starting... (close this window to stop)
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"
node server.js
echo.
echo [!] Server stopped. Take a screenshot of this window and show Claude.
pause
