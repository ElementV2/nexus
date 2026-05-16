@echo off
REM ─────────────────────────────────────────────────────────────
REM  Nexus — quick dev launch
REM  Double-click this to run the launcher straight from source:
REM   1. compiles the launcher TypeScript
REM   2. spawns Electron pointing at it
REM   3. the launcher itself spawns `next dev` (hot reload) from
REM      the repo root — no need to rebuild the .exe
REM ─────────────────────────────────────────────────────────────

setlocal
cd /d "%~dp0\launcher"

if not exist node_modules (
    echo Installing launcher dependencies...
    call npm install
    if errorlevel 1 goto :error
)

call npm run dev
if errorlevel 1 goto :error

endlocal
exit /b 0

:error
echo.
echo *** Launcher exited with an error ***
pause
endlocal
exit /b 1
