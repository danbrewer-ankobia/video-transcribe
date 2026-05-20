import { useCallback, useEffect, useState } from "react";
import type { Settings } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
}

const ALL_FORMATS: Array<"md" | "srt" | "vtt" | "json"> = ["md", "srt", "vtt", "json"];

export function SettingsPanel({ open, onClose }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerBusy, setPickerBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch("/api/settings").then(r => r.json()).then(setSettings).catch(e => setError(String(e)));
  }, [open]);

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings(prev => prev ? { ...prev, [key]: value } : prev);
  }, []);

  const save = useCallback(async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSettings(data);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }, [settings, onClose]);

  const pickFolder = useCallback(async () => {
    setPickerBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/pick-folder", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.cancelled) return;
      update("outputFolder", data.path);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setPickerBusy(false);
    }
  }, [update]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button onClick={onClose} className="modal-close" title="Close">×</button>
        </div>

        {!settings && <div className="muted">Loading…</div>}

        {settings && (
          <div className="settings-body">
            <section>
              <h3>Output folder</h3>
              <p className="muted">
                When auto-save is on, completed transcripts are written here in the formats you pick below.
              </p>
              <div className="folder-row">
                <input
                  type="text"
                  className="folder-input"
                  placeholder="No folder selected"
                  value={settings.outputFolder ?? ""}
                  onChange={(e) => update("outputFolder", e.target.value || null)}
                />
                <button onClick={pickFolder} disabled={pickerBusy}>
                  {pickerBusy ? "…" : "Browse…"}
                </button>
                {settings.outputFolder && (
                  <button onClick={() => update("outputFolder", null)} title="Clear">Clear</button>
                )}
              </div>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={settings.autoSave}
                  onChange={(e) => update("autoSave", e.target.checked)}
                  disabled={!settings.outputFolder}
                />
                Auto-save each transcript when it finishes
              </label>

              <div className="format-row">
                <span className="muted">Auto-save formats:</span>
                {ALL_FORMATS.map(f => (
                  <label key={f}>
                    <input
                      type="checkbox"
                      checked={settings.autoSaveFormats.includes(f)}
                      onChange={(e) => {
                        const next = new Set(settings.autoSaveFormats);
                        if (e.target.checked) next.add(f); else next.delete(f);
                        update("autoSaveFormats", Array.from(next) as any);
                      }}
                    />
                    {f}
                  </label>
                ))}
              </div>
            </section>

            <section>
              <h3>Default transcription options</h3>
              <p className="muted">Used when a new video is queued.</p>
              <label className="setting-row">
                Model
                <select
                  value={settings.defaultModel}
                  onChange={(e) => update("defaultModel", e.target.value)}
                >
                  <option value="tiny">tiny (fastest)</option>
                  <option value="base">base</option>
                  <option value="small">small</option>
                  <option value="medium">medium</option>
                  <option value="large-v3">large-v3 (best)</option>
                </select>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={settings.defaultDiarize}
                  onChange={(e) => update("defaultDiarize", e.target.checked)}
                />
                Speaker diarization (requires HF token at install time)
              </label>
            </section>
          </div>
        )}

        {error && <div className="error">{error}</div>}

        <div className="modal-footer">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={!settings || saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
