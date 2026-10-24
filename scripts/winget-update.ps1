<#
  Opens a WinGet update PR for a released TailWag version. Run by the release workflow after the
  release is published (.github/workflows/release.yml, job "winget").

  Needs a classic personal access token with the public_repo scope in the WINGET_TOKEN secret:
  the built-in GITHUB_TOKEN cannot open pull requests in microsoft/winget-pkgs.

  Skips quietly (exit 0, with a notice in the run log) when
    - there is no WINGET_TOKEN,
    - the package is not in winget-pkgs yet (its first PR is still waiting for a moderator), or
    - a PR for this version is already open.
#>
param(
  [Parameter(Mandatory = $true)][string]$Tag,
  [string]$Repo = $env:GITHUB_REPOSITORY,
  # Test hook: only rewrite the release notes in this manifest folder, then stop
  [string]$PatchOnly
)

# Native commands (gh, wingetcreate) report failure through exit codes, which are checked below; their
# stderr text must not abort the script (Windows PowerShell 5.1 treats it as an error). Cmdlets that
# must succeed say -ErrorAction Stop.
$ErrorActionPreference = 'Continue'
$id = 'everyday3d.TailWagStudio'
$version = $Tag.TrimStart('v')
if (-not $Repo) { $Repo = 'everyday3d/tailwag' }

function Skip([string]$why) {
  Write-Host "::notice title=WinGet update skipped::$why"
  Write-Host "WinGet update skipped: $why"
  exit 0
}

# WinGet's release notes for this version: the one-line summary under its heading in CHANGELOG.md
function Set-ReleaseNotes([string]$dir) {
  $locale = Get-ChildItem $dir -Filter "$id.locale.*.yaml" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $locale) { throw "No locale manifest found in $dir" }
  $changelog = Get-Content 'CHANGELOG.md' -Raw -ErrorAction Stop
  $m = [regex]::Match($changelog, '(?ms)^## \[' + [regex]::Escape($version) + '\][^\r\n]*\r?\n\s*\r?\n(?<s>[^\r\n#][^\r\n]*)')
  $summary = if ($m.Success) { $m.Groups['s'].Value.Trim() } else { 'See the release notes on GitHub.' }

  $text = [IO.File]::ReadAllText($locale.FullName)
  $text = [regex]::Replace($text, '(?ms)^ReleaseNotes:.*?(?=^ReleaseNotesUrl:)', "ReleaseNotes: |-`r`n  $summary`r`n")
  $text = [regex]::Replace($text, '(?m)^ReleaseNotesUrl:.*$', "ReleaseNotesUrl: https://github.com/$Repo/releases/tag/$Tag")
  [IO.File]::WriteAllText($locale.FullName, $text, (New-Object System.Text.UTF8Encoding $false))
  Write-Host "Release notes set to: $summary"
}

if ($PatchOnly) {
  Set-ReleaseNotes $PatchOnly
  exit 0
}

if (-not $env:WINGET_TOKEN) {
  Skip 'the WINGET_TOKEN secret is not set (a classic token with the public_repo scope, from the everyday3d account).'
}

# The package must already be in winget-pkgs; until its first PR is merged there is nothing to update
gh api "repos/microsoft/winget-pkgs/contents/manifests/e/everyday3d/TailWagStudio" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Skip "$id is not in winget-pkgs yet (its first pull request is still waiting for a moderator). Nothing to update."
}

$open = gh pr list --repo microsoft/winget-pkgs --state open --search "$id $version in:title" --json number --jq 'length'
if ($LASTEXITCODE -ne 0) { throw 'Could not look up existing winget-pkgs pull requests' }
if ([int]$open -gt 0) { Skip "A pull request for $id $version is already open." }

Invoke-WebRequest 'https://aka.ms/wingetcreate/latest' -OutFile 'wingetcreate.exe' -UseBasicParsing -ErrorAction Stop
$url = "https://github.com/$Repo/releases/download/$Tag/TailWag-Setup-$version.exe"

# Builds the new manifests from the latest published ones (new URL, checksum and release date)
.\wingetcreate.exe update $id --version $version --urls $url --out winget-out
if ($LASTEXITCODE -ne 0) { throw "wingetcreate update failed ($LASTEXITCODE)" }
$dir = (Get-ChildItem 'winget-out' -Recurse -Filter "$id.yaml" -ErrorAction SilentlyContinue | Select-Object -First 1).DirectoryName
if (-not $dir) { throw 'wingetcreate did not produce a manifest folder' }
Set-ReleaseNotes $dir

.\wingetcreate.exe submit --token $env:WINGET_TOKEN --prtitle "New version: $id version $version" $dir
if ($LASTEXITCODE -ne 0) { throw "wingetcreate submit failed ($LASTEXITCODE)" }
