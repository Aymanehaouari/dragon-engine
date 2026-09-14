$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Resources = Join-Path $Root "src-tauri\resources"
$Temp = Join-Path $env:TEMP "dragon-tools"
New-Item -ItemType Directory -Force -Path $Resources, $Temp | Out-Null

function Get-GitHubJson([string]$Url) {
  Invoke-RestMethod -Uri $Url -Headers @{
    "User-Agent" = "DRAGON-Desktop-Build"
    "Accept" = "application/vnd.github+json"
  }
}

Write-Host "Fetching latest OmniGet CLI..."
$release = Get-GitHubJson "https://api.github.com/repos/tonhowtf/omniget/releases/latest"
$asset = $release.assets | Where-Object {
  $_.name -match '^omniget-cli-.*-x86_64-pc-windows-msvc\.zip$'
} | Select-Object -First 1
if (-not $asset) { throw "Windows OmniGet CLI asset was not found." }

$omniZip = Join-Path $Temp $asset.name
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $omniZip

if ($asset.digest -and $asset.digest.StartsWith("sha256:")) {
  $expected = $asset.digest.Substring(7).ToLowerInvariant()
  $actual = (Get-FileHash $omniZip -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw "OmniGet checksum verification failed." }
}

$omniExtract = Join-Path $Temp "omniget"
Remove-Item $omniExtract -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive $omniZip -DestinationPath $omniExtract -Force
$omniExe = Get-ChildItem $omniExtract -Recurse -File |
  Where-Object { $_.Name -in @("omniget.exe", "omniget-cli.exe") } |
  Select-Object -First 1
if (-not $omniExe) { throw "OmniGet executable was not found inside its release archive." }
Copy-Item $omniExe.FullName (Join-Path $Resources "omniget.exe") -Force

Write-Host "Fetching yt-dlp..."
$ytRelease = Get-GitHubJson "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest"
$ytAsset = $ytRelease.assets | Where-Object { $_.name -eq "yt-dlp.exe" } | Select-Object -First 1
if (-not $ytAsset) { throw "yt-dlp Windows executable was not found." }
Invoke-WebRequest -Uri $ytAsset.browser_download_url -OutFile (Join-Path $Resources "yt-dlp.exe")

Write-Host "Fetching FFmpeg..."
$ffRelease = Get-GitHubJson "https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest"
$ffAsset = $ffRelease.assets | Where-Object {
  $_.name -eq "ffmpeg-master-latest-win64-gpl.zip"
} | Select-Object -First 1
if (-not $ffAsset) {
  $ffAsset = $ffRelease.assets | Where-Object {
    $_.name -match '^ffmpeg-master-latest-win64-gpl.*\.zip$' -and $_.name -notmatch 'shared'
  } | Select-Object -First 1
}
if (-not $ffAsset) { throw "FFmpeg Windows archive was not found." }

$ffZip = Join-Path $Temp $ffAsset.name
Invoke-WebRequest -Uri $ffAsset.browser_download_url -OutFile $ffZip
$ffExtract = Join-Path $Temp "ffmpeg"
Remove-Item $ffExtract -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive $ffZip -DestinationPath $ffExtract -Force
$ffExe = Get-ChildItem $ffExtract -Recurse -Filter "ffmpeg.exe" -File | Select-Object -First 1
if (-not $ffExe) { throw "ffmpeg.exe was not found inside the archive." }
Copy-Item $ffExe.FullName (Join-Path $Resources "ffmpeg.exe") -Force

$license = Invoke-WebRequest -Uri "https://raw.githubusercontent.com/tonhowtf/omniget/main/LICENSE"
$notices = @"
DRAGON bundles separate third-party command-line tools.

OmniGet
Source: https://github.com/tonhowtf/omniget
License: GPL-3.0
Bundled version: $($release.tag_name)

The complete OmniGet license text follows.

$($license.Content)

yt-dlp
Source: https://github.com/yt-dlp/yt-dlp
See the upstream project for license and source.

FFmpeg
Source: https://github.com/BtbN/FFmpeg-Builds
FFmpeg project: https://ffmpeg.org/
See the upstream projects for applicable license and source.
"@
Set-Content -Path (Join-Path $Resources "THIRD_PARTY_NOTICES.txt") -Value $notices -Encoding UTF8

Write-Host "DRAGON desktop tools are ready in $Resources"
