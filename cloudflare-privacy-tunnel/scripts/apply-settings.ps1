#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"

$WarpCli = "$env:ProgramFiles\Cloudflare\Cloudflare WARP\warp-cli.exe"
$ConfigPath = "$PSScriptRoot\..\config\warp-settings.json"

if (-not (Test-Path -LiteralPath $WarpCli)) {
    Write-Host "[!] warp-cli not found. Run install-warp.ps1 first." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path -LiteralPath $ConfigPath)) {
    Write-Host "[!] Config file not found: $ConfigPath" -ForegroundColor Red
    exit 1
}

$Config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json

Write-Host "[*] Applying WARP settings from config..." -ForegroundColor Cyan

if ($Config.mode -eq "warp") {
    Write-Host "[*] Setting mode: warp" -ForegroundColor Cyan
    & $WarpCli --accept-tos mode warp
} elseif ($Config.mode -eq "proxy") {
    Write-Host "[*] Setting mode: proxy" -ForegroundColor Cyan
    & $WarpCli --accept-tos mode proxy
} elseif ($Config.mode -eq "doh") {
    Write-Host "[*] Setting mode: doh" -ForegroundColor Cyan
    & $WarpCli --accept-tos mode doh
} elseif ($Config.mode -eq "dot") {
    Write-Host "[*] Setting mode: dot" -ForegroundColor Cyan
    & $WarpCli --accept-tos mode dot
} elseif ($Config.mode -eq "warp+doh") {
    Write-Host "[*] Setting mode: warp+doh" -ForegroundColor Cyan
    & $WarpCli --accept-tos mode warp+doh
} elseif ($Config.mode -eq "warp+dot") {
    Write-Host "[*] Setting mode: warp+dot" -ForegroundColor Cyan
    & $WarpCli --accept-tos mode warp+dot
}

if ($Config.features.block_malware) {
    Write-Host "[*] Enabling malware blocking..." -ForegroundColor Cyan
    & $WarpCli --accept-tos settings --block-malware
}

if ($Config.features.block_ads) {
    Write-Host "[*] Enabling ad blocking..." -ForegroundColor Cyan
    & $WarpCli --accept-tos settings --block-ads
}

if ($Config.features.block_adult_content) {
    Write-Host "[*] Enabling adult content blocking..." -ForegroundColor Cyan
    & $WarpCli --accept-tos settings --block-adult-content
}

if ($Config.features.dns_over_health) {
    Write-Host "[*] Enabling DoH..." -ForegroundColor Cyan
    & $WarpCli --accept-tos settings --doh
}

Write-Host "[*] Current settings:" -ForegroundColor Yellow
$Settings = & $WarpCli --accept-tos settings
Write-Host $Settings

Write-Host "[+] Settings applied successfully." -ForegroundColor Green
