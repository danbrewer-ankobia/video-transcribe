import { useEffect, useMemo, useRef } from "react";
import type { Transcript } from "../types";

interface Props {
  transcript: Transcript;
  currentTime: number;
  query: string;
  onSeek: (t: number) => void;
}

function formatTime(t: number): string {
  const total = Math.max(0, Math.floor(t));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function speakerColor(speaker: string | null | undefined): string {
  if (!speaker) return "#888";
  // Hash speaker label to a stable hue.
  let h = 0;
  for (let i = 0; i < speaker.length; i++) h = (h * 31 + speaker.charCodeAt(i)) % 360;
  return `hsl(${h}, 55%, 55%)`;
}

function highlight(text: string, q: string): React.ReactNode {
  if (!q) return text;
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(re);
  return parts.map((part, i) =>
    re.test(part) ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>,
  );
}

export function TranscriptView({ transcript, currentTime, query, onSeek }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  const activeIndex = useMemo(() => {
    for (let i = 0; i < transcript.segments.length; i++) {
      const s = transcript.segments[i];
      if (currentTime >= s.start && currentTime <= s.end) return i;
    }
    return -1;
  }, [transcript.segments, currentTime]);

  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeIndex]);

  const lowerQ = query.toLowerCase();
  const segments = transcript.segments;

  return (
    <div className="transcript" ref={containerRef}>
      {segments.map((seg, i) => {
        const matches = lowerQ ? seg.text.toLowerCase().includes(lowerQ) : true;
        if (!matches) return null;
        const isActive = i === activeIndex;
        return (
          <div
            key={i}
            ref={isActive ? activeRef : undefined}
            className={`segment ${isActive ? "active" : ""}`}
            onClick={() => onSeek(seg.start)}
          >
            <div className="segment-meta">
              <span className="timestamp">{formatTime(seg.start)}</span>
              {seg.speaker && (
                <span
                  className="speaker"
                  style={{ color: speakerColor(seg.speaker) }}
                  title={seg.speaker}
                >
                  {seg.speaker}
                </span>
              )}
            </div>
            <div className="segment-text">{highlight(seg.text, query)}</div>
          </div>
        );
      })}
      {segments.length === 0 && <div className="muted">No segments.</div>}
    </div>
  );
}
