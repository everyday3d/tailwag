$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent $PSScriptRoot
$targetExe = Join-Path $projectDir "release\win-unpacked\TailWag Studio.exe"
$iconIco = Join-Path $projectDir "build\icon.ico"
$desktopDir = [Environment]::GetFolderPath("Desktop")

# Remove any old raw .exe copy on Desktop so there's only one clean shortcut
$oldDesktopExe = Join-Path $desktopDir "TailWag Studio.exe"
if (Test-Path $oldDesktopExe) {
    Remove-Item $oldDesktopExe -Force -ErrorAction SilentlyContinue
}

$shortcutPath = Join-Path $desktopDir "TailWag Studio.lnk"
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetExe
$shortcut.WorkingDirectory = Split-Path -Parent $targetExe
$shortcut.IconLocation = "$iconIco,0"
$shortcut.Description = "TailWag Studio - 3D Filament Painting and TD Lithophane Engine"
$shortcut.Save()

Write-Host "Updated Desktop shortcut: $shortcutPath -> $targetExe"
