# Wrapper invoked by Windows Task Scheduler to run the daily scrape.
# Keeping this as a thin PowerShell wrapper (rather than pointing Task
# Scheduler directly at node.exe) makes it easy to see/adjust the working
# directory and node path in one place without editing the scheduled task.

$ErrorActionPreference = 'Continue'

$repoRoot = Split-Path -Parent $PSScriptRoot
$nodeExe = Join-Path $env:ProgramFiles 'nodejs\node.exe'

Set-Location $repoRoot
& $nodeExe (Join-Path $repoRoot 'scripts\daily-scrape.mjs') @args
