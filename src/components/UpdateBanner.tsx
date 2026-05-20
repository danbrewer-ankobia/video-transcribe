import { useCallback, useEffect, useState } from "react";

interface UpdateCheck {
  currentVersion: string;
  latestVersion: string | null;
  hasUpdate: boolean;
  kind: "hot" | "full" | null;
  notes: string | null;
  installerUrl: string | null;
  manifestUrl: string;
  error: string | null;
}

type Phase = "idle" | "checking" | "checked" | "installing" | "installed" | "error";

interface Props {
  /** If true, auto-check once on mount. */
  autoCheck?: boolean;
  /** Externally triggered check (increment to re-trigger). */
  checkNonce?: number;
  /** Called when a check completes with the result. */
  onChecked?: (c: UpdateCheck) => void;
}

export function UpdateBanner({ autoCheck = true, checkNonce = 0, onChecked }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const runCheck = useCallback(async () => {
    setPhase("checking");
    setError(null);
    try {
      const res = await fetch("/api/updates/check");
      const data = (await res.json()) as UpdateCheck;
      setCheck(data);
      setPhase("checked");
      setDismissed(false);
      onChecked?.(data);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setPhase("error");
    }
  }, [onChecked]);

  useEffect(() => {
    if (autoCheck) runCheck();
  }, [autoCheck, runCheck]);

  useEffect(() => {
    if (checkNonce > 0) runCheck();
  }, [checkNonce, runCheck]);

  const install = useCallback(async () => {
    if (!check) return;
    if (check.kind === "full") {
      if (check.installerUrl) window.open(check.installerUrl, "_blank");
      return;
    }
    setPhase("installing");
    setError(null);
    try {
      const res = await fetch("/api/updates/install", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPhase("installed");
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setPhase("error");
    }
  }, [check]);

  const restart = useCallback(async () => {
    try {
      await fetch("/api/updates/restart", { method: "POST" });
    } catch {
      /* server may exit before responding */
    }
    // Give the relauncher 3s to spawn the new server, then reload.
    setTimeout(() => window.location.reload(), 3500);
  }, []);

  if (dismissed) return null;
  if (phase === "idle" || phase === "checking") return null;
  if (phase === "checked" && (!check?.hasUpdate || check?.error)) return null;

  return (
    <div className={`update-banner ${phase === "error" ? "error" : ""}`}>
      {phase === "checked" && check?.hasUpdate && (
        <>
          <div className="update-info">
            <strong>Update available: {check.latestVersion}</strong>
            <span className="muted">  (you have {check.currentVersion})</span>
            {check.notes && <div className="update-notes">{check.notes}</div>}
            {check.kind === "full" && (
              <div className="muted">This update needs the full installer.</div>
            )}
          </div>
          <div className="update-actions">
            <button onClick={install} className="primary">
              {check.kind === "full" ? "Download installer" : "Install"}
            </button>
            <button onClick={() => setDismissed(true)}>Later</button>
          </div>
        </>
      )}
      {phase === "installing" && (
        <div className="update-info">Downloading update&hellip;</div>
      )}
      {phase === "installed" && (
        <>
          <div className="update-info">
            <strong>Update downloaded.</strong> Restart to apply.
          </div>
          <div className="update-actions">
            <button onClick={restart} className="primary">Restart now</button>
            <button onClick={() => setDismissed(true)}>Later</button>
          </div>
        </>
      )}
      {phase === "error" && error && (
        <>
          <div className="update-info">Update failed: {error}</div>
          <div className="update-actions">
            <button onClick={() => setDismissed(true)}>Dismiss</button>
          </div>
        </>
      )}
    </div>
  );
}
