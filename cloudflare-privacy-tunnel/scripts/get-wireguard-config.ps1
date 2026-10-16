#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"

$WarpCli = "$env:ProgramFiles\Cloudflare\Cloudflare WARP\warp-cli.exe"
$OutputPath = "$PSScriptRoot\..\config\wireguard-warp.conf"

if (-not (Test-Path -LiteralPath $WarpCli)) {
    Write-Host "[!] warp-cli not found. Run install-warp.ps1 first." -ForegroundColor Red
    exit 1
}

Write-Host "[*] Exporting WireGuard configuration..." -ForegroundColor Cyan

$Config = & $WarpCli --accept-tos wireguard-config 2>&1

if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($Config)) {
    Write-Host "[!] Failed to export WireGuard config. Make sure WARP is registered and connected." -ForegroundColor Red
    exit 1
}

$Config | Out-File -LiteralPath $OutputPath -Encoding utf8 -Force

Write-Host "[+] WireGuard config saved to: $OutputPath" -ForegroundColor Green
Write-Host ""
Write-Host "Config contents:" -ForegroundColor Yellow
Write-Host $Config
Write-Host ""
Write-Host "[*] Use this file with any WireGuard client to route traffic through WARP." -ForegroundColor Cyan
