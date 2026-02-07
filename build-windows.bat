@echo off
echo ============================================
echo  Sovereign Tax — Windows Build Script
echo ============================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed.
    echo Download it from: https://nodejs.org
    echo Install the LTS version, then re-run this script.
    pause
    exit /b 1
)
echo [OK] Node.js found:
node --version

:: Check Rust
where rustc >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Rust is not installed.
    echo Download it from: https://rustup.rs
    echo After installing, restart your terminal and re-run this script.
    pause
    exit /b 1
)
echo [OK] Rust found:
rustc --version

:: Check cargo
where cargo >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Cargo is not in PATH.
    echo Try restarting your terminal after installing Rust.
    pause
    exit /b 1
)

echo.
echo [1/3] Installing Node dependencies...
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
)
echo [OK] Dependencies installed.

echo.
echo [2/3] Building the application (this may take 2-5 minutes)...
call npx tauri build
if %errorlevel% neq 0 (
    echo.
    echo [WARNING] Bundle step may have failed, but the .exe might still be built.
    echo Checking for output...
)

echo.
echo [3/3] Locating output files...
echo.

if exist "src-tauri\target\release\sovereign-tax.exe" (
    echo ============================================
    echo  BUILD SUCCESSFUL!
    echo ============================================
    echo.
    echo Standalone exe:
    echo   src-tauri\target\release\sovereign-tax.exe
    echo.
)

if exist "src-tauri\target\release\bundle\nsis\*.exe" (
    echo Installer (NSIS):
    for %%f in (src-tauri\target\release\bundle\nsis\*.exe) do echo   %%f
    echo.
)

if exist "src-tauri\target\release\bundle\msi\*.msi" (
    echo Installer (MSI):
    for %%f in (src-tauri\target\release\bundle\msi\*.msi) do echo   %%f
    echo.
)

echo You can run the standalone .exe directly, or use one of the
echo installers for a proper Windows installation with Start Menu entry.
echo.
pause
