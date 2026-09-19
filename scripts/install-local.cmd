@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 22+ is required. Install from https://nodejs.org and re-run.
  exit /b 1
)

echo ==^> Node
node -v

if not exist ".env.local" (
  copy /y ".env.example" ".env.local" >nul
  echo ==^> wrote .env.local (auth off, no secrets)
)

if exist package-lock.json (
  call npm ci
) else (
  call npm install
)
if errorlevel 1 exit /b 1

if not exist data mkdir data
node scripts/init-lounge-home.mjs
if errorlevel 1 exit /b 1

echo.
echo Install complete. Start the dashboard with:
echo   npm run dev
echo then open http://127.0.0.1:8080
endlocal
