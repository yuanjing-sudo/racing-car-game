#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"

$WarpCli = "$env:ProgramFiles\Cloudflare\Cloudflare WARP\warp-cli.exe"

if (-not (Test-Path -LiteralPath $WarpCli)) {
    Write-Host "[!] warp-cli not found." -ForegroundColor Red
    exit 1
}

Write-Host "[*] Disconnecting Cloudflare WARP..." -ForegroundColor Cyan
& $WarpCli --accept-tos disconnect

Start-Sleep -Seconds 2

$Status = & $WarpCli --accept-tos status
Write-Host $Status -ForegroundColor Yellow

Write-Host "[+] WARP disconnected. Traffic is no longer encrypted." -ForegroundColor Green
