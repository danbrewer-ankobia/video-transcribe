# Building the Windows Installer

This produces `output\VideoTranscribeSetup.exe` — a single `.exe` you can hand to a non-technical user who double-clicks through a wizard and gets a Start Menu shortcut. No prerequisites on their machine.

## One-time setup on your build machine

1. **Node 18+**, **Python 3.11** (only used during the build to bootstrap things — the installer ships its own portable Python), and **PowerShell 5+** must already be on PATH.
2. **Inno Setup 6** — download and install: <https://jrsoftware.org/isdl.php>. Default location is `C:\Program Files (x86)\Inno Setup 6\`.
3. **Hugging Face token** (only if you want speaker diarization in the shipped app):
   - Accept the terms on these model pages while signed in to HF:
     - <https://huggingface.co/pyannote/segmentation-3.0>
     - <https://huggingface.co/pyannote/speaker-diarization-3.1>
   - Create a read token at <https://huggingface.co/settings/tokens>
   - The build script will pick it up from `$env:HF_TOKEN`.

## Build steps

```powershell
# From the project root:
cd C:\Users\DanBrewer\Desktop\video-transcribe

# (Optional) Bake your HF token into the installer for diarization:
$env:HF_TOKEN = "hf_xxx"

# 1. Stage everything into dist-installer\  (downloads Python, PyTorch, ffmpeg, models — ~3 GB, ~10–30 min first time)
powershell -ExecutionPolicy Bypass -File .\installer\build-installer.ps1

# 2. Compile the .exe:
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" .\installer\installer.iss
```

The compiler prints `Successful compile` and writes `output\VideoTranscribeSetup.exe` (~2–3 GB).

### Flags

```powershell
# Rebuild from scratch:
.\installer\build-installer.ps1 -Force

# Skip pre-downloading Whisper models (smaller installer, but first transcribe downloads ~150 MB):
.\installer\build-installer.ps1 -SkipModels

# Choose which models to pre-bundle (default: tiny,base,small):
.\installer\build-installer.ps1 -Models "base,small"
```

## What the .exe does on the user's machine

1. Installs to `C:\Program Files\Video Transcribe\`
2. Creates a Start Menu shortcut and (optionally) a desktop shortcut
3. Shortcut runs `launch.vbs` → starts a hidden local Node server → opens <http://localhost:3001> in the default browser
4. Uploaded videos and transcripts go in `%LOCALAPPDATA%\VideoTranscribe\uploads\`
5. **Quit** button in the app, or `stop.cmd` in the Start Menu group, cleanly stops the server
6. Standard Windows uninstaller removes everything (uploads in `%LOCALAPPDATA%` stay — those are user data)

## Updating the HF token after install

If your token gets revoked, update it without rebuilding:

```
C:\Program Files\Video Transcribe\config\hf_token.txt
```

Replace the contents with the new token, restart the app. Editing `Program Files` needs admin rights.

## Troubleshooting

- **`pip install torch` fails**: the build script pulls the CPU wheel from PyPI's PyTorch index. If you're on a metered or proxied network, this is the longest download (~200 MB).
- **WhisperX import errors at build time**: usually means PyTorch and torchaudio versions don't match. Delete `.build-cache\` and rerun with `-Force`.
- **Inno Setup says "file not found"**: make sure `dist-installer\` exists and is non-empty before running ISCC — the build script needs to complete first.
- **Installer too big**: pass `-SkipModels` or `-Models "base"` to shrink it. Diarization models are ~600 MB on their own.
