# Windows Task Scheduler entry point. Use only in a dedicated disposable clone.

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$repoRoot = Split-Path -Parent $PSScriptRoot
$nodeExe = Join-Path $env:ProgramFiles 'nodejs\node.exe'
$automationMarker = Join-Path $repoRoot '.git\fairfax-automation-clone'
$exitCode = 1

try {
    if (-not (Test-Path -LiteralPath $nodeExe -PathType Leaf)) {
        throw "Node.js executable not found at '$nodeExe'."
    }
    if (-not (Test-Path -LiteralPath $automationMarker -PathType Leaf)) {
        throw "Dedicated-clone marker not found at '$automationMarker'; refusing to enable automation mode."
    }

    $env:FAIRFAX_AUTOMATION = '1'
    Push-Location $repoRoot
    try {
        & $nodeExe (Join-Path $repoRoot 'scripts\daily-scrape.mjs') @args
        $exitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
}
catch {
    [Console]::Error.WriteLine("Fairfax nightly scrape could not run: $($_.Exception.Message)")
    $exitCode = 1
}

exit ([int]$exitCode)
