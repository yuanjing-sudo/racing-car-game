# Cloudflare WARP Privacy Tunnel

Encrypts all traffic between your device and Cloudflare's edge network, preventing your WiFi provider from seeing your browsing activity.

## How It Works

```
Your Device --[WireGuard encrypted tunnel]--> Cloudflare Edge --> Internet
         WiFi provider sees only encrypted noise
```

## Quick Start

1. **Install WARP** (one-time, requires admin):
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\install-warp.ps1
   ```

2. **Connect** (requires admin):
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\start-warp.ps1
   ```

3. **Verify** your privacy:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\verify-privacy.ps1
   ```

4. **Disconnect** when done:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\stop-warp.ps1
   ```

## What Your WiFi Provider Sees

| Without WARP | With WARP |
|---|---|
| Every domain you visit | Only encrypted traffic to Cloudflare IPs |
| DNS queries in plaintext | Encrypted DNS (DoH) |
| Full packet inspection | Nothing readable |

## Files

- `scripts/install-warp.ps1` - One-time installer
- `scripts/start-warp.ps1` - Connect and verify
- `scripts/stop-warp.ps1` - Disconnect
- `scripts/verify-privacy.ps1` - Check status, DNS, public IP
- `scripts/apply-settings.ps1` - Apply config/warp-settings.json to warp-cli
- `scripts/monitor-connection.ps1` - Continuous health check with auto-reconnect
- `scripts/uninstall-warp.ps1` - Full clean removal (MSI + files + registry)
- `scripts/get-wireguard-config.ps1` - Export WireGuard config for external clients
- `config/warp-settings.json` - Configuration reference

## Verification

After connecting, visit https://www.dnsleaktest.com/ — you should see only Cloudflare DNS servers, not your ISP's.

## Notes

- Free tier includes WARP (basic encryption). WARP+ (faster routing) requires a paid subscription.
- WARP encrypts traffic between your device and Cloudflare. For end-to-end privacy, also use HTTPS everywhere.
- Some networks may block WireGuard. If connection fails, try `warp-cli --accept-tos mode proxy` as fallback.
