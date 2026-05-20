<#
.SYNOPSIS
  Build the Video Transcribe Windows installer payload.

.DESCRIPTION
  Stages everything a non-technical user needs to run the app:
    - Portable Python 3.11 embeddable + WhisperX + PyTorch (CPU)
    - Bundled ffmpeg
    - Bundled Node runtime
    - Pre-built React UI
    - Bundled server (esbuild output)
    - Pre-downloaded Whisper models (tiny, base, small)
    - HF token (if HF_TOKEN env var is set)
    - launch.vbs / start.cmd / stop.cmd

  Output: dist-installer\  (~2.5 - 3 GB)
  After this, run Inno Setup against installer\installer.iss to produce VideoTranscribeSetup.exe.

.PARAMETER Force
  Wipe dist-installer\ and download caches before rebuilding.

.PARAMETER SkipModels
  Skip pre-downloading Whisper models (the app will download on first use instead).

.PARAMETER Models
  Comma-separated list of models to pre-download. Default: tiny,base,small
#>
[CmdletBinding()]
param(
  [switch]$Force,
  [switch]$SkipModels,
  [string]$Models = "tiny,base,small"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # speeds up Invoke-WebRequest

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Cache = Join-Path $ProjectRoot ".build-cache"
$Stage = Join-Path $ProjectRoot "dist-installer"

# Pinned versions
$PythonVersion = "3.11.9"
$NodeVersion   = "20.16.0"
$FfmpegUrl     = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
$PythonUrl     = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
$NodeUrl       = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"
$GetPipUrl     = "https://bootstrap.pypa.io/get-pip.py"

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Info($msg) { Write-Host "    $msg" -ForegroundColor DarkGray }

if ($Force) {
  Step "Clearing dist-installer and cache"
  if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
  if (Test-Path $Cache) { Remove-Item -Recurse -Force $Cache }
}

New-Item -ItemType Directory -Force -Path $Cache, $Stage | Out-Null

function Get-Cached([string]$Url, [string]$FileName) {
  $dest = Join-Path $Cache $FileName
  if (-not (Test-Path $dest)) {
    Step "Downloading $FileName"
    Info $Url
    Invoke-WebRequest -Uri $Url -OutFile $dest
  } else {
    Info "Using cached $FileName"
  }
  return $dest
}

function Expand-Once([string]$Zip, [string]$Dest) {
  if (Test-Path $Dest) { return }
  Step "Extracting $(Split-Path -Leaf $Zip)"
  Expand-Archive -Path $Zip -DestinationPath $Dest -Force
}

# ---------------------------------------------------------------------------
# 1. Build the JS side (Vite + esbuild)
# ---------------------------------------------------------------------------
Step "Building UI and server bundle"
Push-Location $ProjectRoot
try {
  if (-not (Test-Path "$ProjectRoot\node_modules")) {
    Info "Running npm install (first time)"
    & npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
  }
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
} finally {
  Pop-Location
}

# ---------------------------------------------------------------------------
# 2. Stage Node runtime
# ---------------------------------------------------------------------------
$NodeZip = Get-Cached $NodeUrl "node-v$NodeVersion-win-x64.zip"
$NodeExtract = Join-Path $Cache "node-extract"
Expand-Once $NodeZip $NodeExtract
$StagedNode = Join-Path $Stage "node"
if (-not (Test-Path $StagedNode)) {
  New-Item -ItemType Directory -Force -Path $StagedNode | Out-Null
  $nodeInner = Get-ChildItem -Directory $NodeExtract | Select-Object -First 1
  Copy-Item -Recurse -Force "$($nodeInner.FullName)\*" $StagedNode
}

# ---------------------------------------------------------------------------
# 3. Stage ffmpeg
# ---------------------------------------------------------------------------
$FfZip = Get-Cached $FfmpegUrl "ffmpeg-release-essentials.zip"
$FfExtract = Join-Path $Cache "ffmpeg-extract"
Expand-Once $FfZip $FfExtract
$StagedFf = Join-Path $Stage "ffmpeg"
if (-not (Test-Path $StagedFf)) {
  New-Item -ItemType Directory -Force -Path $StagedFf | Out-Null
  $ffInner = Get-ChildItem -Directory $FfExtract | Select-Object -First 1
  Copy-Item -Force "$($ffInner.FullName)\bin\ffmpeg.exe" $StagedFf
  Copy-Item -Force "$($ffInner.FullName)\bin\ffprobe.exe" $StagedFf
}

# ---------------------------------------------------------------------------
# 4. Stage Python embeddable + pip + WhisperX
# ---------------------------------------------------------------------------
$StagedPy = Join-Path $Stage "python"
$PythonExe = Join-Path $StagedPy "python.exe"
if (-not (Test-Path $PythonExe)) {
  Step "Setting up portable Python $PythonVersion"
  $PyZip = Get-Cached $PythonUrl "python-$PythonVersion-embed-amd64.zip"
  New-Item -ItemType Directory -Force -Path $StagedPy | Out-Null
  Expand-Archive -Path $PyZip -DestinationPath $StagedPy -Force

  # Embeddable distro ships with a ._pth that disables site-packages.
  # We need site-packages for pip + whisperx, so patch the ._pth.
  $pthFile = Get-ChildItem $StagedPy -Filter "python*._pth" | Select-Object -First 1
  if ($pthFile) {
    Info "Patching $($pthFile.Name) to enable site-packages"
    $pthContent = Get-Content $pthFile.FullName
    $pthContent = $pthContent -replace '^#\s*import site', 'import site'
    if ($pthContent -notmatch 'import site') { $pthContent += "`nimport site" }
    Set-Content -Path $pthFile.FullName -Value $pthContent -Encoding ASCII
  }

  $GetPip = Get-Cached $GetPipUrl "get-pip.py"
  Info "Installing pip"
  & $PythonExe $GetPip --no-warn-script-location
  if ($LASTEXITCODE -ne 0) { throw "get-pip.py failed" }
}

Step "Installing WhisperX into bundled Python (this is the slow step - several minutes)"
$ReqFile = Join-Path $ProjectRoot "requirements.txt"
& $PythonExe -m pip install --upgrade pip --no-warn-script-location
& $PythonExe -m pip install --no-warn-script-location torch torchaudio --index-url https://download.pytorch.org/whl/cpu
if ($LASTEXITCODE -ne 0) { throw "pip install torch (cpu) failed" }
& $PythonExe -m pip install --no-warn-script-location -r $ReqFile
if ($LASTEXITCODE -ne 0) { throw "pip install -r requirements.txt failed" }

# ---------------------------------------------------------------------------
# 5. Pre-download Whisper models into the staged HF cache
# ---------------------------------------------------------------------------
$ModelsDir = Join-Path $Stage "models"
New-Item -ItemType Directory -Force -Path $ModelsDir | Out-Null

if (-not $SkipModels) {
  Step "Pre-downloading Whisper models: $Models"
  $env:HF_HOME = $ModelsDir
  $modelList = $Models.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  foreach ($m in $modelList) {
    Info "Fetching faster-whisper '$m'"
    & $PythonExe -c "from faster_whisper import WhisperModel; WhisperModel('$m', device='cpu', compute_type='int8')"
    if ($LASTEXITCODE -ne 0) { throw "Failed to download model $m" }
  }
  Info "Fetching wav2vec2 alignment model (English)"
  & $PythonExe -c "import whisperx; whisperx.load_align_model(language_code='en', device='cpu')"

  if ($env:HF_TOKEN) {
    Info "Pre-fetching pyannote diarization models with provided HF_TOKEN"
    $diarSnippet = @'
import os
from huggingface_hub import snapshot_download
token = os.environ['HF_TOKEN']
for repo in ['pyannote/segmentation-3.0', 'pyannote/speaker-diarization-3.1']:
    try:
        snapshot_download(repo, token=token)
        print(f'  ok: {repo}')
    except Exception as e:
        print(f'  WARN: {repo} -> {e}')
'@
    $tmp = New-TemporaryFile
    Set-Content -Path $tmp -Value $diarSnippet -Encoding UTF8
    & $PythonExe $tmp
    Remove-Item $tmp
  } else {
    Info "HF_TOKEN not set in environment - diarization models NOT pre-fetched."
    Info "Set `$env:HF_TOKEN before running this script to include them."
  }
} else {
  Info "Skipping model pre-download (--SkipModels)"
}

# ---------------------------------------------------------------------------
# 6. Stage server bundle, transcribe.py, prebuilt UI
# ---------------------------------------------------------------------------
Step "Staging server, UI, and Python script"
$StagedServer = Join-Path $Stage "server"
New-Item -ItemType Directory -Force -Path $StagedServer | Out-Null
Copy-Item -Force "$ProjectRoot\dist-server\index.mjs" "$StagedServer\index.mjs"
Copy-Item -Force "$ProjectRoot\server\transcribe.py" "$StagedServer\transcribe.py"

$StagedUi = Join-Path $Stage "ui"
if (Test-Path $StagedUi) { Remove-Item -Recurse -Force $StagedUi }
Copy-Item -Recurse -Force "$ProjectRoot\dist" $StagedUi

# Launcher + helpers
Copy-Item -Force "$PSScriptRoot\launch.vbs" "$Stage\launch.vbs"
Copy-Item -Force "$PSScriptRoot\start.cmd"  "$Stage\start.cmd"
Copy-Item -Force "$PSScriptRoot\stop.cmd"   "$Stage\stop.cmd"

# Ship the bundled version marker so start.cmd can seed/update %LOCALAPPDATA%.
Copy-Item -Force "$ProjectRoot\version.txt" "$Stage\version.txt"

# Config (HF token, if any)
$ConfigDir = Join-Path $Stage "config"
New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
if ($env:HF_TOKEN) {
  Set-Content -Path (Join-Path $ConfigDir "hf_token.txt") -Value $env:HF_TOKEN -NoNewline -Encoding ASCII
  Info "HF token written to config\hf_token.txt"
} else {
  Info "No HF_TOKEN in env; installed app will run without speaker diarization."
}

Step "Done. Staged at: $Stage"
Info "Next: compile the Inno Setup installer:"
Info "  & 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe' '$($ProjectRoot)\installer\installer.iss'"
