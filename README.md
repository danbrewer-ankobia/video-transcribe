# Video Transcribe

Local web app for transcribing MP4 videos with speaker diarization, built so transcripts can be analyzed in Claude.

- React + Vite + TypeScript UI
- Express server handles uploads, streams progress via SSE
- Python WhisperX does transcription + word-level alignment + speaker diarization
- Synced video player + transcript (click a segment to seek; current segment highlights)
- Search the transcript with live match highlighting
- Copy as Markdown or download as `.md` / `.srt` / `.vtt` / `.json`

## Requirements

- **Node 18+** and npm
- **Python 3.10 or 3.11** (WhisperX has not caught up to 3.12+ yet)
- **ffmpeg** on PATH (`winget install Gyan.FFmpeg` or `choco install ffmpeg`)
- **(Optional) Hugging Face token** for diarization — without one, transcription still works, just no speaker labels.

## Setup

```powershell
# 1. Node deps
npm install

# 2. Python deps (create a venv first if you like)
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### Enable diarization (optional)

1. Make a Hugging Face account: <https://huggingface.co/join>
2. Accept the terms on these two model pages while signed in:
   - <https://huggingface.co/pyannote/segmentation-3.0>
   - <https://huggingface.co/pyannote/speaker-diarization-3.1>
3. Create a read token at <https://huggingface.co/settings/tokens>
4. Set it before running:

```powershell
$env:HF_TOKEN = "hf_xxx"
```

If `HF_TOKEN` is not set, the Diarization step is skipped and segments get no `speaker` label — everything else still works.

## Run

```powershell
npm run dev
```

Open <http://localhost:5173>. The Vite dev server proxies `/api/*` to the Express server on `:3001`.

## How it works

```
Browser  ──upload MP4──>  Express (multer)  ──spawn──>  python server/transcribe.py
                                  │                              │
                                  └──── SSE progress  ◄──── JSON lines on stdout
                                  │
Browser  <── final transcript JSON ──┘   (also cached to uploads/<id>.json)
```

- Uploads land in `uploads/` (gitignored). Delete that folder to clear cached videos and transcripts.
- First run downloads the Whisper model (a few hundred MB for `base`, ~3 GB for `large-v3`). Subsequent runs are fast.
- On CPU, expect roughly 0.5x–1x realtime for `base`, much slower for `large-v3`. A CUDA GPU is dramatically faster.

## Pasting into Claude

Click **Copy MD** in the transcript toolbar. The Markdown groups segments by speaker with timestamps — paste into a Claude conversation and ask whatever analysis question you want.
