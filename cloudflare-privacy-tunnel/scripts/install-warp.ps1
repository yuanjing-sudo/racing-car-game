#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"

$WarpInstallerUrl = "https://downloads.cloudflareclient.com/v1/download/windows/ga"
$InstallerPath = "$env:TEMP\Cloudflare_WARP_Setup.msi"

Write-Host "[*] Downloading Cloudflare WARP installer..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $WarpInstallerUrl -OutFile $InstallerPath -UseBasicParsing

Write-Host "[*] Installing Cloudflare WARP..." -ForegroundColor Cyan
Start-Process msiexec.exe -ArgumentList "/i `"$InstallerPath`" /qn /norestart" -Wait

Write-Host "[*] Cleaning up installer..." -ForegroundColor Cyan
Remove-Item -LiteralPath $InstallerPath -Force

Write-Host "[+] Cloudflare WARP installed successfully." -ForegroundColor Green
Write-Host "[*] Run 'start-warp.ps1' to connect." -ForegroundColor Yellow
