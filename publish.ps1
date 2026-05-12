param(
    [string]$Message = "",
    [switch]$NoPush
)

$ErrorActionPreference = "Stop"

function Fail($Text) {
    Write-Host "ERROR: $Text" -ForegroundColor Red
    exit 1
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

if (-not (Test-Path ".git")) {
    Fail "This script must run inside the lingverse-spirit-cleaner git repository."
}

$scriptPath = Join-Path $root "lingverse-spirit-cleaner.user.js"
$releasePath = Join-Path $root "release.json"

if (-not (Test-Path $scriptPath)) { Fail "Missing lingverse-spirit-cleaner.user.js" }
if (-not (Test-Path $releasePath)) { Fail "Missing release.json" }

$scriptText = Get-Content -LiteralPath $scriptPath -Raw -Encoding UTF8
$release = Get-Content -LiteralPath $releasePath -Raw -Encoding UTF8 | ConvertFrom-Json

$metaVersion = [regex]::Match($scriptText, "@version\s+([^\s]+)").Groups[1].Value
$scriptVersion = [regex]::Match($scriptText, "SCRIPT_VERSION\s*=\s*'([^']+)'").Groups[1].Value
$releaseVersion = [string]$release.version

if (-not $metaVersion) { Fail "Cannot find @version in userscript metadata." }
if (-not $scriptVersion) { Fail "Cannot find SCRIPT_VERSION in userscript body." }
if (-not $releaseVersion) { Fail "Cannot find version in release.json." }
if ($metaVersion -ne $scriptVersion -or $metaVersion -ne $releaseVersion) {
    Fail "Version mismatch: @version=$metaVersion, SCRIPT_VERSION=$scriptVersion, release.json=$releaseVersion"
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
    node --check $scriptPath
    if ($LASTEXITCODE -ne 0) { Fail "node --check failed." }

    $innerCheck = @'
const fs = require('fs');
const text = fs.readFileSync(process.argv[2], 'utf8');
const start = text.indexOf('var source = String.raw`');
if (start < 0) throw new Error('Cannot find injected script source.');
const bodyStart = text.indexOf('`', start) + 1;
const bodyEnd = text.indexOf('`;', bodyStart);
if (bodyStart <= 0 || bodyEnd < 0) throw new Error('Cannot find injected script body.');
new Function(text.slice(bodyStart, bodyEnd));
'@
    $innerCheck | node - $scriptPath
    if ($LASTEXITCODE -ne 0) { Fail "Injected script syntax check failed." }
} else {
    Write-Host "WARN: node not found, skipped JavaScript syntax checks." -ForegroundColor Yellow
}

$status = git status --short
if (-not $status) {
    Write-Host "No local changes to publish." -ForegroundColor Yellow
    exit 0
}

Write-Host "Changes to publish:" -ForegroundColor Cyan
$status | ForEach-Object { Write-Host "  $_" }

git add README.md release.json lingverse-spirit-cleaner.user.js publish.ps1
if ($LASTEXITCODE -ne 0) { Fail "git add failed." }

if (-not $Message) {
    $Message = "Publish v$metaVersion"
}

git commit -m $Message
if ($LASTEXITCODE -ne 0) { Fail "git commit failed." }

if ($NoPush) {
    Write-Host "Committed locally. Push skipped because -NoPush was used." -ForegroundColor Yellow
    exit 0
}

git push
if ($LASTEXITCODE -ne 0) { Fail "git push failed." }

$rawScriptUrl = "https://raw.githubusercontent.com/SuRanHF/lingverse-spirit-cleaner/main/lingverse-spirit-cleaner.user.js"
$rawReleaseUrl = "https://raw.githubusercontent.com/SuRanHF/lingverse-spirit-cleaner/main/release.json?cb=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"

try {
    $remoteScript = (Invoke-WebRequest -UseBasicParsing $rawScriptUrl -Headers @{ "Cache-Control" = "no-cache" }).Content
    $remoteVersion = [regex]::Match($remoteScript, "@version\s+([^\s]+)").Groups[1].Value
    if ($remoteVersion -ne $metaVersion) {
        Write-Host "WARN: remote script still reports $remoteVersion. GitHub raw cache may need a moment." -ForegroundColor Yellow
    }

    $remoteRelease = (Invoke-WebRequest -UseBasicParsing $rawReleaseUrl -Headers @{ "Cache-Control" = "no-cache" }).Content | ConvertFrom-Json
    if ([string]$remoteRelease.version -ne $metaVersion) {
        Write-Host "WARN: remote release.json still reports $($remoteRelease.version). GitHub raw cache may need a moment." -ForegroundColor Yellow
    }
} catch {
    Write-Host "WARN: pushed successfully, but remote verification failed: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "Published v$metaVersion." -ForegroundColor Green
