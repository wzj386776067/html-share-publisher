[CmdletBinding()]
param(
  [string]$Version = "",
  [string]$ApiBase = "https://share.bi-cheng.cn",
  [string]$Client = "auto",
  [string]$InstallRoot = (Join-Path $HOME ".local/share/html-share-publisher"),
  [string]$PayloadDir = "",
  [switch]$SkipRegister,
  [switch]$SkipApiCheck
)

$ErrorActionPreference = "Stop"
$Repository = "wzj386776067/html-share-publisher"
$TemporaryRoot = ""

function Require-Command([string]$Name) {
  $Command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $Command) { throw "Missing required command: $Name" }
  return $Command.Source
}

try {
  $NodePath = Require-Command "node"
  $NpmPath = (Get-Command "npm.cmd" -ErrorAction SilentlyContinue).Source
  if (-not $NpmPath) { $NpmPath = Require-Command "npm" }
  $TarPath = Require-Command "tar"
  $NodeMajor = [int](& $NodePath -p 'Number(process.versions.node.split(".")[0])')
  if ($NodeMajor -lt 22) { throw "Node.js 22 or newer is required; found $(& $NodePath --version)." }

  if (-not $PayloadDir) {
    $TemporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("html-share-publisher-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $TemporaryRoot | Out-Null
    $Asset = "html-share-publisher.tar.gz"
    if ($Version) {
      $ReleaseBase = "https://github.com/$Repository/releases/download/$Version"
    } else {
      $ReleaseBase = "https://github.com/$Repository/releases/latest/download"
    }
    $ArchivePath = Join-Path $TemporaryRoot $Asset
    $ChecksumPath = "$ArchivePath.sha256"
    $SignaturePath = "$ArchivePath.sig"
    $DisplayVersion = if ($Version) { $Version } else { "latest" }
    Write-Host "Downloading HTML Share Publisher $DisplayVersion..."
    Invoke-WebRequest -UseBasicParsing -Uri "$ReleaseBase/$Asset" -OutFile $ArchivePath
    Invoke-WebRequest -UseBasicParsing -Uri "$ReleaseBase/$Asset.sha256" -OutFile $ChecksumPath
    Invoke-WebRequest -UseBasicParsing -Uri "$ReleaseBase/$Asset.sig" -OutFile $SignaturePath
    $Expected = ((Get-Content $ChecksumPath -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
    $Actual = (Get-FileHash -Algorithm SHA256 $ArchivePath).Hash.ToLowerInvariant()
    if (-not $Expected -or $Expected -ne $Actual) { throw "Release checksum verification failed." }
    $VerifyScript = 'const c=require("crypto"),f=require("fs");const p=`-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAQy+MczWmB86XBwm3YAzVodB3a6mebzNziTjhNQ0sWzk=\n-----END PUBLIC KEY-----`;if(!c.verify(null,f.readFileSync(process.argv[1]),p,f.readFileSync(process.argv[2])))process.exit(1)'
    & $NodePath -e $VerifyScript $ArchivePath $SignaturePath
    if ($LASTEXITCODE -ne 0) { throw "Release signature verification failed." }
    $Extracted = Join-Path $TemporaryRoot "release"
    New-Item -ItemType Directory -Path $Extracted | Out-Null
    & $TarPath -xzf $ArchivePath -C $Extracted
    if ($LASTEXITCODE -ne 0) { throw "Failed to extract release archive." }
    $PayloadDir = Join-Path $Extracted "html-share-publisher"
  }

  if (-not (Test-Path (Join-Path $PayloadDir "launcher.mjs")) -or
      -not (Test-Path (Join-Path $PayloadDir "mcp/package.json")) -or
      -not (Test-Path (Join-Path $PayloadDir "skills/html-share-publisher/SKILL.md")) -or
      -not (Test-Path (Join-Path $PayloadDir "installer/configure-clients.mjs"))) {
    throw "Invalid release payload: $PayloadDir"
  }
  if (-not $Version -and (Test-Path (Join-Path $PayloadDir "VERSION"))) {
    $Version = (Get-Content (Join-Path $PayloadDir "VERSION") -Raw).Trim()
  }
  if (-not $Version) { $Version = "local" }
  $ApiBase = $ApiBase.TrimEnd('/')

  $ReleasesRoot = Join-Path $InstallRoot "releases"
  New-Item -ItemType Directory -Force -Path $ReleasesRoot | Out-Null
  $ReleaseDir = Join-Path $ReleasesRoot $Version
  $ReleaseTemp = Join-Path $ReleasesRoot (".install-$Version-" + $PID)
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $ReleaseTemp
  New-Item -ItemType Directory -Path $ReleaseTemp | Out-Null
  Copy-Item -Recurse (Join-Path $PayloadDir "mcp") (Join-Path $ReleaseTemp "mcp")
  Copy-Item -Recurse (Join-Path $PayloadDir "skills/html-share-publisher") (Join-Path $ReleaseTemp "skill")
  Copy-Item -Recurse (Join-Path $PayloadDir "installer") (Join-Path $ReleaseTemp "installer")

  Write-Host "Installing MCP dependencies..."
  & $NpmPath ci --omit=dev --prefix (Join-Path $ReleaseTemp "mcp")
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }
  & $NpmPath run verify --prefix (Join-Path $ReleaseTemp "mcp")
  if ($LASTEXITCODE -ne 0) { throw "MCP verification failed." }

  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $ReleaseDir
  Move-Item $ReleaseTemp $ReleaseDir

  $LauncherPath = Join-Path $InstallRoot "launcher.mjs"
  $LauncherTemp = Join-Path $InstallRoot (".launcher-" + $PID)
  Copy-Item (Join-Path $PayloadDir "launcher.mjs") $LauncherTemp
  Remove-Item -Force -ErrorAction SilentlyContinue $LauncherPath
  Move-Item $LauncherTemp $LauncherPath
  [System.IO.File]::WriteAllText((Join-Path $InstallRoot "VERSION"), "$Version`n")
  @{
    lastAttemptAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
    lastSuccessAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
    latestVersion = $Version
    currentVersion = $Version
  } | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $InstallRoot "update-state.json")

  if (-not $SkipRegister) {
    Write-Host "Configuring detected AI clients..."
    & $NodePath (Join-Path $ReleaseDir "installer/configure-clients.mjs") `
      --client $Client `
      --install-root $InstallRoot `
      --skill-source (Join-Path $ReleaseDir "skill") `
      --server-path $LauncherPath `
      --node-path $NodePath `
      --api-base $ApiBase
    if ($LASTEXITCODE -ne 0) { throw "AI client configuration failed." }
  }

  if (-not $SkipApiCheck) {
    $Response = Invoke-WebRequest -UseBasicParsing -Uri "$ApiBase/api/health"
    if ($Response.StatusCode -lt 200 -or $Response.StatusCode -ge 300) {
      throw "Workbench health check returned $($Response.StatusCode)."
    }
  }

  Write-Host ""
  Write-Host "HTML Share Publisher $Version installed successfully."
  Write-Host "MCP: $LauncherPath"
  Write-Host "Clients: $Client"
  if (-not $SkipRegister) { Write-Host "Restart the current AI client or open a new task." }
} finally {
  if ($TemporaryRoot) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $TemporaryRoot }
}
