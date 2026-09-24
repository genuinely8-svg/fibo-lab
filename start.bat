@echo off
cd /d "%~dp0"
where node >nul 2>&1 || (echo [!] Node.js not found. Install from https://nodejs.org & pause & exit /b)
echo Fibo Lab server starting... (close this window to stop)
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"
node server.js
echo.
echo [!] Server stopped. Take a screenshot of this window and show Claude.
pause
