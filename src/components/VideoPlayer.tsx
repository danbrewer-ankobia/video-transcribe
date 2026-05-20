import { forwardRef, useImperativeHandle, useRef } from "react";

export interface VideoPlayerHandle {
  seek: (t: number) => void;
}

interface Props {
  src: string;
  onTimeUpdate?: (t: number) => void;
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(function VideoPlayer(
  { src, onTimeUpdate },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useImperativeHandle(ref, () => ({
    seek: (t: number) => {
      const v = videoRef.current;
      if (!v) return;
      v.currentTime = t;
      v.play().catch(() => {/* ignore autoplay rejections */});
    },
  }));

  return (
    <video
      ref={videoRef}
      src={src}
      controls
      onTimeUpdate={(e) => onTimeUpdate?.((e.target as HTMLVideoElement).currentTime)}
      className="video"
    />
  );
});
