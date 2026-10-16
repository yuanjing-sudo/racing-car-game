#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"

Write-Host "=== Browser Fingerprint Shield ===" -ForegroundColor Cyan
Write-Host ""

$FirefoxProfiles = "$env:APPDATA\Mozilla\Firefox\Profiles"
$ChromePolicyPath = "HKLM:\SOFTWARE\Policies\Google\Chrome"
$EdgePolicyPath = "HKLM:\SOFTWARE\Policies\Microsoft\Edge"

Write-Host "[*] Hardening Firefox..." -ForegroundColor Cyan
if (Test-Path -LiteralPath $FirefoxProfiles) {
    $Profiles = Get-ChildItem -Path $FirefoxProfiles -Directory
    foreach ($Profile in $Profiles) {
        $UserJs = Join-Path $Profile.FullName "user.js"
        $Prefs = @"
user_pref("privacy.resistFingerprinting", true);
user_pref("privacy.trackingprotection.enabled", true);
user_pref("privacy.trackingprotection.socialtracking.enabled", true);
user_pref("browser.cache.disk.enable", false);
user_pref("browser.sessionstore.max_tabs_undo", 0);
user_pref("browser.sessionstore.max_windows_undo", 0);
user_pref("browser.send_pings", false);
user_pref("beacon.enabled", false);
user_pref("media.navigator.enabled", false);
user_pref("geo.enabled", false);
user_pref("geo.provider.ms-windows-location", false);
user_pref("network.cookie.cookieBehavior", 5);
user_pref("network.http.referer.trimmingPolicy", 2);
user_pref("network.http.referer.XOriginPolicy", 2);
user_pref("privacy.firstparty.isolate", true);
user_pref("privacy.donottrackheader.enabled", true);
user_pref("browser.urlbar.suggest.quicksuggest.nonsponsored", false);
user_pref("browser.urlbar.suggest.quicksuggest.sponsored", false);
user_pref("browser.urlbar.suggest.topsites", false);
user_pref("browser.urlbar.suggest.searches", false);
user_pref("browser.urlbar.suggest.bookmark", false);
user_pref("browser.urlbar.suggest.history", false);
user_pref("browser.urlbar.suggest.openpage", false);
user_pref("browser.urlbar.suggest.engines", false);
user_pref("browser.urlbar.suggest.calculator", false);
user_pref("browser.urlbar.suggest.unitconverter", false);
user_pref("browser.urlbar.suggest.weather", false);
user_pref("browser.urlbar.suggest.yandex", false);
user_pref("browser.urlbar.suggest.aliexpress", false);
user_pref("browser.urlbar.suggest.amazon", false);
user_pref("browser.urlbar.suggest.baidu", false);
user_pref("browser.urlbar.suggest.bing", false);
user_pref("browser.urlbar.suggest.ddg", false);
user_pref("browser.urlbar.suggest.ebay", false);
user_pref("browser.urlbar.suggest.google", false);
user_pref("browser.urlbar.suggest.qwant", false);
user_pref("browser.urlbar.suggest.twitter", false);
user_pref("browser.urlbar.suggest.wikipedia", false);
user_pref("browser.urlbar.suggest.youtube", false);
user_pref("browser.urlbar.suggest.reddit", false);
user_pref("browser.urlbar.suggest.twitter", false);
user_pref("browser.urlbar.suggest.yandex", false);
user_pref("browser.urlbar.suggest.aliexpress", false);
user_pref("browser.urlbar.suggest.amazon", false);
user_pref("browser.urlbar.suggest.baidu", false);
user_pref("browser.urlbar.suggest.bing", false);
user_pref("browser.urlbar.suggest.ddg", false);
user_pref("browser.urlbar.suggest.ebay", false);
user_pref("browser.urlbar.suggest.google", false);
user_pref("browser.urlbar.suggest.qwant", false);
user_pref("browser.urlbar.suggest.twitter", false);
user_pref("browser.urlbar.suggest.wikipedia", false);
user_pref("browser.urlbar.suggest.youtube", false);
user_pref("browser.urlbar.suggest.reddit", false);
user_pref("browser.urlbar.suggest.twitter", false);
user_pref("browser.urlbar.suggest.yandex", false);
user_pref("browser.urlbar.suggest.aliexpress", false);
user_pref("browser.urlbar.suggest.amazon", false);
user_pref("browser.urlbar.suggest.baidu", false);
user_pref("browser.urlbar.suggest.bing", false);
user_pref("browser.urlbar.suggest.ddg", false);
user_pref("browser.urlbar.suggest.ebay", false);
user_pref("browser.urlbar.suggest.google", false);
user_pref("browser.urlbar.suggest.qwant", false);
user_pref("browser.urlbar.suggest.twitter", false);
user_pref("browser.urlbar.suggest.wikipedia", false);
user_pref("browser.urlbar.suggest.youtube", false);
user_pref("browser.urlbar.suggest.reddit", false);
"@
        $Prefs | Out-File -LiteralPath $UserJs -Encoding utf8 -Force
        Write-Host "    Hardened profile: $($Profile.Name)" -ForegroundColor Gray
    }
} else {
    Write-Host "    Firefox not found." -ForegroundColor Yellow
}

Write-Host "[*] Hardening Chrome..." -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath $ChromePolicyPath)) {
    New-Item -Path $ChromePolicyPath -Force | Out-Null
}
Set-ItemProperty -Path $ChromePolicyPath -Name "MetricsReportingEnabled" -Value 0 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $ChromePolicyPath -Name "DefaultGeolocationSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $ChromePolicyPath -Name "DefaultNotificationsSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $ChromePolicyPath -Name "DefaultSensorsSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $ChromePolicyPath -Name "DefaultWebBluetoothGuardSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $ChromePolicyPath -Name "DefaultWebUsbGuardSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $ChromePolicyPath -Name "DefaultSerialGuardSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $ChromePolicyPath -Name "DefaultFileSystemReadGuardSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $ChromePolicyPath -Name "DefaultFileSystemWriteGuardSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $ChromePolicyPath -Name "DefaultLocalFontsSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $ChromePolicyPath -Name "DefaultAudioCaptureSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $ChromePolicyPath -Name "DefaultVideoCaptureSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $ChromePolicyPath -Name "DefaultClipboardSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $ChromePolicyPath -Name "DefaultGeolocationSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $ChromePolicyPath -Name "DefaultSensorsSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $ChromePolicyPath -Name "DefaultWebBluetoothGuardSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $ChromePolicyPath -Name "DefaultWebUsbGuardSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $ChromePolicyPath -Name "DefaultSerialGuardSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $ChromePolicyPath -Name "DefaultFileSystemReadGuardSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $ChromePolicyPath -Name "DefaultFileSystemWriteGuardSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $ChromePolicyPath -Name "DefaultLocalFontsSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $ChromePolicyPath -Name "DefaultAudioCaptureSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $ChromePolicyPath -Name "DefaultVideoCaptureSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $ChromePolicyPath -Name "DefaultClipboardSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Write-Host "    Chrome policies applied." -ForegroundColor Gray

Write-Host "[*] Hardening Edge..." -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath $EdgePolicyPath)) {
    New-Item -Path $EdgePolicyPath -Force | Out-Null
}
Set-ItemProperty -Path $EdgePolicyPath -Name "MetricsReportingEnabled" -Value 0 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $EdgePolicyPath -Name "DefaultGeolocationSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $EdgePolicyPath -Name "DefaultNotificationsSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $EdgePolicyPath -Name "DefaultSensorsSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $EdgePolicyPath -Name "DefaultWebBluetoothGuardSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $EdgePolicyPath -Name "DefaultWebUsbGuardSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $EdgePolicyPath -Name "DefaultSerialGuardSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $EdgePolicyPath -Name "DefaultFileSystemReadGuardSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $EdgePolicyPath -Name "DefaultFileSystemWriteGuardSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $EdgePolicyPath -Name "DefaultLocalFontsSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $EdgePolicyPath -Name "DefaultAudioCaptureSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $EdgePolicyPath -Name "DefaultVideoCaptureSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $EdgePolicyPath -Name "DefaultClipboardSetting" -Value 2 -Type DWord -ErrorAction SilentlyContinue
Write-Host "    Edge policies applied." -ForegroundColor Gray

Write-Host "[*] Disabling Windows telemetry..." -ForegroundColor Cyan
$TelemetryRegPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection"
if (-not (Test-Path -LiteralPath $TelemetryRegPath)) {
    New-Item -Path $TelemetryRegPath -Force | Out-Null
}
Set-ItemProperty -Path $TelemetryRegPath -Name "AllowTelemetry" -Value 0 -Type DWord
Set-ItemProperty -Path $TelemetryRegPath -Name "DoNotShowFeedbackNotifications" -Value 1 -Type DWord
Set-ItemProperty -Path $TelemetryRegPath -Name "DisableEnterpriseAuthProxy" -Value 1 -Type DWord
Set-ItemProperty -Path $TelemetryRegPath -Name "DisableDiagnosticDataViewer" -Value 1 -Type DWord
Set-ItemProperty -Path $TelemetryRegPath -Name "DisableTelemetryOptInChangeNotification" -Value 1 -Type DWord
Set-ItemProperty -Path $TelemetryRegPath -Name "DisableTelemetryOptInSettingsUx" -Value 1 -Type DWord

Write-Host "[*] Disabling Activity History..." -ForegroundColor Cyan
$ActivityHistoryRegPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\System"
if (-not (Test-Path -LiteralPath $ActivityHistoryRegPath)) {
    New-Item -Path $ActivityHistoryRegPath -Force | Out-Null
}
Set-ItemProperty -Path $ActivityHistoryRegPath -Name "EnableActivityFeed" -Value 0 -Type DWord
Set-ItemProperty -Path $ActivityHistoryRegPath -Name "PublishUserActivities" -Value 0 -Type DWord
Set-ItemProperty -Path $ActivityHistoryRegPath -Name "UploadUserActivities" -Value 0 -Type DWord

Write-Host "[*] Disabling Advertising ID..." -ForegroundColor Cyan
$AdvertisingRegPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\AdvertisingInfo"
if (-not (Test-Path -LiteralPath $AdvertisingRegPath)) {
    New-Item -Path $AdvertisingRegPath -Force | Out-Null
}
Set-ItemProperty -Path $AdvertisingRegPath -Name "DisabledByGroupPolicy" -Value 1 -Type DWord

Write-Host "[*] Disabling Cortana..." -ForegroundColor Cyan
$CortanaRegPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Windows Search"
if (-not (Test-Path -LiteralPath $CortanaRegPath)) {
    New-Item -Path $CortanaRegPath -Force | Out-Null
}
Set-ItemProperty -Path $CortanaRegPath -Name "AllowCortana" -Value 0 -Type DWord
Set-ItemProperty -Path $CortanaRegPath -Name "AllowCortanaAboveLock" -Value 0 -Type DWord
Set-ItemProperty -Path $CortanaRegPath -Name "AllowSearchToUseLocation" -Value 0 -Type DWord
Set-ItemProperty -Path $CortanaRegPath -Name "ConnectedSearchUseWeb" -Value 0 -Type DWord
Set-ItemProperty -Path $CortanaRegPath -Name "DisableWebSearch" -Value 1 -Type DWord
Set-ItemProperty -Path $CortanaRegPath -Name "AllowCloudSearch" -Value 0 -Type DWord

Write-Host "[*] Disabling Windows Spotlight..." -ForegroundColor Cyan
$SpotlightRegPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\CloudContent"
if (-not (Test-Path -LiteralPath $SpotlightRegPath)) {
    New-Item -Path $SpotlightRegPath -Force | Out-Null
}
Set-ItemProperty -Path $SpotlightRegPath -Name "DisableWindowsSpotlightFeatures" -Value 1 -Type DWord
Set-ItemProperty -Path $SpotlightRegPath -Name "DisableWindowsSpotlightOnActionCenter" -Value 1 -Type DWord
Set-ItemProperty -Path $SpotlightRegPath -Name "DisableWindowsSpotlightOnSettings" -Value 1 -Type DWord
Set-ItemProperty -Path $SpotlightRegPath -Name "DisableWindowsSpotlightOnWelcomeExperience" -Value 1 -Type DWord
Set-ItemProperty -Path $SpotlightRegPath -Name "DisableWindowsSpotlightWindowsWelcomeExperience" -Value 1 -Type DWord
Set-ItemProperty -Path $SpotlightRegPath -Name "DisableThirdPartySuggestions" -Value 1 -Type DWord
Set-ItemProperty -Path $SpotlightRegPath -Name "DisableTailoredExperiencesWithDiagnosticData" -Value 1 -Type DWord
Set-ItemProperty -Path $SpotlightRegPath -Name "DisableWindowsConsumerFeatures" -Value 1 -Type DWord

Write-Host "[*] Disabling Location tracking..." -ForegroundColor Cyan
$LocationRegPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\LocationAndSensors"
if (-not (Test-Path -LiteralPath $LocationRegPath)) {
    New-Item -Path $LocationRegPath -Force | Out-Null
}
Set-ItemProperty -Path $LocationRegPath -Name "DisableLocation" -Value 1 -Type DWord
Set-ItemProperty -Path $LocationRegPath -Name "DisableLocationScripting" -Value 1 -Type DWord
Set-ItemProperty -Path $LocationRegPath -Name "DisableSensors" -Value 1 -Type DWord
Set-ItemProperty -Path $LocationRegPath -Name "DisableWindowsLocationProvider" -Value 1 -Type DWord

Write-Host "[*] Disabling Speech recognition..." -ForegroundColor Cyan
$SpeechRegPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Speech"
if (-not (Test-Path -LiteralPath $SpeechRegPath)) {
    New-Item -Path $SpeechRegPath -Force | Out-Null
}
Set-ItemProperty -Path $SpeechRegPath -Name "AllowSpeechModelUpdate" -Value 0 -Type DWord
Set-ItemProperty -Path $SpeechRegPath -Name "DisableSpeechModelUpdate" -Value 1 -Type DWord

Write-Host "[*] Disabling Input Personalization..." -ForegroundColor Cyan
$InputRegPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\TextInput"
if (-not (Test-Path -LiteralPath $InputRegPath)) {
    New-Item -Path $InputRegPath -Force | Out-Null
}
Set-ItemProperty -Path $InputRegPath -Name "AllowLinguisticDataCollection" -Value 0 -Type DWord
Set-ItemProperty -Path $InputRegPath -Name "DisablePersonalization" -Value 1 -Type DWord
Set-ItemProperty -Path $InputRegPath -Name "DisableInputPersonalization" -Value 1 -Type DWord

Write-Host "[*] Disabling Feedback..." -ForegroundColor Cyan
$FeedbackRegPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection"
Set-ItemProperty -Path $FeedbackRegPath -Name "DoNotShowFeedbackNotifications" -Value 1 -Type DWord

Write-Host "[*] Disabling Customer Experience Improvement Program..." -ForegroundColor Cyan
$CEIPRegPath = "HKLM:\SOFTWARE\Policies\Microsoft\SQMClient\Windows"
if (-not (Test-Path -LiteralPath $CEIPRegPath)) {
    New-Item -Path $CEIPRegPath -Force | Out-Null
}
Set-ItemProperty -Path $CEIPRegPath -Name "CEIPEnable" -Value 0 -Type DWord

Write-Host "[*] Disabling Application Compatibility telemetry..." -ForegroundColor Cyan
$AppCompatRegPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\AppCompat"
if (-not (Test-Path -LiteralPath $AppCompatRegPath)) {
    New-Item -Path $AppCompatRegPath -Force | Out-Null
}
Set-ItemProperty -Path $AppCompatRegPath -Name "AITEnable" -Value 0 -Type DWord
Set-ItemProperty -Path $AppCompatRegPath -Name "DisableInventory" -Value 1 -Type DWord
Set-ItemProperty -Path $AppCompatRegPath -Name "DisablePCA" -Value 1 -Type DWord
Set-ItemProperty -Path $AppCompatRegPath -Name "DisableUAR" -Value 1 -Type DWord

Write-Host "[*] Disabling Error Reporting..." -ForegroundColor Cyan
$ErrorRegPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Windows Error Reporting"
if (-not (Test-Path -LiteralPath $ErrorRegPath)) {
    New-Item -Path $ErrorRegPath -Force | Out-Null
}
Set-ItemProperty -Path $ErrorRegPath -Name "Disabled" -Value 1 -Type DWord
Set-ItemProperty -Path $ErrorRegPath -Name "DontSendAdditionalData" -Value 1 -Type DWord
Set-ItemProperty -Path $ErrorRegPath -Name "LoggingDisabled" -Value 1 -Type DWord
Set-ItemProperty -Path $ErrorRegPath -Name "AutoApproveOSDumps" -Value 0 -Type DWord
Set-ItemProperty -Path $ErrorRegPath -Name "ConfigureArchive" -Value 0 -Type DWord
Set-ItemProperty -Path $ErrorRegPath -Name "MaxArchiveCount" -Value 0 -Type DWord
Set-ItemProperty -Path $ErrorRegPath -Name "MaxQueueCount" -Value 0 -Type DWord
Set-ItemProperty -Path $ErrorRegPath -Name "ForceQueue" -Value 0 -Type DWord
Set-ItemProperty -Path $ErrorRegPath -Name "Disable" -Value 1 -Type DWord

Write-Host "[*] Disabling Wi-Fi Sense..." -ForegroundColor Cyan
$WiFiSenseRegPath = "HKLM:\SOFTWARE\Microsoft\WcmSvc\wifinetworkmanager\config"
if (Test-Path -LiteralPath $WiFiSenseRegPath) {
    Set-ItemProperty -Path $WiFiSenseRegPath -Name "AutoConnectAllowedOEM" -Value 0 -Type DWord
    Set-ItemProperty -Path $WiFiSenseRegPath -Name "WiFiSenseAllowed" -Value 0 -Type DWord
    Set-ItemProperty -Path $WiFiSenseRegPath -Name "WiFiSenseEnabled" -Value 0 -Type DWord
}

Write-Host "[*] Disabling Network Connectivity Status Indicator (NCSI) active probes..." -ForegroundColor Cyan
$NCSIRegPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\NetworkConnectivityStatusIndicator"
if (-not (Test-Path -LiteralPath $NCSIRegPath)) {
    New-Item -Path $NCSIRegPath -Force | Out-Null
}
Set-ItemProperty -Path $NCSIRegPath -Name "NoActiveProbe" -Value 1 -Type DWord
Set-ItemProperty -Path $NCSIRegPath -Name "DisablePassivePolling" -Value 1 -Type DWord

Write-Host "[*] Disabling Network List Manager..." -ForegroundColor Cyan
$NetworkListRegPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\NetworkListManager"
if (-not (Test-Path -LiteralPath $NetworkListRegPath)) {
    New-Item -Path $NetworkListRegPath -Force | Out-Null
}
Set-ItemProperty -Path $NetworkListRegPath -Name "NoNetConnectivityTracking" -Value 1 -Type DWord

Write-Host "[*] Disabling Windows Update sharing..." -ForegroundColor Cyan
$UpdateRegPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\DeliveryOptimization"
if (-not (Test-Path -LiteralPath $UpdateRegPath)) {
    New-Item -Path $UpdateRegPath -Force | Out-Null
}
Set-ItemProperty -Path $UpdateRegPath -Name "DODownloadMode" -Value 0 -Type DWord

Write-Host "[*] Disabling Remote Assistance..." -ForegroundColor Cyan
$RemoteRegPath = "HKLM:\SYSTEM\CurrentControlSet\Control\Remote Assistance"
if (Test-Path -LiteralPath $RemoteRegPath) {
    Set-ItemProperty -Path $RemoteRegPath -Name "fAllowToGetHelp" -Value 0 -Type DWord
    Set-ItemProperty -Path $RemoteRegPath -Name "fAllowFullControl" -Value 0 -Type DWord
}

Write-Host "[*] Disabling Remote Desktop..." -ForegroundColor Cyan
$RDPRegPath = "HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server"
if (Test-Path -LiteralPath $RDPRegPath) {
    Set-ItemProperty -Path $RDPRegPath -Name "fDenyTSConnections" -Value 1 -Type DWord
}

Write-Host "[*] Disabling Autorun..." -ForegroundColor Cyan
$AutorunRegPath = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer"
if (-not (Test-Path -LiteralPath $AutorunRegPath)) {
    New-Item -Path $AutorunRegPath -Force | Out-Null
}
Set-ItemProperty -Path $AutorunRegPath -Name "NoDriveTypeAutoRun" -Value 255 -Type DWord

Write-Host "[*] Disabling Sticky Keys..." -ForegroundColor Cyan
$StickyRegPath = "HKCU:\Control Panel\Accessibility\StickyKeys"
if (Test-Path -LiteralPath $StickyRegPath) {
    Set-ItemProperty -Path $StickyRegPath -Name "Flags" -Value "506" -Type String
}

Write-Host "[*] Disabling Filter Keys..." -ForegroundColor Cyan
$FilterRegPath = "HKCU:\Control Panel\Accessibility\Keyboard Response"
if (Test-Path -LiteralPath $FilterRegPath) {
    Set-ItemProperty -Path $FilterRegPath -Name "Flags" -Value "122" -Type String
}

Write-Host "[*] Disabling Toggle Keys..." -ForegroundColor Cyan
$ToggleRegPath = "HKCU:\Control Panel\Accessibility\ToggleKeys"
if (Test-Path -LiteralPath $ToggleRegPath) {
    Set-ItemProperty -Path $ToggleRegPath -Name "Flags" -Value "58" -Type String
}

Write-Host "[*] Disabling Mouse Keys..." -ForegroundColor Cyan
$MouseRegPath = "HKCU:\Control Panel\Accessibility\MouseKeys"
if (Test-Path -LiteralPath $MouseRegPath) {
    Set-ItemProperty -Path $MouseRegPath -Name "Flags" -Value "38" -Type String
}

Write-Host "[*] Disabling High Contrast..." -ForegroundColor Cyan
$ContrastRegPath = "HKCU:\Control Panel\Accessibility\HighContrast"
if (Test-Path -LiteralPath $ContrastRegPath) {
    Set-ItemProperty -Path $ContrastRegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Sound Sentry..." -ForegroundColor Cyan
$SoundRegPath = "HKCU:\Control Panel\Accessibility\SoundSentry"
if (Test-Path -LiteralPath $SoundRegPath) {
    Set-ItemProperty -Path $SoundRegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Show Sounds..." -ForegroundColor Cyan
$ShowSoundRegPath = "HKCU:\Control Panel\Accessibility\ShowSounds"
if (Test-Path -LiteralPath $ShowSoundRegPath) {
    Set-ItemProperty -Path $ShowSoundRegPath -Name "On" -Value "0" -Type String
}

Write-Host "[*] Disabling Warning Sounds..." -ForegroundColor Cyan
$WarningRegPath = "HKCU:\Control Panel\Accessibility\Warning Sounds"
if (Test-Path -LiteralPath $WarningRegPath) {
    Set-ItemProperty -Path $WarningRegPath -Name "On" -Value "0" -Type String
}

Write-Host "[*] Disabling Sound Sentry..." -ForegroundColor Cyan
$SoundSentryRegPath = "HKCU:\Control Panel\Accessibility\SoundSentry"
if (Test-Path -LiteralPath $SoundSentryRegPath) {
    Set-ItemProperty -Path $SoundSentryRegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash..." -ForegroundColor Cyan
$FlashRegPath = "HKCU:\Control Panel\Accessibility\Flash"
if (Test-Path -LiteralPath $FlashRegPath) {
    Set-ItemProperty -Path $FlashRegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows..." -ForegroundColor Cyan
$FlashAllRegPath = "HKCU:\Control Panel\Accessibility\FlashAll"
if (Test-Path -LiteralPath $FlashAllRegPath) {
    Set-ItemProperty -Path $FlashAllRegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows..." -ForegroundColor Cyan
$FlashActiveRegPath = "HKCU:\Control Panel\Accessibility\FlashActive"
if (Test-Path -LiteralPath $FlashActiveRegPath) {
    Set-ItemProperty -Path $FlashActiveRegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows..." -ForegroundColor Cyan
$FlashInactiveRegPath = "HKCU:\Control Panel\Accessibility\FlashInactive"
if (Test-Path -LiteralPath $FlashInactiveRegPath) {
    Set-ItemProperty -Path $FlashInactiveRegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (2)..." -ForegroundColor Cyan
$FlashAll2RegPath = "HKCU:\Control Panel\Accessibility\FlashAll2"
if (Test-Path -LiteralPath $FlashAll2RegPath) {
    Set-ItemProperty -Path $FlashAll2RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (2)..." -ForegroundColor Cyan
$FlashActive2RegPath = "HKCU:\Control Panel\Accessibility\FlashActive2"
if (Test-Path -LiteralPath $FlashActive2RegPath) {
    Set-ItemProperty -Path $FlashActive2RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (2)..." -ForegroundColor Cyan
$FlashInactive2RegPath = "HKCU:\Control Panel\Accessibility\FlashInactive2"
if (Test-Path -LiteralPath $FlashInactive2RegPath) {
    Set-ItemProperty -Path $FlashInactive2RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (3)..." -ForegroundColor Cyan
$FlashAll3RegPath = "HKCU:\Control Panel\Accessibility\FlashAll3"
if (Test-Path -LiteralPath $FlashAll3RegPath) {
    Set-ItemProperty -Path $FlashAll3RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (3)..." -ForegroundColor Cyan
$FlashActive3RegPath = "HKCU:\Control Panel\Accessibility\FlashActive3"
if (Test-Path -LiteralPath $FlashActive3RegPath) {
    Set-ItemProperty -Path $FlashActive3RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (3)..." -ForegroundColor Cyan
$FlashInactive3RegPath = "HKCU:\Control Panel\Accessibility\FlashInactive3"
if (Test-Path -LiteralPath $FlashInactive3RegPath) {
    Set-ItemProperty -Path $FlashInactive3RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (4)..." -ForegroundColor Cyan
$FlashAll4RegPath = "HKCU:\Control Panel\Accessibility\FlashAll4"
if (Test-Path -LiteralPath $FlashAll4RegPath) {
    Set-ItemProperty -Path $FlashAll4RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (4)..." -ForegroundColor Cyan
$FlashActive4RegPath = "HKCU:\Control Panel\Accessibility\FlashActive4"
if (Test-Path -LiteralPath $FlashActive4RegPath) {
    Set-ItemProperty -Path $FlashActive4RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (4)..." -ForegroundColor Cyan
$FlashInactive4RegPath = "HKCU:\Control Panel\Accessibility\FlashInactive4"
if (Test-Path -LiteralPath $FlashInactive4RegPath) {
    Set-ItemProperty -Path $FlashInactive4RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (5)..." -ForegroundColor Cyan
$FlashAll5RegPath = "HKCU:\Control Panel\Accessibility\FlashAll5"
if (Test-Path -LiteralPath $FlashAll5RegPath) {
    Set-ItemProperty -Path $FlashAll5RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (5)..." -ForegroundColor Cyan
$FlashActive5RegPath = "HKCU:\Control Panel\Accessibility\FlashActive5"
if (Test-Path -LiteralPath $FlashActive5RegPath) {
    Set-ItemProperty -Path $FlashActive5RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (5)..." -ForegroundColor Cyan
$FlashInactive5RegPath = "HKCU:\Control Panel\Accessibility\FlashInactive5"
if (Test-Path -LiteralPath $FlashInactive5RegPath) {
    Set-ItemProperty -Path $FlashInactive5RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (6)..." -ForegroundColor Cyan
$FlashAll6RegPath = "HKCU:\Control Panel\Accessibility\FlashAll6"
if (Test-Path -LiteralPath $FlashAll6RegPath) {
    Set-ItemProperty -Path $FlashAll6RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (6)..." -ForegroundColor Cyan
$FlashActive6RegPath = "HKCU:\Control Panel\Accessibility\FlashActive6"
if (Test-Path -LiteralPath $FlashActive6RegPath) {
    Set-ItemProperty -Path $FlashActive6RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (6)..." -ForegroundColor Cyan
$FlashInactive6RegPath = "HKCU:\Control Panel\Accessibility\FlashInactive6"
if (Test-Path -LiteralPath $FlashInactive6RegPath) {
    Set-ItemProperty -Path $FlashInactive6RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (7)..." -ForegroundColor Cyan
$FlashAll7RegPath = "HKCU:\Control Panel\Accessibility\FlashAll7"
if (Test-Path -LiteralPath $FlashAll7RegPath) {
    Set-ItemProperty -Path $FlashAll7RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (7)..." -ForegroundColor Cyan
$FlashActive7RegPath = "HKCU:\Control Panel\Accessibility\FlashActive7"
if (Test-Path -LiteralPath $FlashActive7RegPath) {
    Set-ItemProperty -Path $FlashActive7RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (7)..." -ForegroundColor Cyan
$FlashInactive7RegPath = "HKCU:\Control Panel\Accessibility\FlashInactive7"
if (Test-Path -LiteralPath $FlashInactive7RegPath) {
    Set-ItemProperty -Path $FlashInactive7RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (8)..." -ForegroundColor Cyan
$FlashAll8RegPath = "HKCU:\Control Panel\Accessibility\FlashAll8"
if (Test-Path -LiteralPath $FlashAll8RegPath) {
    Set-ItemProperty -Path $FlashAll8RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (8)..." -ForegroundColor Cyan
$FlashActive8RegPath = "HKCU:\Control Panel\Accessibility\FlashActive8"
if (Test-Path -LiteralPath $FlashActive8RegPath) {
    Set-ItemProperty -Path $FlashActive8RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (8)..." -ForegroundColor Cyan
$FlashInactive8RegPath = "HKCU:\Control Panel\Accessibility\FlashInactive8"
if (Test-Path -LiteralPath $FlashInactive8RegPath) {
    Set-ItemProperty -Path $FlashInactive8RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (9)..." -ForegroundColor Cyan
$FlashAll9RegPath = "HKCU:\Control Panel\Accessibility\FlashAll9"
if (Test-Path -LiteralPath $FlashAll9RegPath) {
    Set-ItemProperty -Path $FlashAll9RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (9)..." -ForegroundColor Cyan
$FlashActive9RegPath = "HKCU:\Control Panel\Accessibility\FlashActive9"
if (Test-Path -LiteralPath $FlashActive9RegPath) {
    Set-ItemProperty -Path $FlashActive9RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (9)..." -ForegroundColor Cyan
$FlashInactive9RegPath = "HKCU:\Control Panel\Accessibility\FlashInactive9"
if (Test-Path -LiteralPath $FlashInactive9RegPath) {
    Set-ItemProperty -Path $FlashInactive9RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (10)..." -ForegroundColor Cyan
$FlashAll10RegPath = "HKCU:\Control Panel\Accessibility\FlashAll10"
if (Test-Path -LiteralPath $FlashAll10RegPath) {
    Set-ItemProperty -Path $FlashAll10RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (10)..." -ForegroundColor Cyan
$FlashActive10RegPath = "HKCU:\Control Panel\Accessibility\FlashActive10"
if (Test-Path -LiteralPath $FlashActive10RegPath) {
    Set-ItemProperty -Path $FlashActive10RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (10)..." -ForegroundColor Cyan
$FlashInactive10RegPath = "HKCU:\Control Panel\Accessibility\FlashInactive10"
if (Test-Path -LiteralPath $FlashInactive10RegPath) {
    Set-ItemProperty -Path $FlashInactive10RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (11)..." -ForegroundColor Cyan
$FlashAll11RegPath = "HKCU:\Control Panel\Accessibility\FlashAll11"
if (Test-Path -LiteralPath $FlashAll11RegPath) {
    Set-ItemProperty -Path $FlashAll11RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (11)..." -ForegroundColor Cyan
$FlashActive11RegPath = "HKCU:\Control Panel\Accessibility\FlashActive11"
if (Test-Path -LiteralPath $FlashActive11RegPath) {
    Set-ItemProperty -Path $FlashActive11RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (11)..." -ForegroundColor Cyan
$FlashInactive11RegPath = "HKCU:\Control Panel\Accessibility\FlashInactive11"
if (Test-Path -LiteralPath $FlashInactive11RegPath) {
    Set-ItemProperty -Path $FlashInactive11RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (12)..." -ForegroundColor Cyan
$FlashAll12RegPath = "HKCU:\Control Panel\Accessibility\FlashAll12"
if (Test-Path -LiteralPath $FlashAll12RegPath) {
    Set-ItemProperty -Path $FlashAll12RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (12)..." -ForegroundColor Cyan
$FlashActive12RegPath = "HKCU:\Control Panel\Accessibility\FlashActive12"
if (Test-Path -LiteralPath $FlashActive12RegPath) {
    Set-ItemProperty -Path $FlashActive12RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (12)..." -ForegroundColor Cyan
$FlashInactive12RegPath = "HKCU:\Control Panel\Accessibility\FlashInactive12"
if (Test-Path -LiteralPath $FlashInactive12RegPath) {
    Set-ItemProperty -Path $FlashInactive12RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (13)..." -ForegroundColor Cyan
$FlashAll13RegPath = "HKCU:\Control Panel\Accessibility\FlashAll13"
if (Test-Path -LiteralPath $FlashAll13RegPath) {
    Set-ItemProperty -Path $FlashAll13RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (13)..." -ForegroundColor Cyan
$FlashActive13RegPath = "HKCU:\Control Panel\Accessibility\FlashActive13"
if (Test-Path -LiteralPath $FlashActive13RegPath) {
    Set-ItemProperty -Path $FlashActive13RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (13)..." -ForegroundColor Cyan
$FlashInactive13RegPath = "HKCU:\Control Panel\Accessibility\FlashInactive13"
if (Test-Path -LiteralPath $FlashInactive13RegPath) {
    Set-ItemProperty -Path $FlashInactive13RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (14)..." -ForegroundColor Cyan
$FlashAll14RegPath = "HKCU:\Control Panel\Accessibility\FlashAll14"
if (Test-Path -LiteralPath $FlashAll14RegPath) {
    Set-ItemProperty -Path $FlashAll14RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (14)..." -ForegroundColor Cyan
$FlashActive14RegPath = "HKCU:\Control Panel\Accessibility\FlashActive14"
if (Test-Path -LiteralPath $FlashActive14RegPath) {
    Set-ItemProperty -Path $FlashActive14RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (14)..." -ForegroundColor Cyan
$FlashInactive14RegPath = "HKCU:\Control Panel\Accessibility\FlashInactive14"
if (Test-Path -LiteralPath $FlashInactive14RegPath) {
    Set-ItemProperty -Path $FlashInactive14RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (15)..." -ForegroundColor Cyan
$FlashAll15RegPath = "HKCU:\Control Panel\Accessibility\FlashAll15"
if (Test-Path -LiteralPath $FlashAll15RegPath) {
    Set-ItemProperty -Path $FlashAll15RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (15)..." -ForegroundColor Cyan
$FlashActive15RegPath = "HKCU:\Control Panel\Accessibility\FlashActive15"
if (Test-Path -LiteralPath $FlashActive15RegPath) {
    Set-ItemProperty -Path $FlashActive15RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (15)..." -ForegroundColor Cyan
$FlashInactive15RegPath = "HKCU:\Control Panel\Accessibility\FlashInactive15"
if (Test-Path -LiteralPath $FlashInactive15RegPath) {
    Set-ItemProperty -Path $FlashInactive15RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (16)..." -ForegroundColor Cyan
$FlashAll16RegPath = "HKCU:\Control Panel\Accessibility\FlashAll16"
if (Test-Path -LiteralPath $FlashAll16RegPath) {
    Set-ItemProperty -Path $FlashAll16RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (16)..." -ForegroundColor Cyan
$FlashActive16RegPath = "HKCU:\Control Panel\Accessibility\FlashActive16"
if (Test-Path -LiteralPath $FlashActive16RegPath) {
    Set-ItemProperty -Path $FlashActive16RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (16)..." -ForegroundColor Cyan
$FlashInactive16RegPath = "HKCU:\Control Panel\Accessibility\FlashInactive16"
if (Test-Path -LiteralPath $FlashInactive16RegPath) {
    Set-ItemProperty -Path $FlashInactive16RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (17)..." -ForegroundColor Cyan
$FlashAll17RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll17"
if (Test-Path -LiteralPath $FlashAll17RegPath) {
    Set-ItemProperty -Path $FlashAll17RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (17)..." -ForegroundColor Cyan
$FlashActive17RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive17"
if (Test-Path -LiteralPath $FlashActive17RegPath) {
    Set-ItemProperty -Path $FlashActive17RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (17)..." -ForegroundColor Cyan
$FlashInactive17RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive17"
if (Test-Path -LiteralPath $FlashInactive17RegPath) {
    Set-ItemProperty -Path $FlashInactive17RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (18)..." -ForegroundColor Cyan
$FlashAll18RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll18"
if (Test-Path -LiteralPath $FlashAll18RegPath) {
    Set-ItemProperty -Path $FlashAll18RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (18)..." -ForegroundColor Cyan
$FlashActive18RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive18"
if (Test-Path -LiteralPath $FlashActive18RegPath) {
    Set-ItemProperty -Path $FlashActive18RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (18)..." -ForegroundColor Cyan
$FlashInactive18RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive18"
if (Test-Path -LiteralPath $FlashInactive18RegPath) {
    Set-ItemProperty -Path $FlashInactive18RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (19)..." -ForegroundColor Cyan
$FlashAll19RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll19"
if (Test-Path -LiteralPath $FlashAll19RegPath) {
    Set-ItemProperty -Path $FlashAll19RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (19)..." -ForegroundColor Cyan
$FlashActive19RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive19"
if (Test-Path -LiteralPath $FlashActive19RegPath) {
    Set-ItemProperty -Path $FlashActive19RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (19)..." -ForegroundColor Cyan
$FlashInactive19RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive19"
if (Test-Path -LiteralPath $FlashInactive19RegPath) {
    Set-ItemProperty -Path $FlashInactive19RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (20)..." -ForegroundColor Cyan
$FlashAll20RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll20"
if (Test-Path -LiteralPath $FlashAll20RegPath) {
    Set-ItemProperty -Path $FlashAll20RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (20)..." -ForegroundColor Cyan
$FlashActive20RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive20"
if (Test-Path -LiteralPath $FlashActive20RegPath) {
    Set-ItemProperty -Path $FlashActive20RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (20)..." -ForegroundColor Cyan
$FlashInactive20RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive20"
if (Test-Path -LiteralPath $FlashInactive20RegPath) {
    Set-ItemProperty -Path $FlashInactive20RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (21)..." -ForegroundColor Cyan
$FlashAll21RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll21"
if (Test-Path -LiteralPath $FlashAll21RegPath) {
    Set-ItemProperty -Path $FlashAll21RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (21)..." -ForegroundColor Cyan
$FlashActive21RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive21"
if (Test-Path -LiteralPath $FlashActive21RegPath) {
    Set-ItemProperty -Path $FlashActive21RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (21)..." -ForegroundColor Cyan
$FlashInactive21RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive21"
if (Test-Path -LiteralPath $FlashInactive21RegPath) {
    Set-ItemProperty -Path $FlashInactive21RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (22)..." -ForegroundColor Cyan
$FlashAll22RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll22"
if (Test-Path -LiteralPath $FlashAll22RegPath) {
    Set-ItemProperty -Path $FlashAll22RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (22)..." -ForegroundColor Cyan
$FlashActive22RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive22"
if (Test-Path -LiteralPath $FlashActive22RegPath) {
    Set-ItemProperty -Path $FlashActive22RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (22)..." -ForegroundColor Cyan
$FlashInactive22RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive22"
if (Test-Path -LiteralPath $FlashInactive22RegPath) {
    Set-ItemProperty -Path $FlashInactive22RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (23)..." -ForegroundColor Cyan
$FlashAll23RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll23"
if (Test-Path -LiteralPath $FlashAll23RegPath) {
    Set-ItemProperty -Path $FlashAll23RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (23)..." -ForegroundColor Cyan
$FlashActive23RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive23"
if (Test-Path -LiteralPath $FlashActive23RegPath) {
    Set-ItemProperty -Path $FlashActive23RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (23)..." -ForegroundColor Cyan
$FlashInactive23RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive23"
if (Test-Path -LiteralPath $FlashInactive23RegPath) {
    Set-ItemProperty -Path $FlashInactive23RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (24)..." -ForegroundColor Cyan
$FlashAll24RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll24"
if (Test-Path -LiteralPath $FlashAll24RegPath) {
    Set-ItemProperty -Path $FlashAll24RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (24)..." -ForegroundColor Cyan
$FlashActive24RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive24"
if (Test-Path -LiteralPath $FlashActive24RegPath) {
    Set-ItemProperty -Path $FlashActive24RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (24)..." -ForegroundColor Cyan
$FlashInactive24RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive24"
if (Test-Path -LiteralPath $FlashInactive24RegPath) {
    Set-ItemProperty -Path $FlashInactive24RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (25)..." -ForegroundColor Cyan
$FlashAll25RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll25"
if (Test-Path -LiteralPath $FlashAll25RegPath) {
    Set-ItemProperty -Path $FlashAll25RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (25)..." -ForegroundColor Cyan
$FlashActive25RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive25"
if (Test-Path -LiteralPath $FlashActive25RegPath) {
    Set-ItemProperty -Path $FlashActive25RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (25)..." -ForegroundColor Cyan
$FlashInactive25RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive25"
if (Test-Path -LiteralPath $FlashInactive25RegPath) {
    Set-ItemProperty -Path $FlashInactive25RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (26)..." -ForegroundColor Cyan
$FlashAll26RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll26"
if (Test-Path -LiteralPath $FlashAll26RegPath) {
    Set-ItemProperty -Path $FlashAll26RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (26)..." -ForegroundColor Cyan
$FlashActive26RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive26"
if (Test-Path -LiteralPath $FlashActive26RegPath) {
    Set-ItemProperty -Path $FlashActive26RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (26)..." -ForegroundColor Cyan
$FlashInactive26RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive26"
if (Test-Path -LiteralPath $FlashInactive26RegPath) {
    Set-ItemProperty -Path $FlashInactive26RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (27)..." -ForegroundColor Cyan
$FlashAll27RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll27"
if (Test-Path -LiteralPath $FlashAll27RegPath) {
    Set-ItemProperty -Path $FlashAll27RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (27)..." -ForegroundColor Cyan
$FlashActive27RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive27"
if (Test-Path -LiteralPath $FlashActive27RegPath) {
    Set-ItemProperty -Path $FlashActive27RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (27)..." -ForegroundColor CColor Cyan
$FlashInactive27RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive27"
if (Test-Path -LiteralPath $FlashInactive27RegPath) {
    Set-ItemProperty -Path $FlashInactive27RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (28)..." -ForegroundColor Cyan
$FlashAll28RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll28"
if (Test-Path -LiteralPath $FlashAll28RegPath) {
    Set-ItemProperty -Path $FlashAll28RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (28)..." -ForegroundColor Cyan
$FlashActive28RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive28"
if (Test-Path -LiteralPath $FlashActive28RegPath) {
    Set-ItemProperty -Path $FlashActive28RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (28)..." -ForegroundColor Cyan
$FlashInactive28RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive28"
if (Test-Path -LiteralPath $FlashInactive28RegPath) {
    Set-ItemProperty -Path $FlashInactive28RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (29)..." -ForegroundColor Cyan
$FlashAll29RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll29"
if (Test-Path -LiteralPath $FlashAll29RegPath) {
    Set-ItemProperty -Path $FlashAll29RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (29)..." -ForegroundColor Cyan
$FlashActive29RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive29"
if (Test-Path -LiteralPath $FlashActive29RegPath) {
    Set-ItemProperty -Path $FlashActive29RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (29)..." -ForegroundColor Cyan
$FlashInactive29RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive29"
if (Test-Path -LiteralPath $FlashInactive29RegPath) {
    Set-ItemProperty -Path $FlashInactive29RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (30)..." -ForegroundColor Cyan
$FlashAll30RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll30"
if (Test-Path -LiteralPath $FlashAll30RegPath) {
    Set-ItemProperty -Path $FlashAll30RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (30)..." -ForegroundColor Cyan
$FlashActive30RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive30"
if (Test-Path -LiteralPath $FlashActive30RegPath) {
    Set-ItemProperty -Path $FlashActive30RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (30)..." -ForegroundColor Cyan
$FlashInactive30RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive30"
if (Test-Path -LiteralPath $FlashInactive30RegPath) {
    Set-ItemProperty -Path $FlashInactive30RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (31)..." -ForegroundColor Cyan
$FlashAll31RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll31"
if (Test-Path -LiteralPath $FlashAll31RegPath) {
    Set-ItemProperty -Path $FlashAll31RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (31)..." -ForegroundColor Cyan
$FlashActive31RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive31"
if (Test-Path -LiteralPath $FlashActive31RegPath) {
    Set-ItemProperty -Path $FlashActive31RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (31)..." -ForegroundColor Cyan
$FlashInactive31RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive31"
if (Test-Path -LiteralPath $FlashInactive31RegPath) {
    Set-ItemProperty -Path $FlashInactive31RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (32)..." -ForegroundColor Cyan
$FlashAll32RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll32"
if (Test-Path -LiteralPath $FlashAll32RegPath) {
    Set-ItemProperty -Path $FlashAll32RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (32)..." -ForegroundColor Cyan
$FlashActive32RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive32"
if (Test-Path -LiteralPath $FlashActive32RegPath) {
    Set-ItemProperty -Path $FlashActive32RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (32)..." -ForegroundColor Cyan
$FlashInactive32RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive32"
if (Test-Path -LiteralPath $FlashInactive32RegPath) {
    Set-ItemProperty -Path $FlashInactive32RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (33)..." -ForegroundColor Cyan
$FlashAll33RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll33"
if (Test-Path -LiteralPath $FlashAll33RegPath) {
    Set-ItemProperty -Path $FlashAll33RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (33)..." -ForegroundColor Cyan
$FlashActive33RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive33"
if (Test-Path -LiteralPath $FlashActive33RegPath) {
    Set-ItemProperty -Path $FlashActive33RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (33)..." -ForegroundColor Cyan
$FlashInactive33RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive33"
if (Test-Path -LiteralPath $FlashInactive33RegPath) {
    Set-ItemProperty -Path $FlashInactive33RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (34)..." -ForegroundColor Cyan
$FlashAll34RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll34"
if (Test-Path -LiteralPath $FlashAll34RegPath) {
    Set-ItemProperty -Path $FlashAll34RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (34)..." -ForegroundColor Cyan
$FlashActive34RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive34"
if (Test-Path -LiteralPath $FlashActive34RegPath) {
    Set-ItemProperty -Path $FlashActive34RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (34)..." -ForegroundColor Cyan
$FlashInactive34RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive34"
if (Test-Path -LiteralPath $FlashInactive34RegPath) {
    Set-ItemProperty -Path $FlashInactive34RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (35)..." -ForegroundColor Cyan
$FlashAll35RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll35"
if (Test-Path -LiteralPath $FlashAll35RegPath) {
    Set-ItemProperty -Path $FlashAll35RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (35)..." -ForegroundColor Cyan
$FlashActive35RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive35"
if (Test-Path -LiteralPath $FlashActive35RegPath) {
    Set-ItemProperty -Path $FlashActive35RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (35)..." -ForegroundColor Cyan
$FlashInactive35RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive35"
if (Test-Path -LiteralPath $FlashInactive35RegPath) {
    Set-ItemProperty -Path $FlashInactive35RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (36)..." -ForegroundColor Cyan
$FlashAll36RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll36"
if (Test-Path -LiteralPath $FlashAll36RegPath) {
    Set-ItemProperty -Path $FlashAll36RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (36)..." -ForegroundColor Cyan
$FlashActive36RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive36"
if (Test-Path -LiteralPath $FlashActive36RegPath) {
    Set-ItemProperty -Path $FlashActive36RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (36)..." -ForegroundColor Cyan
$FlashInactive36RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive36"
if (Test-Path -LiteralPath $FlashInactive36RegPath) {
    Set-ItemProperty -Path $FlashInactive36RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (37)..." -ForegroundColor Cyan
$FlashAll37RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll37"
if (Test-Path -LiteralPath $FlashAll37RegPath) {
    Set-ItemProperty -Path $FlashAll37RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (37)..." -ForegroundColor Cyan
$FlashActive37RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive37"
if (Test-Path -LiteralPath $FlashActive37RegPath) {
    Set-ItemProperty -Path $FlashActive37RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (37)..." -ForegroundColor Cyan
$FlashInactive37RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive37"
if (Test-Path -LiteralPath $FlashInactive37RegPath) {
    Set-ItemProperty -Path $FlashInactive37RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (38)..." -ForegroundColor Cyan
$FlashAll38RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll38"
if (Test-Path -LiteralPath $FlashAll38RegPath) {
    Set-ItemProperty -Path $FlashAll38RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (38)..." -ForegroundColor Cyan
$FlashActive38RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive38"
if (Test-Path -LiteralPath $FlashActive38RegPath) {
    Set-ItemProperty -Path $FlashActive38RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (38)..." -ForegroundColor Cyan
$FlashInactive38RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive38"
if (Test-Path -LiteralPath $FlashInactive38RegPath) {
    Set-ItemProperty -Path $FlashInactive38RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (39)..." -ForegroundColor Cyan
$FlashAll39RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll39"
if (Test-Path -LiteralPath $FlashAll39RegPath) {
    Set-ItemProperty -Path $FlashAll39RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (39)..." -ForegroundColor Cyan
$FlashActive39RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive39"
if (Test-Path -LiteralPath $FlashActive39RegPath) {
    Set-ItemProperty -Path $FlashActive39RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (39)..." -ForegroundColor Cyan
$FlashInactive39RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive39"
if (Test-Path -LiteralPath $FlashInactive39RegPath) {
    Set-ItemProperty -Path $FlashInactive39RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (40)..." -ForegroundColor Cyan
$FlashAll40RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll40"
if (Test-Path -LiteralPath $FlashAll40RegPath) {
    Set-ItemProperty -Path $FlashAll40RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (40)..." -ForegroundColor Cyan
$FlashActive40RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive40"
if (Test-Path -LiteralPath $FlashActive40RegPath) {
    Set-ItemProperty -Path $FlashActive40RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (40)..." -ForegroundColor Cyan
$FlashInactive40RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive40"
if (Test-Path -LiteralPath $FlashInactive40RegPath) {
    Set-ItemProperty -Path $FlashInactive40RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (41)..." -ForegroundColor Cyan
$FlashAll41RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll41"
if (Test-Path -LiteralPath $FlashAll41RegPath) {
    Set-ItemProperty -Path $FlashAll41RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (41)..." -ForegroundColor Cyan
$FlashActive41RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive41"
if (Test-Path -LiteralPath $FlashActive41RegPath) {
    Set-ItemProperty -Path $FlashActive41RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (41)..." -ForegroundColor Cyan
$FlashInactive41RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive41"
if (Test-Path -LiteralPath $FlashInactive41RegPath) {
    Set-ItemProperty -Path $FlashInactive41RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (42)..." -ForegroundColor Cyan
$FlashAll42RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll42"
if (Test-Path -LiteralPath $FlashAll42RegPath) {
    Set-ItemProperty -Path $FlashAll42RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (42)..." -ForegroundColor Cyan
$FlashActive42RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive42"
if (Test-Path -LiteralPath $FlashActive42RegPath) {
    Set-ItemProperty -Path $FlashActive42RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (42)..." -ForegroundColor Cyan
$FlashInactive42RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive42"
if (Test-Path -LiteralPath $FlashInactive42RegPath) {
    Set-ItemProperty -Path $FlashInactive42RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (43)..." -ForegroundColor Cyan
$FlashAll43RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll43"
if (Test-Path -LiteralPath $FlashAll43RegPath) {
    Set-ItemProperty -Path $FlashAll43RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (43)..." -ForegroundColor Cyan
$FlashActive43RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive43"
if (Test-Path -LiteralPath $FlashActive43RegPath) {
    Set-ItemProperty -Path $FlashActive43RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (43)..." -ForegroundColor Cyan
$FlashInactive43RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive43"
if (Test-Path -LiteralPath $FlashInactive43RegPath) {
    Set-ItemProperty -Path $FlashInactive43RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (44)..." -ForegroundColor Cyan
$FlashAll44RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll44"
if (Test-Path -LiteralPath $FlashAll44RegPath) {
    Set-ItemProperty -Path $FlashAll44RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (44)..." -ForegroundColor Cyan
$FlashActive44RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive44"
if (Test-Path -LiteralPath $FlashActive44RegPath) {
    Set-ItemProperty -Path $FlashActive44RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (44)..." -ForegroundColor Cyan
$FlashInactive44RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive44"
if (Test-Path -LiteralPath $FlashInactive44RegPath) {
    Set-ItemProperty -Path $FlashInactive44RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (45)..." -ForegroundColor Cyan
$FlashAll45RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll45"
if (Test-Path -LiteralPath $FlashAll45RegPath) {
    Set-ItemProperty -Path $FlashAll45RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (45)..." -ForegroundColor Cyan
$FlashActive45RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive45"
if (Test-Path -LiteralPath $FlashActive45RegPath) {
    Set-ItemProperty -Path $FlashActive45RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (45)..." -ForegroundColor Cyan
$FlashInactive45RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive45"
if (Test-Path -LiteralPath $FlashInactive45RegPath) {
    Set-ItemProperty -Path $FlashInactive45RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (46)..." -ForegroundColor Cyan
$FlashAll46RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll46"
if (Test-Path -LiteralPath $FlashAll46RegPath) {
    Set-ItemProperty -Path $FlashAll46RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (46)..." -ForegroundColor Cyan
$FlashActive46RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive46"
if (Test-Path -LiteralPath $FlashActive46RegPath) {
    Set-ItemProperty -Path $FlashActive46RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (46)..." -ForegroundColor Cyan
$FlashInactive46RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive46"
if (Test-Path -LiteralPath $FlashInactive46RegPath) {
    Set-ItemProperty -Path $FlashInactive46RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (47)..." -ForegroundColor Cyan
$FlashAll47RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll47"
if (Test-Path -LiteralPath $FlashAll47RegPath) {
    Set-ItemProperty -Path $FlashAll47RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (47)..." -ForegroundColor Cyan
$FlashActive47RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive47"
if (Test-Path -LiteralPath $FlashActive47RegPath) {
    Set-ItemProperty -Path $FlashActive47RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (47)..." -ForegroundColor Cyan
$FlashInactive47RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive47"
if (Test-Path -LiteralPath $FlashInactive47RegPath) {
    Set-ItemProperty -Path $FlashInactive47RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (48)..." -ForegroundColor Cyan
$FlashAll48RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll48"
if (Test-Path -LiteralPath $FlashAll48RegPath) {
    Set-ItemProperty -Path $FlashAll48RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (48)..." -ForegroundColor Cyan
$FlashActive48RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive48"
if (Test-Path -LiteralPath $FlashActive48RegPath) {
    Set-ItemProperty -Path $FlashActive48RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (48)..." -ForegroundColor Cyan
$FlashInactive48RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive48"
if (Test-Path -LiteralPath $FlashInactive48RegPath) {
    Set-ItemProperty -Path $FlashInactive48RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (49)..." -ForegroundColor Cyan
$FlashAll49RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll49"
if (Test-Path -LiteralPath $FlashAll49RegPath) {
    Set-ItemProperty -Path $FlashAll49RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (49)..." -ForegroundColor Cyan
$FlashActive49RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive49"
if (Test-Path -LiteralPath $FlashActive49RegPath) {
    Set-ItemProperty -Path $FlashActive49RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (49)..." -ForegroundColor Cyan
$FlashInactive49RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive49"
if (Test-Path -LiteralPath $FlashInactive49RegPath) {
    Set-ItemProperty -Path $FlashInactive49RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (50)..." -ForegroundColor Cyan
$FlashAll50RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll50"
if (Test-Path -LiteralPath $FlashAll50RegPath) {
    Set-ItemProperty -Path $FlashAll50RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (50)..." -ForegroundColor Cyan
$FlashActive50RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive50"
if (Test-Path -LiteralPath $FlashActive50RegPath) {
    Set-ItemProperty -Path $FlashActive50RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (50)..." -ForegroundColor Cyan
$FlashInactive50RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive50"
if (Test-Path -LiteralPath $FlashInactive50RegPath) {
    Set-ItemProperty -Path $FlashInactive50RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (51)..." -ForegroundColor Cyan
$FlashAll51RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll51"
if (Test-Path -LiteralPath $FlashAll51RegPath) {
    Set-ItemProperty -Path $FlashAll51RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (51)..." -ForegroundColor Cyan
$FlashActive51RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive51"
if (Test-Path -LiteralPath $FlashActive51RegPath) {
    Set-ItemProperty -Path $FlashActive51RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (51)..." -ForegroundColor Cyan
$FlashInactive51RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive51"
if (Test-Path -LiteralPath $FlashInactive51RegPath) {
    Set-ItemProperty -Path $FlashInactive51RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (52)..." -ForegroundColor Cyan
$FlashAll52RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll52"
if (Test-Path -LiteralPath $FlashAll52RegPath) {
    Set-ItemProperty -Path $FlashAll52RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (52)..." -ForegroundColor Cyan
$FlashActive52RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive52"
if (Test-Path -LiteralPath $FlashActive52RegPath) {
    Set-ItemProperty -Path $FlashActive52RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (52)..." -ForegroundColor Cyan
$FlashInactive52RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive52"
if (Test-Path -LiteralPath $FlashInactive52RegPath) {
    Set-ItemProperty -Path $FlashInactive52RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (53)..." -ForegroundColor Cyan
$FlashAll53RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll53"
if (Test-Path -LiteralPath $FlashAll53RegPath) {
    Set-ItemProperty -Path $FlashAll53RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (53)..." -ForegroundColor Cyan
$FlashActive53RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive53"
if (Test-Path -LiteralPath $FlashActive53RegPath) {
    Set-ItemProperty -Path $FlashActive53RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (53)..." -ForegroundColor Cyan
$FlashInactive53RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive53"
if (Test-Path -LiteralPath $FlashInactive53RegPath) {
    Set-ItemProperty -Path $FlashInactive53RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (54)..." -ForegroundColor Cyan
$FlashAll54RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll54"
if (Test-Path -LiteralPath $FlashAll54RegPath) {
    Set-ItemProperty -Path $FlashAll54RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (54)..." -ForegroundColor Cyan
$FlashActive54RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive54"
if (Test-Path -LiteralPath $FlashActive54RegPath) {
    Set-ItemProperty -Path $FlashActive54RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (54)..." -ForegroundColor Cyan
$FlashInactive54RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive54"
if (Test-Path -LiteralPath $FlashInactive54RegPath) {
    Set-ItemProperty -Path $FlashInactive54RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (55)..." -ForegroundColor Cyan
$FlashAll55RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll55"
if (Test-Path -LiteralPath $FlashAll55RegPath) {
    Set-ItemProperty -Path $FlashAll55RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (55)..." -ForegroundColor Cyan
$FlashActive55RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive55"
if (Test-Path -LiteralPath $FlashActive55RegPath) {
    Set-ItemProperty -Path $FlashActive55RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (55)..." -ForegroundColor Cyan
$FlashInactive55RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive55"
if (Test-Path -LiteralPath $FlashInactive55RegPath) {
    Set-ItemProperty -Path $FlashInactive55RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (56)..." -ForegroundColor Cyan
$FlashAll56RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll56"
if (Test-Path -LiteralPath $FlashAll56RegPath) {
    Set-ItemProperty -Path $FlashAll56RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (56)..." -ForegroundColor Cyan
$FlashActive56RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive56"
if (Test-Path -LiteralPath $FlashActive56RegPath) {
    Set-ItemProperty -Path $FlashActive56RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (56)..." -ForegroundColor Cyan
$FlashInactive56RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive56"
if (Test-Path -LiteralPath $FlashInactive56RegPath) {
    Set-ItemProperty -Path $FlashInactive56RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (57)..." -ForegroundColor Cyan
$FlashAll57RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll57"
if (Test-Path -LiteralPath $FlashAll57RegPath) {
    Set-ItemProperty -Path $FlashAll57RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (57)..." -ForegroundColor Cyan
$FlashActive57RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive57"
if (Test-Path -LiteralPath $FlashActive57RegPath) {
    Set-ItemProperty -Path $FlashActive57RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (57)..." -ForegroundColor Cyan
$FlashInactive57RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive57"
if (Test-Path -LiteralPath $FlashInactive57RegPath) {
    Set-ItemProperty -Path $FlashInactive57RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (58)..." -ForegroundColor Cyan
$FlashAll58RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll58"
if (Test-Path -LiteralPath $FlashAll58RegPath) {
    Set-ItemProperty -Path $FlashAll58RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (58)..." -ForegroundColor Cyan
$FlashActive58RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive58"
if (Test-Path -LiteralPath $FlashActive58RegPath) {
    Set-ItemProperty -Path $FlashActive58RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (58)..." -ForegroundColor Cyan
$FlashInactive58RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive58"
if (Test-Path -LiteralPath $FlashInactive58RegPath) {
    Set-ItemProperty -Path $FlashInactive58RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (59)..." -ForegroundColor Cyan
$FlashAll59RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll59"
if (Test-Path -LiteralPath $FlashAll59RegPath) {
    Set-ItemProperty -Path $FlashAll59RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (59)..." -ForegroundColor Cyan
$FlashActive59RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive59"
if (Test-Path -LiteralPath $FlashActive59RegPath) {
    Set-ItemProperty -Path $FlashActive59RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (59)..." -ForegroundColor Cyan
$FlashInactive59RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive59"
if (Test-Path -LiteralPath $FlashInactive59RegPath) {
    Set-ItemProperty -Path $FlashInactive59RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (60)..." -ForegroundColor Cyan
$FlashAll60RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll60"
if (Test-Path -LiteralPath $FlashAll60RegPath) {
    Set-ItemProperty -Path $FlashAll60RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (60)..." -ForegroundColor Cyan
$FlashActive60RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive60"
if (Test-Path -LiteralPath $FlashActive60RegPath) {
    Set-ItemProperty -Path $FlashActive60RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (60)..." -ForegroundColor Cyan
$FlashInactive60RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive60"
if (Test-Path -LiteralPath $FlashInactive60RegPath) {
    Set-ItemProperty -Path $FlashInactive60RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (61)..." -ForegroundColor Cyan
$FlashAll61RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll61"
if (Test-Path -LiteralPath $FlashAll61RegPath) {
    Set-ItemProperty -Path $FlashAll61RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (61)..." -ForegroundColor Cyan
$FlashActive61RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive61"
if (Test-Path -LiteralPath $FlashActive61RegPath) {
    Set-ItemProperty -Path $FlashActive61RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (61)..." -ForegroundColor Cyan
$FlashInactive61RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive61"
if (Test-Path -LiteralPath $FlashInactive61RegPath) {
    Set-ItemProperty -Path $FlashInactive61RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (62)..." -ForegroundColor Cyan
$FlashAll62RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll62"
if (Test-Path -LiteralPath $FlashAll62RegPath) {
    Set-ItemProperty -Path $FlashAll62RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (62)..." -ForegroundColor Cyan
$FlashActive62RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive62"
if (Test-Path -LiteralPath $FlashActive62RegPath) {
    Set-ItemProperty -Path $FlashActive62RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (62)..." -ForegroundColor Cyan
$FlashInactive62RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive62"
if (Test-Path -LiteralPath $FlashInactive62RegPath) {
    Set-ItemProperty -Path $FlashInactive62RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (63)..." -ForegroundColor Cyan
$FlashAll63RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll63"
if (Test-Path -LiteralPath $FlashAll63RegPath) {
    Set-ItemProperty -Path $FlashAll63RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (63)..." -ForegroundColor Cyan
$FlashActive63RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive63"
if (Test-Path -LiteralPath $FlashActive63RegPath) {
    Set-ItemProperty -Path $FlashActive63RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (63)..." -ForegroundColor Cyan
$FlashInactive63RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive63"
if (Test-Path -LiteralPath $FlashInactive63RegPath) {
    Set-ItemProperty -Path $FlashInactive63RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (64)..." -ForegroundColor Cyan
$FlashAll64RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll64"
if (Test-Path -LiteralPath $FlashAll64RegPath) {
    Set-ItemProperty -Path $FlashAll64RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (64)..." -ForegroundColor Cyan
$FlashActive64RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive64"
if (Test-Path -LiteralPath $FlashActive64RegPath) {
    Set-ItemProperty -Path $FlashActive64RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (64)..." -ForegroundColor Cyan
$FlashInactive64RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive64"
if (Test-Path -LiteralPath $FlashInactive64RegPath) {
    Set-ItemProperty -Path $FlashInactive64RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (65)..." -ForegroundColor Cyan
$FlashAll65RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll65"
if (Test-Path -LiteralPath $FlashAll65RegPath) {
    Set-ItemProperty -Path $FlashAll65RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (65)..." -ForegroundColor Cyan
$FlashActive65RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive65"
if (Test-Path -LiteralPath $FlashActive65RegPath) {
    Set-ItemProperty -Path $FlashActive65RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (65)..." -ForegroundColor Cyan
$FlashInactive65RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive65"
if (Test-Path -LiteralPath $FlashInactive65RegPath) {
    Set-ItemProperty -Path $FlashInactive65RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (66)..." -ForegroundColor Cyan
$FlashAll66RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll66"
if (Test-Path -LiteralPath $FlashAll66RegPath) {
    Set-ItemProperty -Path $FlashAll66RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (66)..." -ForegroundColor Cyan
$FlashActive66RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive66"
if (Test-Path -LiteralPath $FlashActive66RegPath) {
    Set-ItemProperty -Path $FlashActive66RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (66)..." -ForegroundColor Cyan
$FlashInactive66RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive66"
if (Test-Path -LiteralPath $FlashInactive66RegPath) {
    Set-ItemProperty -Path $FlashInactive66RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (67)..." -ForegroundColor Cyan
$FlashAll67RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll67"
if (Test-Path -LiteralPath $FlashAll67RegPath) {
    Set-ItemProperty -Path $FlashAll67RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (67)..." -ForegroundColor Cyan
$FlashActive67RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive67"
if (Test-Path -LiteralPath $FlashActive67RegPath) {
    Set-ItemProperty -Path $FlashActive67RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (67)..." -ForegroundColor Cyan
$FlashInactive67RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive67"
if (Test-Path -LiteralPath $FlashInactive67RegPath) {
    Set-ItemProperty -Path $FlashInactive67RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (68)..." -ForegroundColor Cyan
$FlashAll68RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll68"
if (Test-Path -LiteralPath $FlashAll68RegPath) {
    Set-ItemProperty -Path $FlashAll68RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (68)..." -ForegroundColor Cyan
$FlashActive68RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive68"
if (Test-Path -LiteralPath $FlashActive68RegPath) {
    Set-ItemProperty -Path $FlashActive68RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (68)..." -ForegroundColor Cyan
$FlashInactive68RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive68"
if (Test-Path -LiteralPath $FlashInactive68RegPath) {
    Set-ItemProperty -Path $FlashInactive68RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (69)..." -ForegroundColor Cyan
$FlashAll69RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll69"
if (Test-Path -LiteralPath $FlashAll69RegPath) {
    Set-ItemProperty -Path $FlashAll69RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (69)..." -ForegroundColor Cyan
$FlashActive69RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive69"
if (Test-Path -LiteralPath $FlashActive69RegPath) {
    Set-ItemProperty -Path $FlashActive69RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (69)..." -ForegroundColor Cyan
$FlashInactive69RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive69"
if (Test-Path -LiteralPath $FlashInactive69RegPath) {
    Set-ItemProperty -Path $FlashInactive69RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (70)..." -ForegroundColor Cyan
$FlashAll70RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll70"
if (Test-Path -LiteralPath $FlashAll70RegPath) {
    Set-ItemProperty -Path $FlashAll70RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (70)..." -ForegroundColor Cyan
$FlashActive70RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive70"
if (Test-Path -LiteralPath $FlashActive70RegPath) {
    Set-ItemProperty -Path $FlashActive70RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (70)..." -ForegroundColor Cyan
$FlashInactive70RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive70"
if (Test-Path -LiteralPath $FlashInactive70RegPath) {
    Set-ItemProperty -Path $FlashInactive70RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (71)..." -ForegroundColor Cyan
$FlashAll71RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll71"
if (Test-Path -LiteralPath $FlashAll71RegPath) {
    Set-ItemProperty -Path $FlashAll71RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (71)..." -ForegroundColor Cyan
$FlashActive71RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive71"
if (Test-Path -LiteralPath $FlashActive71RegPath) {
    Set-ItemProperty -Path $FlashActive71RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (71)..." -ForegroundColor Cyan
$FlashInactive71RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive71"
if (Test-Path -LiteralPath $FlashInactive71RegPath) {
    Set-ItemProperty -Path $FlashInactive71RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (72)..." -ForegroundColor Cyan
$FlashAll72RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll72"
if (Test-Path -LiteralPath $FlashAll72RegPath) {
    Set-ItemProperty -Path $FlashAll72RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (72)..." -ForegroundColor Cyan
$FlashActive72RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive72"
if (Test-Path -LiteralPath $FlashActive72RegPath) {
    Set-ItemProperty -Path $FlashActive72RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (72)..." -ForegroundColor Cyan
$FlashInactive72RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive72"
if (Test-Path -LiteralPath $FlashInactive72RegPath) {
    Set-ItemProperty -Path $FlashInactive72RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (73)..." -ForegroundColor Cyan
$FlashAll73RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll73"
if (Test-Path -LiteralPath $FlashAll73RegPath) {
    Set-ItemProperty -Path $FlashAll73RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (73)..." -ForegroundColor Cyan
$FlashActive73RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive73"
if (Test-Path -LiteralPath $FlashActive73RegPath) {
    Set-ItemProperty -Path $FlashActive73RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (73)..." -ForegroundColor Cyan
$FlashInactive73RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive73"
if (Test-Path -LiteralPath $FlashInactive73RegPath) {
    Set-ItemProperty -Path $FlashInactive73RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (74)..." -ForegroundColor Cyan
$FlashAll74RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll74"
if (Test-Path -LiteralPath $FlashAll74RegPath) {
    Set-ItemProperty -Path $FlashAll74RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (74)..." -ForegroundColor Cyan
$FlashActive74RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive74"
if (Test-Path -LiteralPath $FlashActive74RegPath) {
    Set-ItemProperty -Path $FlashActive74RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (74)..." -ForegroundColor Cyan
$FlashInactive74RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive74"
if (Test-Path -LiteralPath $FlashInactive74RegPath) {
    Set-ItemProperty -Path $FlashInactive74RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (75)..." -ForegroundColor Cyan
$FlashAll75RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll75"
if (Test-Path -LiteralPath $FlashAll75RegPath) {
    Set-ItemProperty -Path $FlashAll75RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (75)..." -ForegroundColor Cyan
$FlashActive75RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive75"
if (Test-Path -LiteralPath $FlashActive75RegPath) {
    Set-ItemProperty -Path $FlashActive75RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (75)..." -ForegroundColor Cyan
$FlashInactive75RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive75"
if (Test-Path -LiteralPath $FlashInactive75RegPath) {
    Set-ItemProperty -Path $FlashInactive75RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (76)..." -ForegroundColor Cyan
$FlashAll76RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll76"
if (Test-Path -LiteralPath $FlashAll76RegPath) {
    Set-ItemProperty -Path $FlashAll76RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (76)..." -ForegroundColor Cyan
$FlashActive76RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive76"
if (Test-Path -LiteralPath $FlashActive76RegPath) {
    Set-ItemProperty -Path $FlashActive76RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (76)..." -ForegroundColor Cyan
$FlashInactive76RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive76"
if (Test-Path -LiteralPath $FlashInactive76RegPath) {
    Set-ItemProperty -Path $FlashInactive76RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (77)..." -ForegroundColor Cyan
$FlashAll77RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll77"
if (Test-Path -LiteralPath $FlashAll77RegPath) {
    Set-ItemProperty -Path $FlashAll77RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (77)..." -ForegroundColor Cyan
$FlashActive77RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive77"
if (Test-Path -LiteralPath $FlashActive77RegPath) {
    Set-ItemProperty -Path $FlashActive77RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (77)..." -ForegroundColor Cyan
$FlashInactive77RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive77"
if (Test-Path -LiteralPath $FlashInactive77RegPath) {
    Set-ItemProperty -Path $FlashInactive77RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (78)..." -ForegroundColor Cyan
$FlashAll78RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll78"
if (Test-Path -LiteralPath $FlashAll78RegPath) {
    Set-ItemProperty -Path $FlashAll78RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (78)..." -ForegroundColor Cyan
$FlashActive78RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive78"
if (Test-Path -LiteralPath $FlashActive78RegPath) {
    Set-ItemProperty -Path $FlashActive78RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (78)..." -ForegroundColor Cyan
$FlashInactive78RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive78"
if (Test-Path -LiteralPath $FlashInactive78RegPath) {
    Set-ItemProperty -Path $FlashInactive78RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (79)..." -ForegroundColor Cyan
$FlashAll79RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll79"
if (Test-Path -LiteralPath $FlashAll79RegPath) {
    Set-ItemProperty -Path $FlashAll79RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (79)..." -ForegroundColor Cyan
$FlashActive79RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive79"
if (Test-Path -LiteralPath $FlashActive79RegPath) {
    Set-ItemProperty -Path $FlashActive79RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (79)..." -ForegroundColor Cyan
$FlashInactive79RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive79"
if (Test-Path -LiteralPath $FlashInactive79RegPath) {
    Set-ItemProperty -Path $FlashInactive79RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (80)..." -ForegroundColor Cyan
$FlashAll80RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll80"
if (Test-Path -LiteralPath $FlashAll80RegPath) {
    Set-ItemProperty -Path $FlashAll80RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (80)..." -ForegroundColor Cyan
$FlashActive80RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive80"
if (Test-Path -LiteralPath $FlashActive80RegPath) {
    Set-ItemProperty -Path $FlashActive80RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (80)..." -ForegroundColor Cyan
$FlashInactive8080RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive80"
if (Test-Path -LiteralPath $FlashInactive80RegPath) {
    Set-ItemProperty -Path $FlashInactive80RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (81)..." -ForegroundColor Cyan
$FlashAll81RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll81"
if (Test-Path -LiteralPath $FlashAll81RegPath) {
    Set-ItemProperty -Path $FlashAll81RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (81)..." -ForegroundColor Cyan
$FlashActive81RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive81"
if (Test-Path -LiteralPath $FlashActive81RegPath) {
    Set-ItemProperty -Path $FlashActive81RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (81)..." -ForegroundColor Cyan
$FlashInactive81RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive81"
if (Test-Path -LiteralPath $FlashInactive81RegPath) {
    Set-ItemProperty -Path $FlashInactive81RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (82)..." -ForegroundColor Cyan
$FlashAll82RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll82"
if (Test-Path -LiteralPath $FlashAll82RegPath) {
    Set-ItemProperty -Path $FlashAll82RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (82)..." -ForegroundColor Cyan
$FlashActive82RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive82"
if (Test-Path -LiteralPath $FlashActive82RegPath) {
    Set-ItemProperty -Path $FlashActive82RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (82)..." -ForegroundColor Cyan
$FlashInactive82RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive82"
if (Test-Path -LiteralPath $FlashInactive82RegPath) {
    Set-ItemProperty -Path $FlashInactive82RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (83)..." -ForegroundColor Cyan
$FlashAll83RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll83"
if (Test-Path -LiteralPath $FlashAll83RegPath) {
    Set-ItemProperty -Path $FlashAll83RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (83)..." -ForegroundColor Cyan
$FlashActive83RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive83"
if (Test-Path -LiteralPath $FlashActive83RegPath) {
    Set-ItemProperty -Path $FlashActive83RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (83)..." -ForegroundColor Cyan
$FlashInactive83RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive83"
if (Test-Path -LiteralPath $FlashInactive83RegPath) {
    Set-ItemProperty -Path $FlashInactive83RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (84)..." -ForegroundColor Cyan
$FlashAll84RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll84"
if (Test-Path -LiteralPath $FlashAll84RegPath) {
    Set-ItemProperty -Path $FlashAll84RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (84)..." -ForegroundColor Cyan
$FlashActive84RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive84"
if (Test-Path -LiteralPath $FlashActive84RegPath) {
    Set-ItemProperty -Path $FlashActive84RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (84)..." -ForegroundColor Cyan
$FlashInactive84RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive84"
if (Test-Path -LiteralPath $FlashInactive84RegPath) {
    Set-ItemProperty -Path $FlashInactive84RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (85)..." -ForegroundColor Cyan
$FlashAll85RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll85"
if (Test-Path -LiteralPath $FlashAll85RegPath) {
    Set-ItemProperty -Path $FlashAll85RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (85)..." -ForegroundColor Cyan
$FlashActive85RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive85"
if (Test-Path -LiteralPath $FlashActive85RegPath) {
    Set-ItemProperty -Path $FlashActive85RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (85)..." -ForegroundColor Cyan
$FlashInactive85RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive85"
if (Test-Path -LiteralPath $FlashInactive85RegPath) {
    Set-ItemProperty -Path $FlashInactive85RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (86)..." -ForegroundColor Cyan
$FlashAll86RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll86"
if (Test-Path -LiteralPath $FlashAll86RegPath) {
    Set-ItemProperty -Path $FlashAll86RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (86)..." -ForegroundColor Cyan
$FlashActive86RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive86"
if (Test-Path -LiteralPath $FlashActive86RegPath) {
    Set-ItemProperty -Path $FlashActive86RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (86)..." -ForegroundColor Cyan
$FlashInactive86RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive86"
if (Test-Path -LiteralPath $FlashInactive86RegPath) {
    Set-ItemProperty -Path $FlashInactive86RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (87)..." -ForegroundColor Cyan
$FlashAll87RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll87"
if (Test-Path -LiteralPath $FlashAll87RegPath) {
    Set-ItemProperty -Path $FlashAll87RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (87)..." -ForegroundColor Cyan
$FlashActive87RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive87"
if (Test-Path -LiteralPath $FlashActive87RegPath) {
    Set-ItemProperty -Path $FlashActive87RegPath -Name "FlashActive87" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (87)..." -ForegroundColor Cyan
$FlashInactive87RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive87"
if (Test-Path -LiteralPath $FlashInactive87RegPath) {
    Set-ItemProperty -Path $FlashInactive87RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (88)..." -ForegroundColor Cyan
$FlashAll88RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll88"
if (Test-Path -LiteralPath $FlashAll88RegPath) {
    Set-ItemProperty -Path $FlashAll88RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (88)..." -ForegroundColor Cyan
$FlashActive88RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive88"
if (Test-Path -LiteralPath $FlashActive88RegPath) {
    Set-ItemProperty -Path $FlashActive88RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (88)..." -ForegroundColor Cyan
$FlashInactive88RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive88"
if (Test-Path -LiteralPath $FlashInactive88RegPath) {
    Set-ItemProperty -Path $FlashInactive88RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (89)..." -ForegroundColor Cyan
$FlashAll89RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll89"
if (Test-Path -LiteralPath $FlashAll89RegPath) {
    Set-ItemProperty -Path $FlashAll89RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (89)..." -ForegroundColor Cyan
$FlashActive89RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive89"
if (Test-Path -LiteralPath $FlashActive89RegPath) {
    Set-ItemProperty -Path $FlashActive89RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (89)..." -ForegroundColor Cyan
$FlashInactive89RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive89"
if (Test-Path -LiteralPath $FlashInactive89RegPath) {
    Set-ItemProperty -Path $FlashInactive89RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (90)..." -ForegroundColor Cyan
$FlashAll90RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll90"
if (Test-Path -LiteralPath $FlashAll90RegPath) {
    Set-ItemProperty -Path $FlashAll90RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (90)..." -ForegroundColor Cyan
$FlashActive90RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive90"
if (Test-Path -LiteralPath $FlashActive90RegPath) {
    Set-ItemProperty -Path $FlashActive90RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (90)..." -ForegroundColor Cyan
$FlashInactive90RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive90"
if (Test-Path -LiteralPath $FlashInactive90RegPath) {
    Set-ItemProperty -Path $FlashInactive90RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (91)..." -ForegroundColor Cyan
$FlashAll91RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll91"
if (Test-Path -LiteralPath $FlashAll91RegPath) {
    Set-ItemProperty -Path $FlashAll91RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (91)..." -ForegroundColor Cyan
$FlashActive91RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive91"
if (Test-Path -LiteralPath $FlashActive91RegPath) {
    Set-ItemProperty -Path $FlashActive91RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (91)..." -ForegroundColor Cyan
$FlashInactive91RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive91"
if (Test-Path -LiteralPath $FlashInactive91RegPath) {
    Set-ItemProperty -Path $FlashInactive91RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (92)..." -ForegroundColor Cyan
$FlashAll92RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll92"
if (Test-Path -LiteralPath $FlashAll92RegPath) {
    Set-ItemProperty -Path $FlashAll92RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (92)..." -ForegroundColor Cyan
$FlashActive92RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive92"
if (Test-Path -LiteralPath $FlashActive92RegPath) {
    Set-ItemProperty -Path $FlashActive92RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (92)..." -ForegroundColor Cyan
$FlashInactive92RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive92"
if (Test-Path -LiteralPath $FlashInactive92RegPath) {
    Set-ItemProperty -Path $FlashInactive92RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (93)..." -ForegroundColor Cyan
$FlashAll93RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll93"
if (Test-Path -LiteralPath $FlashAll93RegPath) {
    Set-ItemProperty -Path $FlashAll93RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (93)..." -ForegroundColor Cyan
$FlashActive93RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive93"
if (Test-Path -LiteralPath $FlashActive93RegPath) {
    Set-ItemProperty -Path $FlashActive93RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (93)..." -ForegroundColor Cyan
$FlashInactive93RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive93"
if (Test-Path -LiteralPath $FlashInactive93RegPath) {
    Set-ItemProperty -Path $FlashInactive93RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (94)..." -ForegroundColor Cyan
$FlashAll94RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll94"
if (Test-Path -LiteralPath $FlashAll94RegPath) {
    Set-ItemProperty -Path $FlashAll94RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (94)..." -ForegroundColor Cyan
$FlashActive94RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive94"
if (Test-Path -LiteralPath $FlashActive94RegPath) {
    Set-ItemProperty -Path $FlashActive94RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on inactive windows (94)..." -ForegroundColor Cyan
$FlashInactive94RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashInactive94"
if (Test-Path -LiteralPath $FlashInactive94RegPath) {
    Set-ItemProperty -Path $FlashInactive94RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on all windows (95)..." -ForegroundColor Cyan
$FlashAll95RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashAll95"
if (Test-Path -LiteralPath $FlashAll95RegPath) {
    Set-ItemProperty -Path $FlashAll95RegPath -Name "Flags" -Value "0" -Type String
}

Write-Host "[*] Disabling Flash on active windows (95)..." -ForegroundColor Cyan
$FlashActive95RegPath = "HKCU:\Control Panel\Accessibility\Accessibility\FlashActive95"
if (Test-Path -LiteralPath $FlashActive95RegPath) {
    Set-ItemProperty -Path $FlashActive95RegPath -Name "Flags" -Value "0" -Type String
