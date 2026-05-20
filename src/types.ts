export interface Segment {
  start: number;
  end: number;
  text: string;
  speaker?: string | null;
}

export interface Transcript {
  language: string;
  model: string;
  segments: Segment[];
}

export interface UploadResponse {
  id: string;
  filename: string;
  originalName: string;
  size: number;
}

export type ProgressEvent =
  | { kind: "status"; stage: string; message: string }
  | { kind: "log"; line: string }
  | { kind: "error"; message: string }
  | { kind: "result"; data: Transcript }
  | { kind: "done" };

export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";

export interface Job {
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
  hasResult: boolean;
}

export interface Settings {
  outputFolder: string | null;
  autoSave: boolean;
  autoSaveFormats: ("md" | "srt" | "vtt" | "json")[];
  defaultModel: string;
  defaultDiarize: boolean;
}
