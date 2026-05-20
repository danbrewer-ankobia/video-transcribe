import express, { Request, Response } from "express";
import cors from "cors";
import multer from "multer";
import { spawn, ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, existsSync, createReadStream, statSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Update channel config. These get bundled into server/index.mjs; future
// hot-updates can replace this file to change them.
// ---------------------------------------------------------------------------
const UPDATE_REPO_OWNER  = process.env.UPDATE_REPO_OWNER  ?? "danbrewer-ankobia";
const UPDATE_REPO_NAME   = process.env.UPDATE_REPO_NAME   ?? "video-transcribe";
const UPDATE_REPO_BRANCH = process.env.UPDATE_REPO_BRANCH ?? "prod";
const MANIFEST_BASE = `https://raw.githubusercontent.com/${UPDATE_REPO_OWNER}/${UPDATE_REPO_NAME}/${UPDATE_REPO_BRANCH}/release`;
const MANIFEST_URL  = `${MANIFEST_BASE}/manifest.json`;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const IS_PROD = process.env.NODE_ENV === "production";

// In a packaged install, APP_ROOT points at the install directory (set by the launcher).
// In dev/build mode, it falls back to the project root.
const APP_ROOT = process.env.APP_ROOT ? path.resolve(process.env.APP_ROOT) : ROOT;
const UPLOADS = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(APP_ROOT, "uploads");
if (!existsSync(UPLOADS)) mkdirSync(UPLOADS, { recursive: true });

const PYTHON_SCRIPT = process.env.TRANSCRIBE_SCRIPT
  ? path.resolve(process.env.TRANSCRIBE_SCRIPT)
  : path.join(ROOT, "server", "transcribe.py");

// User-writable app directory (set by start.cmd to %LOCALAPPDATA%\VideoTranscribe\app).
// Hot updates are written here. Falls back to ROOT in dev.
const USER_APP = process.env.USER_APP ? path.resolve(process.env.USER_APP) : ROOT;

const VERSION_FILE = process.env.VERSION_FILE
  ? path.resolve(process.env.VERSION_FILE)
  : path.join(ROOT, "version.txt");

const SETTINGS_FILE = process.env.SETTINGS_FILE
  ? path.resolve(process.env.SETTINGS_FILE)
  : path.join(ROOT, "settings.json");

interface Settings {
  outputFolder: string | null;
  autoSave: boolean;
  autoSaveFormats: ("md" | "srt" | "vtt" | "json")[];
  defaultModel: string;
  defaultDiarize: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  outputFolder: null,
  autoSave: false,
  autoSaveFormats: ["md", "srt"],
  defaultModel: "base",
  defaultDiarize: true,
};

function loadSettings(): Settings {
  try {
    const raw = readFileSync(SETTINGS_FILE, "utf8");
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(s: Settings): void {
  mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
}

interface Segment {
  start: number;
  end: number;
  text: string;
  speaker?: string | null;
}

interface Transcript {
  language: string;
  model: string;
  segments: Segment[];
}

function pad(n: number, w = 2) { return String(n).padStart(w, "0"); }
function srtTime(t: number): string {
  const ms = Math.round((t - Math.floor(t)) * 1000);
  const s = Math.floor(t) % 60;
  const m = Math.floor(t / 60) % 60;
  const h = Math.floor(t / 3600);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}
function vttTime(t: number): string { return srtTime(t).replace(",", "."); }

function toSRT(segments: Segment[]): string {
  return segments.map((s, i) => {
    const spk = s.speaker ? `[${s.speaker}] ` : "";
    return `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${spk}${s.text}\n`;
  }).join("\n");
}
function toVTT(segments: Segment[]): string {
  return "WEBVTT\n\n" + segments.map((s) => {
    const spk = s.speaker ? `[${s.speaker}] ` : "";
    return `${vttTime(s.start)} --> ${vttTime(s.end)}\n${spk}${s.text}\n`;
  }).join("\n");
}
function toMarkdown(t: Transcript, name: string): string {
  const lines: string[] = [`# Transcript: ${name}`, "", `_Language: ${t.language} | Model: ${t.model}_`, ""];
  let last: string | null | undefined;
  for (const s of t.segments) {
    if (s.speaker !== last) {
      lines.push("", `**${s.speaker ?? "Speaker"}**`, "");
      last = s.speaker;
    }
    lines.push(`- [${vttTime(s.start).slice(0, 8)}] ${s.text}`);
  }
  return lines.join("\n");
}

function safeFileBase(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, "_");
}

function autoSaveTranscript(transcript: Transcript, originalName: string): { written: string[]; error?: string } {
  const s = loadSettings();
  if (!s.autoSave || !s.outputFolder) return { written: [] };
  try {
    mkdirSync(s.outputFolder, { recursive: true });
  } catch (e: any) {
    return { written: [], error: `Could not access output folder: ${e?.message ?? e}` };
  }
  const base = safeFileBase(originalName);
  const written: string[] = [];
  for (const fmt of s.autoSaveFormats) {
    const dest = path.join(s.outputFolder, `${base}.${fmt}`);
    try {
      if (fmt === "md") writeFileSync(dest, toMarkdown(transcript, originalName));
      else if (fmt === "srt") writeFileSync(dest, toSRT(transcript.segments));
      else if (fmt === "vtt") writeFileSync(dest, toVTT(transcript.segments));
      else if (fmt === "json") writeFileSync(dest, JSON.stringify(transcript, null, 2));
      written.push(dest);
    } catch (e: any) {
      console.warn(`[autosave] failed for ${dest}: ${e?.message ?? e}`);
    }
  }
  return { written };
}

function readVersion(): string {
  try {
    return readFileSync(VERSION_FILE, "utf8").trim() || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

interface ManifestFile {
  path: string;       // relative, e.g. "ui/index.html" or "server/index.mjs"
  sha256: string;
  size?: number;
}

interface Manifest {
  version: string;
  kind: "hot" | "full";
  notes?: string;
  released?: string;
  min_hot_from?: string;          // if current < this, force full installer
  installer_url?: string;         // for kind:"full" or fallback
  files?: ManifestFile[];
}

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

async function fetchManifest(): Promise<Manifest> {
  const res = await fetch(MANIFEST_URL, { headers: { "User-Agent": "VideoTranscribe-Updater" } });
  if (!res.ok) throw new Error(`Manifest HTTP ${res.status}`);
  return (await res.json()) as Manifest;
}

async function checkForUpdate(): Promise<UpdateCheck> {
  const currentVersion = readVersion();
  const base: UpdateCheck = {
    currentVersion,
    latestVersion: null,
    hasUpdate: false,
    kind: null,
    notes: null,
    installerUrl: null,
    manifestUrl: MANIFEST_URL,
    error: null,
  };
  if (!UPDATE_REPO_OWNER || UPDATE_REPO_OWNER === "REPLACE_ME_OWNER") {
    base.error = "Update channel not configured.";
    return base;
  }
  try {
    const m = await fetchManifest();
    const newer = cmpVersion(m.version, currentVersion) > 0;
    let kind = m.kind;
    if (kind === "hot" && m.min_hot_from && cmpVersion(currentVersion, m.min_hot_from) < 0) {
      kind = "full";
    }
    return {
      ...base,
      latestVersion: m.version,
      hasUpdate: newer,
      kind: newer ? kind : null,
      notes: m.notes ?? null,
      installerUrl: m.installer_url ?? null,
    };
  } catch (e: any) {
    base.error = e?.message ?? String(e);
    return base;
  }
}

function sanitizeRelPath(rel: string): string {
  const norm = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (norm.includes("..")) throw new Error(`Invalid path: ${rel}`);
  if (!/^(ui|server)\//.test(norm)) throw new Error(`Path must start with ui/ or server/: ${rel}`);
  return norm;
}

async function downloadAndStage(file: ManifestFile, stagingDir: string): Promise<string> {
  const rel = sanitizeRelPath(file.path);
  const url = `${MANIFEST_BASE}/${rel}`;
  const res = await fetch(url, { headers: { "User-Agent": "VideoTranscribe-Updater" } });
  if (!res.ok) throw new Error(`Download ${rel}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = createHash("sha256").update(buf).digest("hex");
  if (got !== file.sha256.toLowerCase()) {
    throw new Error(`Hash mismatch for ${rel} (expected ${file.sha256}, got ${got})`);
  }
  const stagePath = path.join(stagingDir, rel);
  mkdirSync(path.dirname(stagePath), { recursive: true });
  writeFileSync(stagePath, buf);
  return rel;
}

async function applyUpdate(manifest: Manifest): Promise<{ applied: string[]; restartNeeded: boolean }> {
  if (!manifest.files || manifest.files.length === 0) {
    throw new Error("Manifest has no files to install");
  }
  const stagingDir = path.join(USER_APP, "staging", `v${manifest.version}-${Date.now()}`);
  mkdirSync(stagingDir, { recursive: true });

  // 1. Download + verify everything to staging first.
  const downloaded: string[] = [];
  for (const f of manifest.files) {
    const rel = await downloadAndStage(f, stagingDir);
    downloaded.push(rel);
  }
  // 2. Move each into place as <name>.new — start.cmd swaps these on next launch.
  for (const rel of downloaded) {
    const src = path.join(stagingDir, rel);
    const dest = path.join(USER_APP, rel) + ".new";
    mkdirSync(path.dirname(dest), { recursive: true });
    renameSync(src, dest);
  }
  // 3. Stage new version.txt too.
  writeFileSync(path.join(USER_APP, "version.txt.new"), manifest.version + "\n");
  return { applied: downloaded, restartNeeded: true };
}

function spawnRelaunch(): void {
  const launchVbs = process.env.APP_ROOT ? path.join(process.env.APP_ROOT, "launch.vbs") : null;
  if (!launchVbs || !existsSync(launchVbs)) {
    console.warn("[updater] launch.vbs not found; restart-on-exit skipped");
    return;
  }
  const cmd = `Start-Sleep -Seconds 2; & '${launchVbs.replace(/'/g, "''")}'`;
  spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", cmd], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
}

const app = express();
app.use(cors());
app.use(express.json());

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS),
  filename: (_req, file, cb) => {
    const id = randomUUID();
    const ext = path.extname(file.originalname) || ".mp4";
    cb(null, `${id}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 * 1024 },
});

app.post("/api/upload", upload.single("video"), (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const id = path.basename(req.file.filename, path.extname(req.file.filename));
  writeFileSync(
    path.join(UPLOADS, `${id}.meta.json`),
    JSON.stringify({
      id,
      originalName: req.file.originalname,
      size: req.file.size,
      uploadedAt: new Date().toISOString(),
    }, null, 2),
  );
  res.json({
    id,
    filename: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size,
  });
});

function readMeta(id: string): { originalName: string } {
  try {
    const m = JSON.parse(readFileSync(path.join(UPLOADS, `${id}.meta.json`), "utf8"));
    return { originalName: m.originalName ?? id };
  } catch {
    return { originalName: id };
  }
}

app.get("/api/video/:id", (req: Request, res: Response) => {
  const id = req.params.id;
  const files = ["mp4", "mov", "mkv", "webm", "m4v"].map((ext) => path.join(UPLOADS, `${id}.${ext}`));
  const file = files.find((f) => existsSync(f));
  if (!file) return res.status(404).send("Not found");

  const stat = statSync(file);
  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, {
      "Content-Length": stat.size,
      "Content-Type": "video/mp4",
    });
    return createReadStream(file).pipe(res);
  }
  const parts = range.replace(/bytes=/, "").split("-");
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
  const chunk = end - start + 1;
  res.writeHead(206, {
    "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    "Accept-Ranges": "bytes",
    "Content-Length": chunk,
    "Content-Type": "video/mp4",
  });
  createReadStream(file, { start, end }).pipe(res);
});

app.get("/api/transcript/:id", (req: Request, res: Response) => {
  const file = path.join(UPLOADS, `${req.params.id}.json`);
  if (!existsSync(file)) return res.status(404).json({ error: "Not transcribed yet" });
  res.type("application/json").send(readFileSync(file, "utf8"));
});

// ---------------------------------------------------------------------------
// Job queue (single-worker, in-memory).
// ---------------------------------------------------------------------------
type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";

interface JobEvent {
  type: string;
  data: any;
  ts: number;
}

interface Job {
  id: string;
  videoId: string;
  videoName: string;
  params: { model: string; language?: string; diarize: boolean };
  status: JobStatus;
  stage?: string;
  message?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  result?: Transcript;
  events: JobEvent[];
}

const jobs: Map<string, Job> = new Map();
const subscribers: Map<string, Set<Response>> = new Map();
let activeProcess: ChildProcess | null = null;
let activeJobId: string | null = null;

function broadcast(jobId: string, type: string, data: any) {
  const ev: JobEvent = { type, data, ts: Date.now() };
  const job = jobs.get(jobId);
  if (job) job.events.push(ev);
  const subs = subscribers.get(jobId);
  if (!subs) return;
  for (const res of subs) {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

function findVideoPath(videoId: string): string | null {
  const exts = ["mp4", "mov", "mkv", "webm", "m4v"];
  return exts.map((e) => path.join(UPLOADS, `${videoId}.${e}`)).find((p) => existsSync(p)) ?? null;
}

function jobToWire(j: Job) {
  // Don't ship the full events list with every GET — too big for big jobs.
  return {
    id: j.id, videoId: j.videoId, videoName: j.videoName, params: j.params,
    status: j.status, stage: j.stage, message: j.message,
    createdAt: j.createdAt, startedAt: j.startedAt, finishedAt: j.finishedAt,
    error: j.error,
    hasResult: !!j.result,
  };
}

async function runJob(job: Job): Promise<void> {
  const videoPath = findVideoPath(job.videoId);
  if (!videoPath) {
    job.status = "error";
    job.error = "Video file not found";
    job.finishedAt = Date.now();
    broadcast(job.id, "error", { message: job.error });
    broadcast(job.id, "done", { status: "error" });
    return;
  }

  job.status = "running";
  job.startedAt = Date.now();
  broadcast(job.id, "status", { stage: "starting", message: "Job started" });
  broadcast(job.id, "job-update", jobToWire(job));

  const pyArgs = [PYTHON_SCRIPT, "--input", videoPath, "--model", job.params.model];
  if (job.params.language) pyArgs.push("--language", job.params.language);
  if (job.params.diarize) pyArgs.push("--diarize");
  if (process.env.HF_TOKEN) pyArgs.push("--hf-token", process.env.HF_TOKEN);

  const pythonCmd = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
  const py = spawn(pythonCmd, pyArgs, { cwd: ROOT });
  activeProcess = py;

  let stdoutBuf = "";
  let stderrTail = "";

  py.stdout.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString();
    let nl: number;
    while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
      const line = stdoutBuf.slice(0, nl).trim();
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === "result") {
          writeFileSync(path.join(UPLOADS, `${job.videoId}.json`), JSON.stringify(msg.data, null, 2));
          const auto = autoSaveTranscript(msg.data as Transcript, job.videoName);
          job.result = msg.data;
          broadcast(job.id, "result", msg.data);
          if (auto.written.length > 0) broadcast(job.id, "autosaved", { paths: auto.written });
          else if (auto.error) broadcast(job.id, "autosave_error", { message: auto.error });
        } else {
          if (msg.stage) job.stage = msg.stage;
          if (msg.message) job.message = msg.message;
          broadcast(job.id, msg.type || "progress", msg);
        }
      } catch {
        broadcast(job.id, "log", { line });
      }
    }
  });

  py.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stderrTail = (stderrTail + text).slice(-2000);
    text.split(/\r?\n/).forEach((line) => {
      if (line.trim()) broadcast(job.id, "log", { line });
    });
  });

  await new Promise<void>((resolve) => {
    py.on("error", (err) => {
      job.status = "error";
      job.error = `Failed to start Python: ${err.message}`;
      broadcast(job.id, "error", { message: job.error });
      resolve();
    });
    py.on("close", (code) => {
      job.finishedAt = Date.now();
      if (job.status === "cancelled") {
        broadcast(job.id, "done", { status: "cancelled" });
      } else if (code !== 0) {
        job.status = "error";
        job.error = `Python exited with code ${code}`;
        broadcast(job.id, "error", { message: job.error, stderr: stderrTail });
        broadcast(job.id, "done", { status: "error" });
      } else {
        job.status = "done";
        broadcast(job.id, "done", { status: "done" });
      }
      broadcast(job.id, "job-update", jobToWire(job));
      resolve();
    });
  });

  activeProcess = null;
  activeJobId = null;
}

async function processNext(): Promise<void> {
  if (activeJobId) return;
  const next = Array.from(jobs.values()).find((j) => j.status === "queued");
  if (!next) return;
  activeJobId = next.id;
  try {
    await runJob(next);
  } catch (e: any) {
    next.status = "error";
    next.error = e?.message ?? String(e);
    next.finishedAt = Date.now();
    broadcast(next.id, "error", { message: next.error });
  }
  setImmediate(processNext);
}

app.get("/api/jobs", (_req: Request, res: Response) => {
  res.json(Array.from(jobs.values()).map(jobToWire).sort((a, b) => b.createdAt - a.createdAt));
});

app.post("/api/jobs", (req: Request, res: Response) => {
  const { videoId, model, language, diarize } = req.body ?? {};
  if (!videoId) return res.status(400).json({ error: "videoId required" });
  if (!findVideoPath(videoId)) return res.status(404).json({ error: "Video not found" });

  const settings = loadSettings();
  const job: Job = {
    id: randomUUID(),
    videoId,
    videoName: readMeta(videoId).originalName,
    params: {
      model: model || settings.defaultModel,
      language: language || undefined,
      diarize: diarize ?? settings.defaultDiarize,
    },
    status: "queued",
    createdAt: Date.now(),
    events: [],
  };
  jobs.set(job.id, job);
  res.json(jobToWire(job));
  setImmediate(processNext);
});

app.get("/api/jobs/:id", (req: Request, res: Response) => {
  const j = jobs.get(req.params.id);
  if (!j) return res.status(404).json({ error: "Job not found" });
  res.json(jobToWire(j));
});

app.delete("/api/jobs/:id", (req: Request, res: Response) => {
  const j = jobs.get(req.params.id);
  if (!j) return res.status(404).json({ error: "Job not found" });
  if (j.status === "queued") {
    j.status = "cancelled";
    j.finishedAt = Date.now();
    broadcast(j.id, "done", { status: "cancelled" });
  } else if (j.status === "running" && activeProcess) {
    j.status = "cancelled";
    try { activeProcess.kill(); } catch { /* ignore */ }
  }
  res.json(jobToWire(j));
});

app.get("/api/jobs/:id/stream", (req: Request, res: Response) => {
  const j = jobs.get(req.params.id);
  if (!j) return res.status(404).end();
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");
  // Replay buffered events so late subscribers catch up.
  for (const ev of j.events) {
    res.write(`event: ${ev.type}\n`);
    res.write(`data: ${JSON.stringify(ev.data)}\n\n`);
  }
  if (!subscribers.has(j.id)) subscribers.set(j.id, new Set());
  subscribers.get(j.id)!.add(res);
  req.on("close", () => {
    subscribers.get(j.id)?.delete(res);
  });
});

app.post("/api/quit", (_req: Request, res: Response) => {
  res.json({ ok: true });
  setTimeout(() => {
    console.log("[server] /api/quit received, shutting down");
    process.exit(0);
  }, 100);
});

app.get("/api/version", (_req: Request, res: Response) => {
  res.json({
    version: readVersion(),
    channel: { owner: UPDATE_REPO_OWNER, repo: UPDATE_REPO_NAME, branch: UPDATE_REPO_BRANCH },
  });
});

app.get("/api/settings", (_req: Request, res: Response) => {
  res.json(loadSettings());
});

app.put("/api/settings", (req: Request, res: Response) => {
  const incoming = req.body as Partial<Settings>;
  const merged: Settings = { ...loadSettings(), ...incoming };
  if (merged.outputFolder) {
    if (!existsSync(merged.outputFolder)) {
      try { mkdirSync(merged.outputFolder, { recursive: true }); }
      catch (e: any) { return res.status(400).json({ error: `Cannot create output folder: ${e?.message ?? e}` }); }
    }
  }
  saveSettings(merged);
  res.json(merged);
});

app.post("/api/settings/pick-folder", (_req: Request, res: Response) => {
  if (process.platform !== "win32") {
    return res.status(501).json({ error: "Folder picker only implemented on Windows" });
  }
  const ps = `
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = 'Select a folder for transcript output'
$dlg.ShowNewFolderButton = $true
$result = $dlg.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dlg.SelectedPath }
`;
  const child = spawn("powershell.exe", ["-NoProfile", "-STA", "-Command", ps], { windowsHide: true });
  let out = "";
  let err = "";
  child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
  child.stderr.on("data", (d: Buffer) => { err += d.toString(); });
  child.on("close", (code) => {
    if (code !== 0) return res.status(500).json({ error: err || `picker exited ${code}` });
    const picked = out.trim();
    if (!picked) return res.json({ path: null, cancelled: true });
    res.json({ path: picked, cancelled: false });
  });
  child.on("error", (e) => res.status(500).json({ error: e.message }));
});

app.get("/api/updates/check", async (_req: Request, res: Response) => {
  const result = await checkForUpdate();
  res.json(result);
});

app.post("/api/updates/install", async (_req: Request, res: Response) => {
  try {
    const m = await fetchManifest();
    if (cmpVersion(m.version, readVersion()) <= 0) {
      return res.status(409).json({ error: "No newer version" });
    }
    if (m.kind === "full") {
      return res.status(409).json({
        error: "This update requires the full installer",
        installerUrl: m.installer_url ?? null,
      });
    }
    const result = await applyUpdate(m);
    res.json({ ok: true, version: m.version, ...result });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

app.post("/api/updates/restart", (_req: Request, res: Response) => {
  res.json({ ok: true });
  spawnRelaunch();
  setTimeout(() => {
    console.log("[server] /api/updates/restart received, exiting for relaunch");
    process.exit(0);
  }, 200);
});

if (IS_PROD) {
  // Serve the built Vite UI. STATIC_DIR is set by the installer launcher; fallback to ./dist.
  const STATIC_DIR = process.env.STATIC_DIR
    ? path.resolve(process.env.STATIC_DIR)
    : path.join(ROOT, "dist");
  if (existsSync(STATIC_DIR)) {
    app.use(express.static(STATIC_DIR));
    app.get(/^(?!\/api\/).*/, (_req: Request, res: Response) => {
      res.sendFile(path.join(STATIC_DIR, "index.html"));
    });
  } else {
    console.warn(`[server] STATIC_DIR not found at ${STATIC_DIR}; UI will 404`);
  }
}

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`[server] listening on ${url}`);
  if (IS_PROD && process.env.OPEN_BROWSER !== "0") {
    const opener = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
    spawn(opener, [url], { shell: true, detached: true, stdio: "ignore" }).unref();
  }
});
