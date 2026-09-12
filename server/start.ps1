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

& "$PSScriptRoot\mvnw.cmd" spring-boot:run
exit $LASTEXITCODE
