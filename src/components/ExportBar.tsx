import type { Transcript, Segment } from "../types";

interface Props {
  transcript: Transcript;
  videoName: string;
}

function pad(n: number, w = 2) {
  return String(n).padStart(w, "0");
}

function formatSRTTime(t: number): string {
  const ms = Math.round((t - Math.floor(t)) * 1000);
  const s = Math.floor(t) % 60;
  const m = Math.floor(t / 60) % 60;
  const h = Math.floor(t / 3600);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function formatVTTTime(t: number): string {
  return formatSRTTime(t).replace(",", ".");
}

function toSRT(segments: Segment[]): string {
  return segments
    .map((s, i) => {
      const speaker = s.speaker ? `[${s.speaker}] ` : "";
      return `${i + 1}\n${formatSRTTime(s.start)} --> ${formatSRTTime(s.end)}\n${speaker}${s.text}\n`;
    })
    .join("\n");
}

function toVTT(segments: Segment[]): string {
  return (
    "WEBVTT\n\n" +
    segments
      .map((s) => {
        const speaker = s.speaker ? `[${s.speaker}] ` : "";
        return `${formatVTTTime(s.start)} --> ${formatVTTTime(s.end)}\n${speaker}${s.text}\n`;
      })
      .join("\n")
  );
}

function toMarkdown(t: Transcript, name: string): string {
  const lines: string[] = [`# Transcript: ${name}`, "", `_Language: ${t.language} | Model: ${t.model}_`, ""];
  let lastSpeaker: string | null | undefined = undefined;
  for (const s of t.segments) {
    if (s.speaker !== lastSpeaker) {
      lines.push("", `**${s.speaker ?? "Speaker"}**`, "");
      lastSpeaker = s.speaker;
    }
    const time = formatVTTTime(s.start).slice(0, 8);
    lines.push(`- [${time}] ${s.text}`);
  }
  return lines.join("\n");
}

function toPlainText(t: Transcript): string {
  let last: string | null | undefined = undefined;
  const out: string[] = [];
  for (const s of t.segments) {
    if (s.speaker && s.speaker !== last) {
      out.push("", `${s.speaker}:`);
      last = s.speaker;
    }
    out.push(s.text);
  }
  return out.join(" ").replace(/\s+\n\s+/g, "\n").trim();
}

function download(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportBar({ transcript, videoName }: Props) {
  const base = videoName.replace(/\.[^.]+$/, "");
  const md = toMarkdown(transcript, videoName);

  return (
    <div className="export-bar">
      <button onClick={() => navigator.clipboard.writeText(md)} title="Copy as Markdown for pasting into Claude">
        Copy MD
      </button>
      <button onClick={() => navigator.clipboard.writeText(toPlainText(transcript))} title="Copy plain text">
        Copy text
      </button>
      <button onClick={() => download(`${base}.md`, md, "text/markdown")}>Download .md</button>
      <button onClick={() => download(`${base}.srt`, toSRT(transcript.segments), "text/plain")}>
        .srt
      </button>
      <button onClick={() => download(`${base}.vtt`, toVTT(transcript.segments), "text/vtt")}>
        .vtt
      </button>
      <button
        onClick={() =>
          download(`${base}.json`, JSON.stringify(transcript, null, 2), "application/json")
        }
      >
        .json
      </button>
    </div>
  );
}
