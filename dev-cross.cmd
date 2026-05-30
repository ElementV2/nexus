@echo off
REM ─────────────────────────────────────────────────────────────
REM  Nexus Cross — quick dev launch
REM  Double-click this to run the satellite straight from source:
REM   1. compiles the nexus-cross TypeScript (+ renderer assets)
REM   2. opens the Nexus Cross window directly via Electron
REM  No electron-builder, no installer — test code changes in
REM  seconds. Lives next to dev-launcher.cmd so both apps start
REM  from the repo root.
REM ─────────────────────────────────────────────────────────────

setlocal
cd /d "%~dp0\nexus-cross"

if not exist node_modules (
    echo Installing nexus-cross dependencies...
    call npm install
    if errorlevel 1 goto :error
)

echo Compiling nexus-cross...
call npm run compile
if errorlevel 1 goto :error

echo Launching Nexus Cross...
call npm start
if errorlevel 1 goto :error

endlocal
exit /b 0

:error
echo.
echo *** Nexus Cross exited with an error ***
pause
endlocal
exit /b 1
