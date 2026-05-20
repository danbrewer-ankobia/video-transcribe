import { useEffect, useRef } from "react";
import type { ProgressEvent } from "../types";

interface Props {
  events: ProgressEvent[];
}

export function ProgressLog({ events }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [events.length]);

  return (
    <div className="progress-log" ref={ref}>
      {events.map((e, i) => {
        if (e.kind === "status") {
          return (
            <div key={i} className="log-status">
              <span className="stage">{e.stage}</span> {e.message}
            </div>
          );
        }
        if (e.kind === "error") {
          return <div key={i} className="log-error">{e.message}</div>;
        }
        if (e.kind === "log") {
          return <div key={i} className="log-line">{e.line}</div>;
        }
        return null;
      })}
      {events.length === 0 && <div className="muted">Waiting for Python to start&hellip;</div>}
    </div>
  );
}
