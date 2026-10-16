#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"

$WarpCli = "$env:ProgramFiles\Cloudflare\Cloudflare WARP\warp-cli.exe"

Write-Host "[*] Disconnecting WARP..." -ForegroundColor Cyan
if (Test-Path -LiteralPath $WarpCli) {
    & $WarpCli --accept-tos disconnect 2>&1 | Out-Null
    Start-Sleep -Seconds 2
}

Write-Host "[*] Unregistering WARP account..." -ForegroundColor Cyan
if (Test-Path -LiteralPath $WarpCli) {
    & $WarpCli --accept-tos delete 2>&1 | Out-Null
}

Write-Host "[*] Stopping WARP service..." -ForegroundColor Cyan
$Service = Get-Service -Name "CloudflareWARP" -ErrorAction SilentlyContinue
if ($Service) {
    Stop-Service -Name "CloudflareWARP" -Force -ErrorAction SilentlyContinue
    Set-Service -Name "CloudflareWARP" -StartupType Disabled -ErrorAction SilentlyContinue
}

Write-Host "[*] Removing WARP via MSI..." -ForegroundColor Cyan
$UninstallKeys = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
)

$Product = Get-ItemProperty -Path $UninstallKeys -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like "*Cloudflare*WARP*" } |
    Select-Object -First 1

if ($Product) {
    $UninstallString = $Product.UninstallString
    if ($UninstallString) {
        Write-Host "[*] Running: $UninstallString" -ForegroundColor Cyan
        $Process = Start-Process -FilePath "msiexec.exe" -ArgumentList "/x `"$($Product.PSChildName)`" /qn /norestart" -Wait -PassThru
        if ($Process.ExitCode -eq 0) {
            Write-Host "[+] MSI uninstall completed." -ForegroundColor Green
        } else {
            Write-Host "[!] MSI uninstall exited with code $($Process.ExitCode)." -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "[!] WARP product registry entry not found." -ForegroundColor Yellow
}

Write-Host "[*] Cleaning up leftover files..." -ForegroundColor Cyan
$LeftoverPaths = @(
    "$env:ProgramFiles\Cloudflare",
    "$env:ProgramData\Cloudflare",
    "$env:LOCALAPPDATA\Cloudflare",
    "$env:APPDATA\Cloudflare"
)

foreach ($Path in $LeftoverPaths) {
    if (Test-Path -LiteralPath $Path) {
        Write-Host "[*] Removing: $Path" -ForegroundColor Cyan
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "[*] Cleaning up registry..." -ForegroundColor Cyan
$RegPaths = @(
    "HKLM:\SOFTWARE\Cloudflare",
    "HKCU:\SOFTWARE\Cloudflare"
)
foreach ($RegPath in $RegPaths) {
    if (Test-Path -LiteralPath $RegPath) {
        Remove-Item -LiteralPath $RegPath -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "[+] Cloudflare WARP has been fully uninstalled." -ForegroundColor Green
