$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "        DRAGON Windows Installer Build" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$DesktopDir = Join-Path $RepoRoot "desktop"

function Require-Command([string]$Name, [string]$InstallHint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "Missing requirement: $Name" -ForegroundColor Red
    Write-Host $InstallHint -ForegroundColor Yellow
    Write-Host ""
    exit 1
  }
}

Require-Command "node" "Install Node.js LTS, then run this file again."
Require-Command "npm" "Install Node.js LTS, then run this file again."
Require-Command "rustc" "Install Rust from https://rustup.rs/, restart PowerShell, then run this file again."
Require-Command "cargo" "Install Rust from https://rustup.rs/, restart PowerShell, then run this file again."

Write-Host "Node:  $(node --version)"
Write-Host "npm:   $(npm --version)"
Write-Host "Rust:  $(rustc --version)"
Write-Host "Cargo: $(cargo --version)"
Write-Host ""

Write-Host "[1/4] Downloading the bundled OmniGet runtime..." -ForegroundColor Cyan
powershell -ExecutionPolicy Bypass -File (Join-Path $DesktopDir "scripts\fetch-tools.ps1")

Write-Host ""
Write-Host "[2/4] Installing Tauri build dependencies..." -ForegroundColor Cyan
Push-Location $DesktopDir
try {
  npm install

  Write-Host ""
  Write-Host "[3/4] Building DRAGON Setup.exe..." -ForegroundColor Cyan
  npm run build
}
finally {
  Pop-Location
}

$NsisDir = Join-Path $DesktopDir "src-tauri\target\release\bundle\nsis"
$Installer = Get-ChildItem $NsisDir -Filter "*.exe" -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $Installer) {
  Write-Host ""
  Write-Host "Build finished but the installer was not found." -ForegroundColor Red
  Write-Host "Expected folder: $NsisDir" -ForegroundColor Yellow
  exit 1
}

$OutputDir = Join-Path $RepoRoot "DRAGON-BUILD"
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$FinalInstaller = Join-Path $OutputDir "DRAGON-Setup.exe"
Copy-Item $Installer.FullName $FinalInstaller -Force

Write-Host ""
Write-Host "[4/4] DONE" -ForegroundColor Green
Write-Host ""
Write-Host "Your installer is here:" -ForegroundColor Green
Write-Host $FinalInstaller -ForegroundColor White
Write-Host ""
Start-Process explorer.exe -ArgumentList "/select,`"$FinalInstaller`""
