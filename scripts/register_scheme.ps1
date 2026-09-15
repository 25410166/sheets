# Register cookapps-csheet custom URI scheme and spreadsheet file associations in Windows Registry for Development

$scheme = 'cookapps-csheet'

$targetPaths = @(
    "$PSScriptRoot\..\src-tauri\target\debug\csheet.exe",
    "$PSScriptRoot\..\target\debug\csheet.exe",
    "$PSScriptRoot\..\src-tauri\target\release\csheet.exe",
    "$PSScriptRoot\..\target\release\csheet.exe"
)

$exePath = $null
foreach ($path in $targetPaths) {
    if (Test-Path $path) {
        $exePath = (Resolve-Path $path).Path
        break
    }
}

if (-not $exePath) {
    $exePath = "$PSScriptRoot\..\src-tauri\target\debug\csheet.exe"
    Write-Warning "Executable not found in standard target directories. Registering default path: $exePath"
}

# 1. Register custom URL protocol cookapps-csheet://
$regBase = "HKCU:\Software\Classes\$scheme"
New-Item -Path $regBase -Force | Out-Null
Set-ItemProperty -Path $regBase -Name '(Default)' -Value 'URL:CookApps CSheet Protocol'
New-ItemProperty -Path $regBase -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null

New-Item -Path "$regBase\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$regBase\shell\open\command" -Name '(Default)' -Value "`"$exePath`" `"%1`""

# 2. Register file associations for spreadsheets (.xlsx, .xls, .ods, .csv)
$extensions = @('.xlsx', '.xls', '.ods', '.csv')
foreach ($ext in $extensions) {
    $extReg = "HKCU:\Software\Classes\$ext\OpenWithProgids"
    New-Item -Path $extReg -Force | Out-Null
    New-ItemProperty -Path $extReg -Name "CSheet.Document" -Value "" -PropertyType String -Force | Out-Null
}

$progId = "HKCU:\Software\Classes\CSheet.Document"
New-Item -Path "$progId\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$progId\shell\open\command" -Name '(Default)' -Value "`"$exePath`" `"%1`""

Write-Host "Successfully registered $scheme scheme and spreadsheet file associations for:" -ForegroundColor Green
Write-Host "  $exePath" -ForegroundColor Cyan
