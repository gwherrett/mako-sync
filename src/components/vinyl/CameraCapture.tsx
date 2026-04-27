import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Camera, Upload, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useCamera } from '@/hooks/useCamera';
import { fileToBase64 } from './cameraCaptureUtils';
import type { VinylIdentifyResult } from '@/types/discogs';

interface CameraCaptureProps {
  onIdentified: (result: VinylIdentifyResult) => void;
  onError: (error: string) => void;
  onSkip: () => void;
}

const CAMERA_ERROR_MESSAGES: Record<string, string> = {
  PERMISSION_DENIED: 'Camera access was denied. Please allow camera access in your browser settings.',
  NOT_FOUND: 'No camera detected on this device.',
  NOT_READABLE: 'Camera is in use by another app.',
};

export const CameraCapture: React.FC<CameraCaptureProps> = ({ onIdentified, onError, onSkip }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [identifying, setIdentifying] = useState(false);
  const [identifyError, setIdentifyError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const { videoRef, state: cameraState, error: cameraError, startCamera, stopCamera, captureFrame } = useCamera();

  useEffect(() => {
    startCamera();
  }, [startCamera]);

  const identify = useCallback(async (file: File) => {
    stopCamera();
    setIdentifyError(null);
    setIdentifying(true);
    try {
      const { base64, mimeType } = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke('vinyl-image-identify', {
        body: { image_base64: base64, mime_type: mimeType },
      });
      if (error) throw new Error(error.message);
      onIdentified(data as VinylIdentifyResult);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Identification failed';
      setIdentifyError(msg);
    } finally {
      setIdentifying(false);
    }
  }, [onIdentified, stopCamera]);

  const handleTakePhoto = () => {
    const blob = captureFrame();
    if (!blob) return;
    identify(new File([blob], 'capture.jpg', { type: 'image/jpeg' }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) identify(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) identify(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  if (identifying) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p className="text-sm">Identifying record…</p>
      </div>
    );
  }

  if (identifyError) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-center text-muted-foreground">Could not identify record.</p>
        <p className="text-xs text-center text-destructive">{identifyError}</p>
        <div className="flex justify-center gap-3">
          <Button
            onClick={() => { setIdentifyError(null); startCamera(); }}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Retake photo
          </Button>
          <Button variant="secondary" onClick={onSkip}>
            Enter manually
          </Button>
        </div>
      </div>
    );
  }

  if (cameraState === 'starting') {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p className="text-sm">Starting camera…</p>
      </div>
    );
  }

  if (cameraState === 'active') {
    return (
      <div className="flex flex-col items-center gap-4">
        {/* Square viewfinder capped at min(100vw, 480px) */}
        <div
          className="relative rounded-lg overflow-hidden bg-black w-full"
          style={{ maxWidth: 'min(100vw, 480px)', aspectRatio: '1 / 1' }}
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          {/* Circular guide to help centre the label */}
          <div
            className="absolute inset-4 rounded-full border-2 border-white/50 pointer-events-none"
            style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)' }}
          />
        </div>

        <div className="flex items-center gap-3 w-full" style={{ maxWidth: 'min(100vw, 480px)' }}>
          <Button onClick={handleTakePhoto} className="gap-2 flex-1">
            <Camera className="h-4 w-4" />
            Take Photo
          </Button>
          <Button variant="secondary" onClick={() => { stopCamera(); onSkip(); }}>
            Cancel
          </Button>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground gap-1"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-3 w-3" />
          Upload instead
        </Button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
    );
  }

  if (cameraState === 'error' && cameraError?.code !== 'NOT_SUPPORTED') {
    const message = cameraError
      ? (CAMERA_ERROR_MESSAGES[cameraError.code] ?? 'Camera unavailable.')
      : 'Camera unavailable.';
    return (
      <div className="space-y-4">
        <p className="text-sm text-center text-muted-foreground">{message}</p>
        <div className="flex justify-center">
          <Button onClick={() => fileInputRef.current?.click()} className="gap-2">
            <Upload className="h-4 w-4" />
            Upload photo instead
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFileChange}
        />
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onSkip}>
            Add manually instead
          </Button>
        </div>
      </div>
    );
  }

  // NOT_SUPPORTED or idle: drag-and-drop / file picker UI
  return (
    <div className="space-y-4">
      <div
        className={`flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 transition-colors cursor-pointer ${
          dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50'
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
      >
        <Upload className="h-8 w-8 text-muted-foreground" />
        <div className="text-center">
          <p className="text-sm font-medium">Drop a photo of the A-side label here</p>
          <p className="text-xs text-muted-foreground mt-1">or click to browse — JPEG, PNG, WebP up to 5 MB</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Point at the paper label at the centre of the record for best results.
      </p>

      <div className="flex justify-center">
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onSkip}>
          Add manually instead
        </Button>
      </div>
    </div>
  );
};

export default CameraCapture;
