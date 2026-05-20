import type { Job, JobStatus } from "../types";

interface Props {
  jobs: Job[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCancel: (id: string) => void;
}

function badge(status: JobStatus): { label: string; color: string } {
  switch (status) {
    case "queued":    return { label: "queued",    color: "#8a92a5" };
    case "running":   return { label: "running",   color: "#6aa6ff" };
    case "done":      return { label: "done",      color: "#86efac" };
    case "error":     return { label: "error",     color: "#fca5a5" };
    case "cancelled": return { label: "cancelled", color: "#8a92a5" };
  }
}

function elapsed(j: Job): string {
  const end = j.finishedAt ?? Date.now();
  const start = j.startedAt ?? j.createdAt;
  const s = Math.max(0, Math.round((end - start) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m${r > 0 ? ` ${r}s` : ""}`;
}

export function Queue({ jobs, selectedId, onSelect, onCancel }: Props) {
  if (jobs.length === 0) {
    return <div className="queue-empty muted">No jobs yet. Drop a video to start.</div>;
  }
  return (
    <div className="queue">
      {jobs.map((j) => {
        const b = badge(j.status);
        const isSelected = j.id === selectedId;
        const active = j.status === "running" || j.status === "queued";
        return (
          <div
            key={j.id}
            className={`queue-item ${isSelected ? "selected" : ""}`}
            onClick={() => onSelect(j.id)}
          >
            <div className="queue-item-main">
              <div className="queue-item-name" title={j.videoName}>{j.videoName}</div>
              <div className="queue-item-meta">
                <span className="queue-badge" style={{ color: b.color, borderColor: b.color }}>{b.label}</span>
                {j.status === "running" && j.stage && <span className="muted">{j.stage}</span>}
                <span className="muted">{elapsed(j)}</span>
              </div>
            </div>
            {active && (
              <button
                className="cancel-btn"
                onClick={(e) => { e.stopPropagation(); onCancel(j.id); }}
                title="Cancel this job"
              >×</button>
            )}
          </div>
        );
      })}
    </div>
  );
}
