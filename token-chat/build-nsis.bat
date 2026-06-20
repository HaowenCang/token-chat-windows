@echo off
echo ========================================
echo  Building Token Chat NSIS Installer
echo ========================================
cd /d "%~dp0"
call npm run tauri build
if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo  Build succeeded!
    echo  Installer output:
    echo  src-tauri\target\release\bundle\nsis\
    echo ========================================
) else (
    echo.
    echo Build failed with error code %ERRORLEVEL%
)
pause
