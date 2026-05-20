import { useCallback, useRef, useState } from "react";
import type { UploadResponse } from "../types";

interface Props {
  onUploaded: (res: UploadResponse) => void;
  onStart: () => void;
  onError: (msg: string) => void;
}

export function Uploader({ onUploaded, onStart, onError }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  const upload = useCallback(
    (file: File) => {
      onStart();
      setProgress(0);

      const xhr = new XMLHttpRequest();
      const form = new FormData();
      form.append("video", file);
      xhr.open("POST", "/api/upload");
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
      };
      xhr.onload = () => {
        setProgress(null);
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            onUploaded(JSON.parse(xhr.responseText));
          } catch {
            onError("Bad response from server");
          }
        } else {
          onError(`Upload failed: ${xhr.status} ${xhr.statusText}`);
        }
      };
      xhr.onerror = () => {
        setProgress(null);
        onError("Network error during upload");
      };
      xhr.send(form);
    },
    [onStart, onUploaded, onError],
  );

  const onPick = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    upload(files[0]);
  };

  return (
    <div
      className={`uploader ${dragging ? "dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onPick(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/x-matroska,video/webm,.mp4,.mov,.mkv,.webm,.m4v"
        style={{ display: "none" }}
        onChange={(e) => onPick(e.target.files)}
      />
      {progress === null ? (
        <>
          <div className="uploader-title">Drop an MP4 here</div>
          <div className="uploader-subtitle">or click to choose a file</div>
        </>
      ) : (
        <>
          <div className="uploader-title">Uploading&hellip; {progress}%</div>
          <div className="upload-bar">
            <div className="upload-bar-fill" style={{ width: `${progress}%` }} />
          </div>
        </>
      )}
    </div>
  );
}
