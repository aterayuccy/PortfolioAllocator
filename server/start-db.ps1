$ErrorActionPreference = "Stop"

$postgresBin = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue |
    Sort-Object { [int]$_.Name } -Descending |
    ForEach-Object { Join-Path $_.FullName "bin" } |
    Where-Object { Test-Path (Join-Path $_ "pg_ctl.exe") } |
    Select-Object -First 1

if (-not $postgresBin) {
    throw "PostgreSQL command-line tools were not found under C:\Program Files\PostgreSQL."
}

$runtimeDirectory = Join-Path $PSScriptRoot "..\.runtime"
$dataDirectory = Join-Path $runtimeDirectory "postgres-data"
$logFile = Join-Path $runtimeDirectory "postgres.log"
$port = 55432
$database = "portfolio_allocator"
$user = "portfolio"

New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null

if (-not (Test-Path (Join-Path $dataDirectory "PG_VERSION"))) {
    & (Join-Path $postgresBin "initdb.exe") -D $dataDirectory -U $user -A trust --encoding=UTF8 --locale=C
    if ($LASTEXITCODE -ne 0) { throw "Could not initialize the project PostgreSQL database." }
}

$tcpClient = [System.Net.Sockets.TcpClient]::new()
try {
    $connection = $tcpClient.BeginConnect("127.0.0.1", $port, $null, $null)
    $databaseIsRunning = $connection.AsyncWaitHandle.WaitOne(500) -and $tcpClient.Connected
}
finally {
    $tcpClient.Dispose()
}

if (-not $databaseIsRunning) {
    & (Join-Path $postgresBin "pg_ctl.exe") -D $dataDirectory -l $logFile -o "-p $port -h 127.0.0.1" start
    if ($LASTEXITCODE -ne 0) { throw "Could not start the project PostgreSQL database." }
}

$databaseExists = & (Join-Path $postgresBin "psql.exe") -h 127.0.0.1 -p $port -U $user -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$database'"
if ($LASTEXITCODE -ne 0) { throw "Could not inspect the project PostgreSQL database." }

if ($databaseExists.Trim() -ne "1") {
    & (Join-Path $postgresBin "createdb.exe") -h 127.0.0.1 -p $port -U $user $database
    if ($LASTEXITCODE -ne 0) { throw "Could not create the project PostgreSQL database." }
}

Write-Host "Project PostgreSQL is ready at 127.0.0.1:$port/$database"
