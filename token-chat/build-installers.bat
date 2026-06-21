@echo off
echo ========================================
echo  Building Token Chat Installers
echo  (NSIS + MSI)
echo ========================================
cd /d "%~dp0"

echo.
echo [1/2] Killing any running instances...
taskkill /f /im token-chat.exe 2>nul

echo.
echo [2/2] Building installers...
call npm run tauri build

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo  Build succeeded!
    echo.
    echo  NSIS Installer:
    echo  src-tauri\target\release\bundle\nsis\Token Chat_0.5.3_x64-setup.exe
    echo.
    echo  MSI Installer:
    echo  src-tauri\target\release\bundle\msi\Token Chat_0.5.3_x64_en-US.msi
    echo ========================================
) else (
    echo.
    echo Build failed with error code %ERRORLEVEL%
)
pause