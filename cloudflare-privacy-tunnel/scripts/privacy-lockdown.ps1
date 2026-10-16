#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"

$WarpCli = "$env:ProgramFiles\Cloudflare\Cloudflare WARP\warp-cli.exe"

if (-not (Test-Path -LiteralPath $WarpCli)) {
    Write-Host "[!] warp-cli not found. Run install-warp.ps1 first." -ForegroundColor Red
    exit 1
}

Write-Host "=== WARP Privacy Lockdown ===" -ForegroundColor Cyan
Write-Host ""

Write-Host "[*] Enabling always-on mode..." -ForegroundColor Cyan
& $WarpCli --accept-tos settings --always-on

Write-Host "[*] Disabling telemetry..." -ForegroundColor Cyan
& $WarpCli --accept-tos settings --disable-analytics

Write-Host "[*] Enabling WARP+ (private backbone)..." -ForegroundColor Cyan
& $WarpCli --accept-tos settings --warp-plus

Write-Host "[*] Setting protocol to WireGuard..." -ForegroundColor Cyan
& $WarpCli --accept-tos settings --protocol wireguard

Write-Host "[*] Disabling IPv6 to prevent leaks..." -ForegroundColor Cyan
$Adapters = Get-NetAdapter -Physical
foreach ($Adapter in $Adapters) {
    Disable-NetAdapterBinding -Name $Adapter.Name -ComponentID ms_tcpip6 -ErrorAction SilentlyContinue
    Write-Host "    Disabled IPv6 on: $($Adapter.Name)" -ForegroundColor Gray
}

Write-Host "[*] Configuring kill switch (block non-WARP traffic)..." -ForegroundColor Cyan
$WarpAdapter = Get-NetAdapter | Where-Object { $_.InterfaceDescription -like "*WARP*" -or $_.InterfaceDescription -like "*Cloudflare*" }
if ($WarpAdapter) {
    $WarpSubnet = (Get-NetIPAddress -InterfaceIndex $WarpAdapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).IPAddress
    if ($WarpSubnet) {
        New-NetFirewallRule -DisplayName "WARP Kill Switch - Block Outbound" `
            -Direction Outbound -Action Block -Profile Any `
            -InterfaceAlias $WarpAdapter.Name -ErrorAction SilentlyContinue | Out-Null
        Write-Host "    Kill switch enabled on: $($WarpAdapter.Name)" -ForegroundColor Gray
    }
}

Write-Host "[*] Blocking Teredo (IPv6 tunneling leak)..." -ForegroundColor Cyan
Set-NetTeredoConfiguration -Type Disabled -ErrorAction SilentlyContinue

Write-Host "[*] Disabling NetBIOS over TCP/IP..." -ForegroundColor Cyan
$Adapters = Get-NetAdapter -Physical
foreach ($Adapter in $Adapters) {
    $RegPath = "HKLM:\SYSTEM\CurrentControlSet\Services\NetBT\Parameters\Interfaces\Tcpip_$($Adapter.InterfaceGuid)"
    if (Test-Path -LiteralPath $RegPath) {
        Set-ItemProperty -Path $RegPath -Name "NetbiosOptions" -Value 2 -ErrorAction SilentlyContinue
    }
}

Write-Host "[*] Disabling LLMNR (link-local multicast name resolution)..." -ForegroundColor Cyan
$LLMNRRegPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\DNSClient"
if (-not (Test-Path -LiteralPath $LLMNRRegPath)) {
    New-Item -Path $LLMNRRegPath -Force | Out-Null
}
Set-ItemProperty -Path $LLMNRRegPath -Name "EnableMulticast" -Value 0 -Type DWord

Write-Host "[*] Disabling mDNS (multicast DNS)..." -ForegroundColor Cyan
$MDNSRegPath = "HKLM:\SYSTEM\CurrentControlSet\Services\Dnscache\Parameters"
Set-ItemProperty -Path $MDNSRegPath -Name "EnableMDNS" -Value 0 -Type DWord -ErrorAction SilentlyContinue

Write-Host "[*] Clearing DNS cache..." -ForegroundColor Cyan
Clear-DnsClientCache

Write-Host "[*] Verifying final state..." -ForegroundColor Cyan
$Status = & $WarpCli --accept-tos status
Write-Host "    $Status" -ForegroundColor Green

$Dns = Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object { $_.ServerAddresses -ne "" }
Write-Host "    DNS: $($Dns.ServerAddresses -join ', ')" -ForegroundColor Green

Write-Host ""
Write-Host "=== Lockdown Complete ===" -ForegroundColor Green
Write-Host "Your traffic is now routed through WARP with anti-leak protections." -ForegroundColor Green
Write-Host "Verify at: https://www.dnsleaktest.com/" -ForegroundColor Yellow
Write-Host "Verify at: https://browserleaks.com/ip" -ForegroundColor Yellow
