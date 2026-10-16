#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"

$WarpCli = "$env:ProgramFiles\Cloudflare\Cloudflare WARP\warp-cli.exe"

Write-Host "=== Cloudflare WARP Privacy Verification ===" -ForegroundColor Cyan
Write-Host ""

if (Test-Path -LiteralPath $WarpCli) {
    Write-Host "[*] WARP Status:" -ForegroundColor Yellow
    $Status = & $WarpCli --accept-tos status
    Write-Host "    $Status"
    Write-Host ""

    Write-Host "[*] WARP Account:" -ForegroundColor Yellow
    $Account = & $WarpCli --accept-tos account
    Write-Host "    $Account"
} else {
    Write-Host "[!] WARP not installed." -ForegroundColor Red
}

Write-Host ""
Write-Host "[*] Network Adapters:" -ForegroundColor Yellow
Get-NetAdapter | Where-Object { $_.InterfaceDescription -like "*WARP*" -or $_.InterfaceDescription -like "*Cloudflare*" } | Format-Table Name, InterfaceDescription, Status -AutoSize

Write-Host "[*] DNS Configuration:" -ForegroundColor Yellow
Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object { $_.ServerAddresses -ne "" } | Format-Table InterfaceAlias, ServerAddresses -AutoSize

Write-Host ""
Write-Host "[*] Public IP Check:" -ForegroundColor Yellow
try {
    $Ip = Invoke-RestMethod -Uri "https://api.ipify.org?format=json" -TimeoutSec 10
    Write-Host "    Public IP: $($Ip.ip)" -ForegroundColor Green
} catch {
    Write-Host "    Could not determine public IP." -ForegroundColor Red
}

Write-Host ""
Write-Host "=== Verification Complete ===" -ForegroundColor Cyan
Write-Host "For full DNS leak test, visit: https://www.dnsleaktest.com/" -ForegroundColor Yellow
