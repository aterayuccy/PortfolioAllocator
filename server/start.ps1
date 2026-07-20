param(
    [string]$DatabaseUrl = "jdbc:postgresql://127.0.0.1:55432/portfolio_allocator",
    [string]$DatabaseUser = "portfolio"
)

$ErrorActionPreference = "Stop"

$backendClient = [System.Net.Sockets.TcpClient]::new()
try {
    $backendConnection = $backendClient.BeginConnect("127.0.0.1", 1010, $null, $null)
    $backendIsRunning = $backendConnection.AsyncWaitHandle.WaitOne(500) -and $backendClient.Connected
}
finally {
    $backendClient.Dispose()
}

if ($backendIsRunning) {
    Write-Host "Backend is already running at http://127.0.0.1:1010"
    exit 0
}

if ($DatabaseUrl -eq "jdbc:postgresql://127.0.0.1:55432/portfolio_allocator") {
    & "$PSScriptRoot\start-db.ps1"
}

$databasePassword = $env:DB_PASSWORD
if ([string]::IsNullOrWhiteSpace($databasePassword) -and $DatabaseUrl -notlike "*127.0.0.1:55432*") {
    $securePassword = Read-Host "PostgreSQL password for '$DatabaseUser'" -AsSecureString
    $databasePassword = [System.Net.NetworkCredential]::new("", $securePassword).Password
}

if ([string]::IsNullOrWhiteSpace($databasePassword) -and $DatabaseUrl -notlike "*127.0.0.1:55432*") {
    throw "A PostgreSQL password is required."
}

$env:DB_URL = $DatabaseUrl
$env:DB_USERNAME = $DatabaseUser
$env:DB_PASSWORD = if ($null -eq $databasePassword) { "" } else { $databasePassword }

try {
    & "$PSScriptRoot\mvnw.cmd" spring-boot:run
    exit $LASTEXITCODE
}
finally {
    Remove-Item Env:DB_PASSWORD -ErrorAction SilentlyContinue
}
