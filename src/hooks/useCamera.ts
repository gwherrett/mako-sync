import { useRef, useState, useEffect, useCallback } from 'react';

export type CameraState = 'idle' | 'starting' | 'active' | 'error';
export type CameraError =
  | { code: 'PERMISSION_DENIED' }
  | { code: 'NOT_FOUND' }
  | { code: 'NOT_READABLE' }
  | { code: 'NOT_SUPPORTED' }
  | { code: 'UNKNOWN'; message: string };

export interface UseCameraReturn {
  videoRef: React.RefObject<HTMLVideoElement>;
  state: CameraState;
  error: CameraError | null;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  captureFrame: () => Blob | null;
}

export function getVideoConstraints(userAgent: string): MediaStreamConstraints {
  const isMobile = /Mobi|Android/i.test(userAgent);
  const resolution = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  return { video: isMobile ? { facingMode: 'environment', ...resolution } : resolution };
}

export function domExceptionToError(e: unknown): CameraError {
  if (e instanceof DOMException) {
    if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
      return { code: 'PERMISSION_DENIED' };
    }
    if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
      return { code: 'NOT_FOUND' };
    }
    if (e.name === 'NotReadableError' || e.name === 'TrackStartError') {
      return { code: 'NOT_READABLE' };
    }
    return { code: 'UNKNOWN', message: e.message };
  }
  return { code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) };
}

export function useCamera(): UseCameraReturn {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>('idle');
  const [error, setError] = useState<CameraError | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setState('idle');
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices) {
      setError({ code: 'NOT_SUPPORTED' });
      setState('error');
      return;
    }

    setState('starting');
    setError(null);

    const constraints = getVideoConstraints(navigator.userAgent);

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      // videoRef.current is null here because the video element only renders in
      // the 'active' branch — srcObject is wired in the effect below instead.
      setState('active');
    } catch (e) {
      const cameraError = domExceptionToError(e);
      setError(cameraError);
      setState('error');
    }
  }, []);

  // Wire the stream to the video element once it exists in the DOM.
  useEffect(() => {
    if (state === 'active' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [state]);

  const captureFrame = useCallback((): Blob | null => {
    if (state !== 'active' || !videoRef.current) return null;

    const video = videoRef.current;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;

    const size = Math.min(w, h);
    const sx = (w - size) / 2;
    const sy = (h - size) / 2;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);

    // toDataURL is synchronous; convert to Blob to match the expected return type
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    const [header, base64] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }, [state]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  return { videoRef, state, error, startCamera, stopCamera, captureFrame };
}
