$ErrorActionPreference = "Stop"

$AdbPath = "C:\Users\gaear\Downloads\Compressed\adb-fastboot\adb.exe"
$OutDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Test-Path -LiteralPath $AdbPath)) {
    throw "adb.exe not found: $AdbPath"
}

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

$devicesOutput = & $AdbPath devices
$deviceLines = $devicesOutput | Where-Object { $_ -match "\tdevice$" }
$unauthorizedLines = $devicesOutput | Where-Object { $_ -match "\tunauthorized$" }

if ($unauthorizedLines.Count -gt 0) {
    throw "Device is connected but unauthorized. Unlock the phone and allow USB debugging, then run this script again."
}

if ($deviceLines.Count -eq 0) {
    throw "No authorized Android device found. Connect the phone, enable USB debugging, then run this script again."
}

if ($deviceLines.Count -gt 1) {
    throw "More than one authorized Android device found. Please keep only one device connected, then run this script again."
}

$allRaw = & $AdbPath shell pm list packages
$all = $allRaw | ForEach-Object { $_ -replace "^package:", "" } | Sort-Object

$userRaw = & $AdbPath shell pm list packages -3
$user = $userRaw | ForEach-Object { $_ -replace "^package:", "" } | Sort-Object

$withPaths = & $AdbPath shell pm list packages -f

$allPath = Join-Path $OutDir "packages_all.txt"
$userPath = Join-Path $OutDir "packages_user_installed.txt"
$pathsPath = Join-Path $OutDir "packages_with_apk_paths.txt"
$metadataPath = Join-Path $OutDir "metadata.txt"

$all | Set-Content -LiteralPath $allPath -Encoding UTF8
$user | Set-Content -LiteralPath $userPath -Encoding UTF8
$withPaths | Set-Content -LiteralPath $pathsPath -Encoding UTF8

@(
    "generated_at=$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')",
    "adb=$AdbPath",
    "device=$($deviceLines[0])",
    "packages_all_count=$($all.Count)",
    "packages_user_installed_count=$($user.Count)"
) | Set-Content -LiteralPath $metadataPath -Encoding UTF8

Write-Host "Updated Android package lists in: $OutDir"
Write-Host "All packages: $($all.Count)"
Write-Host "User-installed packages: $($user.Count)"
