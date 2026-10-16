#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"

$WarpCli = "$env:ProgramFiles\Cloudflare\Cloudflare WARP\warp-cli.exe"

if (-not (Test-Path -LiteralPath $WarpCli)) {
    Write-Host "[!] warp-cli not found. Run install-warp.ps1 first." -ForegroundColor Red
    exit 1
}

Write-Host "[*] Registering WARP account..." -ForegroundColor Cyan
& $WarpCli --accept-tos register

Write-Host "[*] Setting WARP to proxy mode (encrypts all traffic)..." -ForegroundColor Cyan
& $WarpCli --accept-tos mode warp

Write-Host "[*] Enabling WARP+ for better performance..." -ForegroundColor Cyan
& $WarpCli --accept-tos license ""

Write-Host "[*] Connecting to Cloudflare WARP..." -ForegroundColor Cyan
& $WarpCli --accept-tos connect

Start-Sleep -Seconds 3

Write-Host "[*] Verifying connection..." -ForegroundColor Cyan
$Status = & $WarpCli --accept-tos status
Write-Host $Status -ForegroundColor Green

Write-Host "[*] Checking for DNS leaks..." -ForegroundColor Cyan
$DnsResult = Resolve-DnsName -Name "cloudflare.com" -Type A -DnsOnly -ErrorAction SilentlyContinue
if ($DnsResult) {
    Write-Host "[+] DNS resolution working through WARP." -ForegroundColor Green
} else {
    Write-Host "[!] DNS resolution failed. Check your connection." -ForegroundColor Red
}

Write-Host ""
Write-Host "[+] WARP is now ACTIVE. Your traffic is encrypted." -ForegroundColor Green
Write-Host "[*] Verify at: https://www.dnsleaktest.com/" -ForegroundColor Yellow
