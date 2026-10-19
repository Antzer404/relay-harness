# Relay M0 Windows diagnostics.
# Read-only checks plus two smoke-test runs (default TEMP vs repo-local TEMP).
# Writes everything to win-m0-diag.log in the repo root. No admin required.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root 'win-m0-diag.log'
Set-Content -Path $log -Value "Relay M0 Windows diagnostics - $(Get-Date -Format o)" -Encoding UTF8

function Sec([string]$title) {
  $block = "`r`n===== $title ====="
  Add-Content -Path $log -Value $block -Encoding UTF8
  Write-Host $block
}

function Gate([string]$title, [scriptblock]$block) {
  Sec $title
  try { $out = & $block 2>&1 | Out-String } catch { $out = "ERROR: $($_.Exception.Message)" }
  Add-Content -Path $log -Value $out -Encoding UTF8
  Write-Host $out
}

Sec "System"
Gate "Computer info" {
  Get-ComputerInfo | Select-Object WindowsProductName, WindowsVersion, OsBuildNumber, CsSystemType | Format-List
}
Gate "Node and identity" {
  "node: $(node -v)"
  "npm: $(npm -v)"
  "user: $(whoami)"
  whoami /groups | Select-String -Pattern 'Mandatory Label|S-1-16'
}
Gate "Temp paths" {
  "TEMP=$env:TEMP"
  "TMP=$env:TMP"
  "GetTempPath=[$( [System.IO.Path]::GetTempPath() )]"
  reg query "HKCU\Environment" /v TEMP 2>&1
  reg query "HKCU\Environment" /v TMP 2>&1
}

Sec "Directory permissions"
Gate "ACL of TEMP" {
  icacls $env:TEMP 2>&1
}
Gate "Reparse point check" {
  fsutil reparsepoint query $env:TEMP 2>&1
}
Gate "Volume of TEMP and repo" {
  Get-Volume | Select-Object DriveLetter, FileSystem, FileSystemType, HealthStatus | Format-Table -AutoSize
}

Sec "Security software"
Gate "AV products (SecurityCenter2)" {
  Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction SilentlyContinue |
    Select-Object displayName, productState, pathToSignedProductExe | Format-List
}
Gate "Defender status" {
  Get-MpComputerStatus -ErrorAction SilentlyContinue |
    Select-Object AMRunningMode, AntivirusEnabled, RealTimeProtectionEnabled, BehaviorMonitorEnabled,
      IoavProtectionEnabled, OnAccessProtectionEnabled, IsTamperProtected | Format-List
}
Gate "Defender preferences" {
  Get-MpPreference -ErrorAction SilentlyContinue |
    Select-Object EnableControlledFolderAccess, ControlledFolderAccessProtectedFolders,
      AttackSurfaceReductionRules_Ids, AttackSurfaceReductionRules_Actions, ExclusionPath | Format-List
}
Gate "Recent Defender detections" {
  Get-MpThreatDetection -ErrorAction SilentlyContinue |
    Sort-Object InitialDetectionTime -Descending |
    Select-Object -First 5 InitialDetectionTime, ThreatName, Resources | Format-List
}
Gate "Defender operational events (last 24h)" {
  Get-WinEvent -FilterHashtable @{
    LogName = 'Microsoft-Windows-Windows Defender/Operational'
    StartTime = (Get-Date).AddHours(-24)
  } -ErrorAction SilentlyContinue |
    Where-Object { $_.Id -in 1116, 1117, 1121, 1122, 1123, 1124, 1125, 1126 } |
    Select-Object TimeCreated, Id, @{ n = 'FirstLine'; e = { ($_.Message -split "`r?`n")[0] } } |
    Format-List
}

Sec "Policies"
Gate "Smart App Control / Code Integrity" {
  reg query "HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy" 2>&1
}
Gate "Device Guard / VBS" {
  Get-CimInstance -Namespace root\Microsoft\Windows\DeviceGuard -ClassName Win32_DeviceGuard -ErrorAction SilentlyContinue |
    Select-Object VirtualizationBasedSecurityStatus, SecurityServicesConfigured, SecurityServicesRunning | Format-List
}
Gate "AppLocker effective policy" {
  try { Get-AppLockerPolicy -Effective | Format-List * } catch { "applocker: $($_.Exception.Message)" }
}
Gate "Claude managed settings" {
  $paths = @("$env:ProgramData\ClaudeCode\managed-settings.json", "$env:USERPROFILE\.claude\managed-settings.json")
  foreach ($p in $paths) {
    "$p exists: $(Test-Path $p)"
    if (Test-Path $p) { Get-Content $p -Raw }
  }
}
Gate "Anthropic/Claude env vars (names + length only)" {
  Get-ChildItem Env: |
    Where-Object { $_.Name -match '^(CLAUDE|ANTHROPIC)' } |
    ForEach-Object { "$($_.Name) (len=$($_.Value.Length))" }
}

Sec "Probes"
Gate "Plain PowerShell writes" {
  $t1 = Join-Path $env:TEMP 'relay-probe.txt'
  Set-Content -Path $t1 -Value 'ok' -Encoding ASCII
  $r1 = Test-Path $t1
  Remove-Item $t1 -Force -ErrorAction SilentlyContinue
  $t2 = Join-Path $root 'relay-probe.txt'
  Set-Content -Path $t2 -Value 'ok' -Encoding ASCII
  $r2 = Test-Path $t2
  Remove-Item $t2 -Force -ErrorAction SilentlyContinue
  "temp write by powershell: $r1"
  "repo write by powershell: $r2"
}
Gate "Bundled claude.exe version" {
  $exe = Join-Path $root 'node_modules\@anthropic-ai\claude-agent-sdk\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe'
  "exe exists: $(Test-Path $exe)"
  & $exe --version 2>&1
}

Sec "Test run 1: default TEMP"
Push-Location $root
npm test 2>&1 | Tee-Object -FilePath $log -Append
"npm test exit code: $LASTEXITCODE" | Add-Content -Path $log -Encoding UTF8
Pop-Location

Sec "Test run 2: TEMP redirected to repo-local .smoke-temp"
$origTmp = $env:TMP
$origTemp = $env:TEMP
$d = Join-Path $root '.smoke-temp'
New-Item -ItemType Directory -Force -Path $d | Out-Null
$env:TMP = $d
$env:TEMP = $d
Push-Location $root
npm test 2>&1 | Tee-Object -FilePath $log -Append
"npm test exit code: $LASTEXITCODE" | Add-Content -Path $log -Encoding UTF8
Pop-Location
$env:TMP = $origTmp
$env:TEMP = $origTemp

Sec "Done"
Write-Host "Log written to $log"
