param([string]$WowRoot = "C:\Program Files (x86)\World of Warcraft")
$target = Join-Path $PSScriptRoot "..\addon\ForeverTracker" | Resolve-Path
$link   = Join-Path $WowRoot "_forever_\Interface\AddOns\ForeverTracker"
if (Test-Path $link) { Remove-Item $link -Force }
New-Item -ItemType Junction -Path $link -Target $target | Out-Null
Write-Host "Linked $link -> $target"
