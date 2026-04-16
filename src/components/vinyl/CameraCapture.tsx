import React, { useRef, useState, useCallback } from 'react';
import { Camera, Upload, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { VinylIdentifyResult } from '@/types/discogs';

interface CameraCaptureProps {
  onIdentified: (result: VinylIdentifyResult) => void;
  onError: (error: string) => void;
  onSkip: () => void;
}

const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2MB threshold for compression

async function compressToJpeg(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas unavailable')); return; }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (!blob) { reject(new Error('Compression failed')); return; }
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            // Strip the data URL prefix to get raw base64
            const base64 = dataUrl.split(',')[1];
            resolve({ base64, mimeType: 'image/jpeg' });
          };
          reader.onerror = () => reject(new Error('Failed to read compressed image'));
          reader.readAsDataURL(blob);
        },
        'image/jpeg',
        0.8,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
    img.src = url;
  });
}

async function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  if (file.size > MAX_SIZE_BYTES) {
    return compressToJpeg(file);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      resolve({ base64, mimeType: file.type || 'image/jpeg' });
    };
    reader.onerror = () => reject(new Error('Failed to read image'));
    reader.readAsDataURL(file);
  });
}

export const CameraCapture: React.FC<CameraCaptureProps> = ({ onIdentified, onError, onSkip }) => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [identifying, setIdentifying] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const identify = useCallback(async (file: File) => {
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
      toast({ title: 'Could not identify record', description: msg, variant: 'destructive' });
      onError(msg);
    } finally {
      setIdentifying(false);
    }
  }, [onIdentified, onError, toast]);

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

  return (
    <div className="space-y-4">
      {/* Mobile: camera capture button */}
      <div className="block sm:hidden">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFileChange}
        />
        <Button
          className="w-full h-20 text-base gap-2"
          onClick={() => fileInputRef.current?.click()}
        >
          <Camera className="h-5 w-5" />
          Take photo of A-side label
        </Button>
      </div>

      {/* Desktop: drag-and-drop zone + file picker */}
      <div
        className={`hidden sm:flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 transition-colors cursor-pointer ${
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
