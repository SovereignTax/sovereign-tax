# Sovereign Tax — Windows Build Script (PowerShell)
# Run: Right-click > "Run with PowerShell", or open PowerShell and type: .\build-windows.ps1

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host " Sovereign Tax — Windows Build Script" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "[ERROR] Node.js is not installed." -ForegroundColor Red
    Write-Host "Download it from: https://nodejs.org" -ForegroundColor Yellow
    Write-Host "Install the LTS version, then re-run this script."
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "[OK] Node.js found: $(node --version)" -ForegroundColor Green

# Check Rust
$rustc = Get-Command rustc -ErrorAction SilentlyContinue
if (-not $rustc) {
    Write-Host "[ERROR] Rust is not installed." -ForegroundColor Red
    Write-Host "Download it from: https://rustup.rs" -ForegroundColor Yellow
    Write-Host "After installing, restart your terminal and re-run this script."
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "[OK] Rust found: $(rustc --version)" -ForegroundColor Green

# Check for Visual C++ Build Tools (cl.exe)
$cl = Get-Command cl -ErrorAction SilentlyContinue
if (-not $cl) {
    Write-Host ""
    Write-Host "[WARNING] Visual C++ compiler (cl.exe) not found in PATH." -ForegroundColor Yellow
    Write-Host "If the build fails, install Visual C++ Build Tools:" -ForegroundColor Yellow
    Write-Host "  https://visualstudio.microsoft.com/visual-cpp-build-tools/" -ForegroundColor Yellow
    Write-Host "  Select 'Desktop development with C++' workload." -ForegroundColor Yellow
    Write-Host ""
}

Write-Host ""
Write-Host "[1/3] Installing Node dependencies..." -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] npm install failed." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "[OK] Dependencies installed." -ForegroundColor Green

Write-Host ""
Write-Host "[2/3] Building the application (this may take 2-5 minutes)..." -ForegroundColor Cyan
npx tauri build
$buildResult = $LASTEXITCODE

Write-Host ""
Write-Host "[3/3] Locating output files..." -ForegroundColor Cyan
Write-Host ""

$exePath = "src-tauri\target\release\sovereign-tax.exe"
$nsisDir = "src-tauri\target\release\bundle\nsis"
$msiDir = "src-tauri\target\release\bundle\msi"

if (Test-Path $exePath) {
    Write-Host "============================================" -ForegroundColor Green
    Write-Host " BUILD SUCCESSFUL!" -ForegroundColor Green
    Write-Host "============================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Standalone exe:" -ForegroundColor White
    Write-Host "  $exePath" -ForegroundColor Yellow
    Write-Host ""

    if (Test-Path $nsisDir) {
        $nsisFiles = Get-ChildItem "$nsisDir\*.exe" -ErrorAction SilentlyContinue
        if ($nsisFiles) {
            Write-Host "Installer (NSIS):" -ForegroundColor White
            foreach ($f in $nsisFiles) { Write-Host "  $($f.FullName)" -ForegroundColor Yellow }
            Write-Host ""
        }
    }

    if (Test-Path $msiDir) {
        $msiFiles = Get-ChildItem "$msiDir\*.msi" -ErrorAction SilentlyContinue
        if ($msiFiles) {
            Write-Host "Installer (MSI):" -ForegroundColor White
            foreach ($f in $msiFiles) { Write-Host "  $($f.FullName)" -ForegroundColor Yellow }
            Write-Host ""
        }
    }

    Write-Host "You can run the standalone .exe directly, or use one of"
    Write-Host "the installers for a proper Windows installation."
} else {
    Write-Host "[ERROR] Build did not produce an executable." -ForegroundColor Red
    Write-Host "Check the error messages above." -ForegroundColor Yellow
}

Write-Host ""
Read-Host "Press Enter to exit"
