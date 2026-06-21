@echo off
echo ========================================
echo  Token Chat Installer Test
echo ========================================
cd /d "%~dp0"

echo.
echo [1/4] Checking NSIS installer...
if exist "src-tauri\target\release\bundle\nsis\Token Chat_0.5.3_x64-setup.exe" (
    echo ✓ NSIS installer found
    echo   Path: src-tauri\target\release\bundle\nsis\Token Chat_0.5.3_x64-setup.exe
    for %%A in ("src-tauri\target\release\bundle\nsis\Token Chat_0.5.3_x64-setup.exe") do (
        echo   Size: %%~zA bytes
    )
) else (
    echo ✗ NSIS installer not found
)

echo.
echo [2/4] Checking MSI installer...
if exist "src-tauri\target\release\bundle\msi\Token Chat_0.5.3_x64_en-US.msi" (
    echo ✓ MSI installer found
    echo   Path: src-tauri\target\release\bundle\msi\Token Chat_0.5.3_x64_en-US.msi
    for %%A in ("src-tauri\target\release\bundle\msi\Token Chat_0.5.3_x64_en-US.msi") do (
        echo   Size: %%~zA bytes
    )
) else (
    echo ✗ MSI installer not found
)

echo.
echo [3/4] Checking executable...
if exist "src-tauri\target\release\token-chat.exe" (
    echo ✓ Executable found
    echo   Path: src-tauri\target\release\token-chat.exe
    for %%A in ("src-tauri\target\release\token-chat.exe") do (
        echo   Size: %%~zA bytes
    )
) else (
    echo ✗ Executable not found
)

echo.
echo [4/4] Checking configuration...
if exist "src-tauri\tauri.conf.json" (
    echo ✓ Configuration file found
    echo   Path: src-tauri\tauri.conf.json
) else (
    echo ✗ Configuration file not found
)

echo.
echo ========================================
echo  Test Summary
echo ========================================
echo.
echo If all checks passed, you can:
echo 1. Run NSIS installer: src-tauri\target\release\bundle\nsis\Token Chat_0.5.3_x64-setup.exe
echo 2. Run MSI installer: src-tauri\target\release\bundle\msi\Token Chat_0.5.3_x64_en-US.msi
echo 3. Run directly: src-tauri\target\release\token-chat.exe
echo.
echo For silent installation:
echo   NSIS: Token Chat_0.5.3_x64-setup.exe /S
echo   MSI: msiexec /i "Token Chat_0.5.3_x64_en-US.msi" /quiet
echo.
pause