#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"

$WarpCli = "$env:ProgramFiles\Cloudflare\Cloudflare WARP\warp-cli.exe"
$CheckInterval = 30
$MaxRetries = 3
$LogFile = "$PSScriptRoot\..\logs\warp-monitor.log"

if (-not (Test-Path -LiteralPath $WarpCli)) {
    Write-Host "[!] warp-cli not found. Run install-warp.ps1 first." -ForegroundColor Red
    exit 1
}

$LogDir = Split-Path -Parent $LogFile
if (-not (Test-Path -LiteralPath $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

function Write-Log {
    param([string]$Message)
    $Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $Entry = "[$Timestamp] $Message"
    Add-Content -LiteralPath $LogFile -Value $Entry
    Write-Host $Entry
}

Write-Log "=== WARP Connection Monitor Started ==="
Write-Log "Check interval: ${CheckInterval}s | Max retries: $MaxRetries"

$ConsecutiveFailures = 0

while ($true) {
    Start-Sleep -Seconds $CheckInterval

    $Status = & $WarpCli --accept-tos status 2>&1
    $StatusString = $Status | Out-String

    if ($StatusString -match "Connected") {
        if ($ConsecutiveFailures -gt 0) {
            Write-Log "[+] Connection restored."
        }
        $ConsecutiveFailures = 0
        Write-Log "[OK] WARP connected."
    } elseif ($StatusString -match "Connecting") {
        Write-Log "[..] WARP connecting..."
    } else {
        $ConsecutiveFailures++
        Write-Log "[!] WARP disconnected (failure $ConsecutiveFailures/$MaxRetries)."

        if ($ConsecutiveFailures -ge $MaxRetries) {
            Write-Log "[!] Max retries reached. Attempting reconnect..."
            & $WarpCli --accept-tos disconnect 2>&1 | Out-Null
            Start-Sleep -Seconds 2
            & $WarpCli --accept-tos connect 2>&1 | Out-Null
            Start-Sleep -Seconds 5

            $NewStatus = & $WarpCli --accept-tos status 2>&1 | Out-String
            if ($NewStatus -match "Connected") {
                Write-Log "[+] Reconnect successful."
                $ConsecutiveFailures = 0
            } else {
                Write-Log "[!] Reconnect failed. Will retry in ${CheckInterval}s."
            }
        }
    }
}
