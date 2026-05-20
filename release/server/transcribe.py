"""Transcribe a video with WhisperX, emitting JSON progress lines to stdout.

Each line on stdout is a JSON object:
  {"type": "status", "stage": "load_model", "message": "..."}
  {"type": "progress", "stage": "transcribe", "percent": 0..100}
  {"type": "result", "data": {...full transcript...}}

Errors are written to stderr as plain text; the parent process surfaces them.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import traceback


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--model", default="base",
                        help="Whisper model size: tiny, base, small, medium, large-v3")
    parser.add_argument("--language", default=None)
    parser.add_argument("--diarize", action="store_true")
    parser.add_argument("--hf-token", default=None)
    parser.add_argument("--device", default=None, help="cpu or cuda (auto-detected)")
    parser.add_argument("--compute-type", default=None)
    args = parser.parse_args()

    try:
        import whisperx
        import torch
    except ImportError as e:
        sys.stderr.write(
            f"Missing Python deps ({e}). Install with: pip install -r requirements.txt\n"
        )
        return 2

    device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    compute_type = args.compute_type or ("float16" if device == "cuda" else "int8")

    emit({"type": "status", "stage": "load_model",
          "message": f"Loading Whisper '{args.model}' on {device} ({compute_type})"})
    try:
        model = whisperx.load_model(args.model, device, compute_type=compute_type,
                                    language=args.language or None)
    except Exception as e:
        sys.stderr.write(f"Failed to load model: {e}\n{traceback.format_exc()}")
        return 3

    emit({"type": "status", "stage": "load_audio", "message": "Loading audio from video"})
    audio = whisperx.load_audio(args.input)

    emit({"type": "status", "stage": "transcribe", "message": "Transcribing"})
    result = model.transcribe(audio, batch_size=8, language=args.language or None)
    language = result.get("language") or args.language or "en"
    emit({"type": "status", "stage": "transcribe", "message": f"Detected language: {language}"})

    emit({"type": "status", "stage": "align", "message": "Aligning word timestamps"})
    try:
        align_model, metadata = whisperx.load_align_model(language_code=language, device=device)
        result = whisperx.align(result["segments"], align_model, metadata, audio, device,
                                return_char_alignments=False)
        del align_model
    except Exception as e:
        emit({"type": "status", "stage": "align",
              "message": f"Alignment skipped ({e}). Using coarse timestamps."})

    if args.diarize:
        token = args.hf_token or os.environ.get("HF_TOKEN")
        if not token:
            emit({"type": "status", "stage": "diarize",
                  "message": "Skipped: no HF_TOKEN. Set HF_TOKEN and accept pyannote terms to enable."})
        else:
            emit({"type": "status", "stage": "diarize", "message": "Running speaker diarization"})
            try:
                # whisperx <=3.1.x uses DiarizationPipeline; newer renamed it.
                if hasattr(whisperx, "DiarizationPipeline"):
                    diarize_model = whisperx.DiarizationPipeline(use_auth_token=token, device=device)
                else:
                    from whisperx.diarize import DiarizationPipeline
                    diarize_model = DiarizationPipeline(use_auth_token=token, device=device)
                diarize_segments = diarize_model(audio)
                result = whisperx.assign_word_speakers(diarize_segments, result)
            except Exception as e:
                emit({"type": "status", "stage": "diarize",
                      "message": f"Diarization failed: {e}"})

    segments = []
    for seg in result.get("segments", []):
        segments.append({
            "start": float(seg.get("start", 0.0)),
            "end": float(seg.get("end", 0.0)),
            "text": (seg.get("text") or "").strip(),
            "speaker": seg.get("speaker"),
        })

    emit({"type": "result", "data": {
        "language": language,
        "model": args.model,
        "segments": segments,
    }})
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as e:
        sys.stderr.write(f"Unhandled error: {e}\n{traceback.format_exc()}")
        sys.exit(1)
