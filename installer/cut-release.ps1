<#
.SYNOPSIS
  Cut a new release: build artifacts, write manifest with sha256s, commit and push to the prod branch.

.PARAMETER Version
  Required. New version in x.y.z form (e.g. 0.2.0). Bumps version.txt.

.PARAMETER Notes
  Optional. Short release notes shown in the in-app update banner.

.PARAMETER Kind
  hot | full. Default: hot. Use "full" when the update needs the installer
  (e.g. you changed Python deps, models, ffmpeg). When "full", `-InstallerUrl`
  should also be provided.

.PARAMETER InstallerUrl
  URL the app should send users to when kind=full. Defaults to the GitHub
  Releases "latest" download URL once -RepoOwner is known.

.PARAMETER Branch
  Branch to publish to. Default: "prod".

.PARAMETER NoPush
  Stage and commit but skip `git push`.

.PARAMETER DryRun
  Build and write release/ but make no git changes.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string]$Version,
  [string]$Notes = "",
  [ValidateSet("hot","full")] [string]$Kind = "hot",
  [string]$InstallerUrl = "",
  [string]$Branch = "prod",
  [switch]$NoPush,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
  throw "Version must be x.y.z (got '$Version')"
}

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Info($msg) { Write-Host "    $msg" -ForegroundColor DarkGray }

# 1. Sanity: git repo, branch, clean tree
if (-not (Test-Path "$ProjectRoot\.git")) { throw "Not a git repo. Run 'git init' first." }

$currentBranch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($currentBranch -ne $Branch -and -not $DryRun) {
  Info "Switching from '$currentBranch' to '$Branch'"
  $exists = git rev-parse --verify --quiet "$Branch" 2>$null
  if (-not $exists) { git checkout -b $Branch | Out-Null }
  else { git checkout $Branch | Out-Null }
}

$dirty = (git status --porcelain | Out-String).Trim()
if ($dirty -and -not $DryRun) {
  throw "Working tree has uncommitted changes. Commit or stash them first:`n$dirty"
}

# 2. Bump version.txt
Step "Setting version to $Version"
Set-Content -Path "$ProjectRoot\version.txt" -Value "$Version`n" -NoNewline -Encoding ASCII

# 3. Build UI + server bundle
Step "Building UI and server bundle"
& npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }

# 4. Stage release/
$ReleaseDir = Join-Path $ProjectRoot "release"
if (Test-Path $ReleaseDir) { Remove-Item -Recurse -Force $ReleaseDir }
New-Item -ItemType Directory -Force -Path "$ReleaseDir\ui","$ReleaseDir\server" | Out-Null

Step "Staging release files"
Copy-Item -Recurse -Force "$ProjectRoot\dist\*"               "$ReleaseDir\ui\"
Copy-Item -Force         "$ProjectRoot\dist-server\index.mjs" "$ReleaseDir\server\index.mjs"
Copy-Item -Force         "$ProjectRoot\server\transcribe.py"  "$ReleaseDir\server\transcribe.py"

# 5. Compute hashes
Step "Computing sha256 hashes"
$files = @()
Get-ChildItem -File -Recurse $ReleaseDir | ForEach-Object {
  $rel = $_.FullName.Substring($ReleaseDir.Length + 1).Replace('\','/')
  if ($rel -eq "manifest.json") { return }
  $hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower()
  $files += [pscustomobject]@{ path = $rel; sha256 = $hash; size = $_.Length }
  Info "$rel  $($hash.Substring(0,12))..."
}

# 6. Default installer URL if not supplied
if (-not $InstallerUrl) {
  $remote = (git remote get-url origin 2>$null)
  if ($remote -match 'github\.com[:/](.+?)/(.+?)(?:\.git)?$') {
    $owner = $Matches[1]; $repo = $Matches[2]
    $InstallerUrl = "https://github.com/$owner/$repo/releases/latest/download/VideoTranscribeSetup.exe"
  }
}

# 7. Write manifest.json
$manifest = [ordered]@{
  version       = $Version
  kind          = $Kind
  notes         = $Notes
  released      = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  min_hot_from  = "0.1.0"
  installer_url = $InstallerUrl
  files         = $files
}
$manifestJson = ($manifest | ConvertTo-Json -Depth 6)
Set-Content -Path "$ReleaseDir\manifest.json" -Value $manifestJson -Encoding ASCII
Info "Wrote $ReleaseDir\manifest.json ($($files.Count) files)"

if ($DryRun) {
  Step "Dry run - no git changes made."
  return
}

# 8. Commit + push
Step "Committing"
git add "version.txt" "release"
git commit -m "Release v$Version" | Out-Null

if (-not $NoPush) {
  Step "Pushing to origin/$Branch"
  git push -u origin $Branch
}

Step "Done. Released v$Version on '$Branch'."
Info "Open the app and click 'Check for updates' (or wait for auto-check) to verify."
