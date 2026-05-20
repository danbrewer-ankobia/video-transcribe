import { useCallback, useEffect, useRef, useState } from "react";
import { Uploader } from "./components/Uploader";
import { VideoPlayer, VideoPlayerHandle } from "./components/VideoPlayer";
import { TranscriptView } from "./components/TranscriptView";
import { SearchBar } from "./components/SearchBar";
import { ExportBar } from "./components/ExportBar";
import { ProgressLog } from "./components/ProgressLog";
import { UpdateBanner } from "./components/UpdateBanner";
import { Queue } from "./components/Queue";
import { SettingsPanel } from "./components/Settings";
import type { Job, ProgressEvent, Settings, Transcript, UploadResponse } from "./types";

export function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [updateNonce, setUpdateNonce] = useState(0);
  const [settings, setSettings] = useState<Settings | null>(null);
  const playerRef = useRef<VideoPlayerHandle>(null);
  const esRef = useRef<EventSource | null>(null);

  // Initial settings + jobs fetch.
  useEffect(() => {
    fetch("/api/settings").then(r => r.json()).then(setSettings).catch(() => {});
    refreshJobs();
  }, []);

  // Poll the jobs list when there's pending work.
  useEffect(() => {
    const anyActive = jobs.some(j => j.status === "queued" || j.status === "running");
    if (!anyActive) return;
    const t = setInterval(refreshJobs, 1500);
    return () => clearInterval(t);
  }, [jobs]);

  const refreshJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs");
      const data = (await res.json()) as Job[];
      setJobs(data);
    } catch { /* ignore transient */ }
  }, []);

  // Subscribe to the selected job's event stream.
  useEffect(() => {
    if (!selectedJobId) return;
    setEvents([]);
    setTranscript(null);

    // If the job has a saved transcript, load it via the legacy endpoint.
    const selected = jobs.find(j => j.id === selectedJobId);
    if (selected?.hasResult) {
      fetch(`/api/transcript/${selected.videoId}`)
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then(setTranscript)
        .catch(() => {});
    }

    const es = new EventSource(`/api/jobs/${selectedJobId}/stream`);
    esRef.current = es;
    const push = (e: ProgressEvent) => setEvents(prev => [...prev, e]);

    es.addEventListener("status", (ev) => {
      const d = JSON.parse((ev as MessageEvent).data);
      push({ kind: "status", stage: d.stage, message: d.message });
    });
    es.addEventListener("log",  (ev) => push({ kind: "log",  line: JSON.parse((ev as MessageEvent).data).line }));
    es.addEventListener("result", (ev) => setTranscript(JSON.parse((ev as MessageEvent).data)));
    es.addEventListener("job-update", () => refreshJobs());
    es.addEventListener("done", () => refreshJobs());
    es.addEventListener("autosaved", (ev) => {
      const d = JSON.parse((ev as MessageEvent).data);
      push({ kind: "status", stage: "saved", message: `Auto-saved: ${d.paths.join(", ")}` });
    });

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [selectedJobId, jobs, refreshJobs]);

  const onUploaded = useCallback(async (res: UploadResponse) => {
    setError(null);
    try {
      const r = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: res.id,
          model: settings?.defaultModel,
          diarize: settings?.defaultDiarize,
        }),
      });
      const job = (await r.json()) as Job;
      if (!r.ok) throw new Error((job as any).error ?? `HTTP ${r.status}`);
      setSelectedJobId(job.id);
      refreshJobs();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, [settings, refreshJobs]);

  const cancelJob = useCallback(async (id: string) => {
    try {
      await fetch(`/api/jobs/${id}`, { method: "DELETE" });
      refreshJobs();
    } catch { /* ignore */ }
  }, [refreshJobs]);

  const selectedJob = jobs.find(j => j.id === selectedJobId);
  const videoUrl = selectedJob ? `/api/video/${selectedJob.videoId}` : null;
  const showLog = selectedJob && (selectedJob.status === "running" || selectedJob.status === "queued") && !transcript;

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Video Transcribe</h1>
          <p className="subtitle">Drop a video &rarr; it joins the queue &rarr; transcript appears below when done.</p>
        </div>
        <div className="header-actions">
          <button className="header-button" onClick={() => setShowSettings(true)}>Settings</button>
          <button className="header-button" onClick={() => setUpdateNonce(n => n + 1)}>Check for updates</button>
          <button
            className="quit-button"
            title="Stop the local server and exit"
            onClick={async () => {
              if (!confirm("Quit Video Transcribe?")) return;
              try { await fetch("/api/quit", { method: "POST" }); } catch { /* ignore */ }
              window.close();
            }}
          >Quit</button>
        </div>
      </header>

      <UpdateBanner autoCheck checkNonce={updateNonce} />

      <Uploader
        onUploaded={onUploaded}
        onStart={() => setError(null)}
        onError={(msg) => setError(msg)}
      />

      {error && <div className="error">{error}</div>}

      <div className="layout">
        <aside className="queue-pane">
          <div className="pane-title">Queue</div>
          <Queue
            jobs={jobs}
            selectedId={selectedJobId}
            onSelect={setSelectedJobId}
            onCancel={cancelJob}
          />
        </aside>

        <main className="job-view">
          {!selectedJob && (
            <div className="empty-view muted">
              Pick a job from the queue to see its video and transcript.
            </div>
          )}

          {selectedJob && (
            <>
              <div className="job-header">
                <strong>{selectedJob.videoName}</strong>
                <span className="muted"> &middot; {selectedJob.params.model}{selectedJob.params.diarize ? " &middot; diarized" : ""}</span>
              </div>

              <div className="split">
                {videoUrl && (
                  <div className="player-pane">
                    <VideoPlayer ref={playerRef} src={videoUrl} onTimeUpdate={setCurrentTime} />
                  </div>
                )}

                <div className="transcript-pane">
                  {showLog && <ProgressLog events={events} />}
                  {transcript && (
                    <>
                      <div className="transcript-toolbar">
                        <SearchBar value={query} onChange={setQuery} />
                        <ExportBar transcript={transcript} videoName={selectedJob.videoName} />
                      </div>
                      <TranscriptView
                        transcript={transcript}
                        currentTime={currentTime}
                        query={query}
                        onSeek={(t) => playerRef.current?.seek(t)}
                      />
                    </>
                  )}
                  {!transcript && !showLog && selectedJob.status === "error" && (
                    <div className="error">Failed: {selectedJob.error}</div>
                  )}
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      <SettingsPanel
        open={showSettings}
        onClose={() => {
          setShowSettings(false);
          fetch("/api/settings").then(r => r.json()).then(setSettings).catch(() => {});
        }}
      />
    </div>
  );
}
