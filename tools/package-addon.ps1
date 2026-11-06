<#
.SYNOPSIS
  Build ForeverTracker-<version>.zip, ready to unzip into _forever_\Interface\AddOns.

.DESCRIPTION
  The version comes from "## Version:" in ForeverTracker.toc and must match ns.VERSION in
  Core.lua. The archive holds a single ForeverTracker/ folder (forward-slash entry names, so
  it unzips the same everywhere); __pycache__ folders and dotfiles are left out.

.EXAMPLE
  ./tools/package-addon.ps1                 # -> release/ForeverTracker-0.1.0.zip
  ./tools/package-addon.ps1 -OutDir C:\tmp
#>
param(
  [string]$AddonDir = (Join-Path $PSScriptRoot "..\addon\ForeverTracker"),
  [string]$OutDir = (Join-Path $PSScriptRoot "..\release")
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$AddonDir = (Resolve-Path $AddonDir).Path
$toc = Join-Path $AddonDir "ForeverTracker.toc"
$core = Join-Path $AddonDir "Core.lua"

$tocMatch = Select-String -Path $toc -Pattern '^## Version:\s*(\S+)' | Select-Object -First 1
if (-not $tocMatch) { throw "No '## Version:' line in $toc" }
$version = $tocMatch.Matches[0].Groups[1].Value

$coreMatch = Select-String -Path $core -Pattern 'ns\.VERSION\s*=\s*"([^"]*)"' | Select-Object -First 1
if (-not $coreMatch) { throw "No ns.VERSION in $core" }
$coreVersion = $coreMatch.Matches[0].Groups[1].Value
if ($coreVersion -ne $version) {
  Write-Error "Version mismatch: ForeverTracker.toc says $version, Core.lua says $coreVersion."
  exit 1
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
$zipPath = Join-Path $OutDir "ForeverTracker-$version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$files = Get-ChildItem -Path $AddonDir -Recurse -File -Force | Where-Object {
  $relative = $_.FullName.Substring($AddonDir.Length).TrimStart('\', '/')
  $parts = $relative -split '[\\/]'
  -not ($parts | Where-Object { $_ -eq "__pycache__" -or $_.StartsWith(".") })
} | Sort-Object FullName

$archive = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($file in $files) {
    $relative = $file.FullName.Substring($AddonDir.Length).TrimStart('\', '/') -replace '\\', '/'
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archive, $file.FullName, "ForeverTracker/$relative",
      [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {
  $archive.Dispose()
}

Write-Host "Built $zipPath ($($files.Count) files)"
