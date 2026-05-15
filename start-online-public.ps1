$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverPort = 18766
$serverUrl = "http://127.0.0.1:$serverPort"
$scriptPath = Join-Path $root 'lingverse-spirit-cleaner.user.js'
$outerScriptPath = Join-Path (Split-Path -Parent $root) 'lingverse-spirit-cleaner.user.js'
$cloudflaredPath = Join-Path $root 'cloudflared.exe'
$cloudflaredUrl = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
$tunnelOutLog = Join-Path $root 'cloudflared-online.out.log'
$tunnelErrLog = Join-Path $root 'cloudflared-online.err.log'

function Test-PortListening {
    param([int]$Port)
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Update-HeartbeatEndpoint {
    param([string]$Endpoint)
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    $text = [System.IO.File]::ReadAllText($scriptPath, $utf8NoBom)
    $updated = [regex]::Replace(
        $text,
        "var DEFAULT_ONLINE_STATS_ENDPOINT = '[^']*';",
        "var DEFAULT_ONLINE_STATS_ENDPOINT = '$Endpoint';",
        1
    )
    if ($updated -eq $text) {
        throw 'Cannot find DEFAULT_ONLINE_STATS_ENDPOINT in userscript.'
    }
    [System.IO.File]::WriteAllText($scriptPath, $updated, $utf8NoBom)
    if (Test-Path $outerScriptPath) {
        Copy-Item -LiteralPath $scriptPath -Destination $outerScriptPath -Force
    }
}

if (-not (Test-Path $cloudflaredPath)) {
    Write-Host 'Downloading cloudflared...'
    Invoke-WebRequest -Uri $cloudflaredUrl -OutFile $cloudflaredPath -UseBasicParsing
}

if (-not (Test-PortListening -Port $serverPort)) {
    Write-Host "Starting online server on $serverUrl ..."
    Start-Process -FilePath node -ArgumentList @('online-server.js') -WorkingDirectory $root -WindowStyle Hidden | Out-Null
    Start-Sleep -Seconds 1
}

if (-not (Test-PortListening -Port $serverPort)) {
    throw "Online server did not start on port $serverPort."
}

Get-Process cloudflared -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $cloudflaredPath } |
    Stop-Process -Force -ErrorAction SilentlyContinue

Remove-Item -LiteralPath $tunnelOutLog, $tunnelErrLog -Force -ErrorAction SilentlyContinue

Write-Host 'Starting Cloudflare quick tunnel...'
Start-Process -FilePath $cloudflaredPath `
    -ArgumentList @('tunnel', '--url', $serverUrl, '--no-autoupdate') `
    -RedirectStandardOutput $tunnelOutLog `
    -RedirectStandardError $tunnelErrLog `
    -WindowStyle Hidden | Out-Null

$publicUrl = ''
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    $logText = ''
    if (Test-Path $tunnelOutLog) { $logText += Get-Content -LiteralPath $tunnelOutLog -Raw }
    if (Test-Path $tunnelErrLog) { $logText += "`n" + (Get-Content -LiteralPath $tunnelErrLog -Raw) }
    $match = [regex]::Match($logText, 'https://[-a-z0-9]+\.trycloudflare\.com')
    if ($match.Success) {
        $publicUrl = $match.Value
        break
    }
}

if (-not $publicUrl) {
    Write-Host 'Cloudflared logs:'
    Get-Content -LiteralPath $tunnelOutLog, $tunnelErrLog -ErrorAction SilentlyContinue
    throw 'Cloudflare tunnel URL was not created.'
}

$endpoint = "$publicUrl/api/heartbeat"
Update-HeartbeatEndpoint -Endpoint $endpoint

Write-Host ''
Write-Host "Dashboard: $publicUrl/"
Write-Host "Heartbeat: $endpoint"
Write-Host ''
Write-Host 'Userscript endpoint has been updated locally. Run your publish script when you want others to use this URL.'
