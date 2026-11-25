$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$site = Join-Path $PSScriptRoot 'site'

Push-Location (Join-Path $root 'client')
try {
    $env:VITE_QUOTE_API = 'php'
    & npm run build -- --base=/portfolioallocator/
    if ($LASTEXITCODE -ne 0) { throw 'Vite build failed.' }
}
finally {
    Remove-Item Env:VITE_QUOTE_API -ErrorAction SilentlyContinue
    Pop-Location
}

New-Item -ItemType Directory -Force $site | Out-Null
Copy-Item (Join-Path $root 'client/dist/*') $site -Recurse -Force
$index = Join-Path $site 'index.html'
$html = [System.IO.File]::ReadAllText($index) -replace "`r`r`n", "`n" -replace "`r`n", "`n"
[System.IO.File]::WriteAllText($index, $html, [System.Text.UTF8Encoding]::new($false))
