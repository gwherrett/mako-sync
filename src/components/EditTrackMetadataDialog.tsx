import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FileAudio, Music } from 'lucide-react';

interface LocalTrack {
  id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  year: number | null;
  bpm: number | null;
  key: string | null;
  bitrate: number | null;
  file_path: string;
  file_size: number | null;
  mix: string | null;
}

interface EditTrackMetadataDialogProps {
  track: LocalTrack | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (trackId: string, updates: Partial<LocalTrack>) => Promise<void>;
}

export function EditTrackMetadataDialog({
  track,
  open,
  onOpenChange,
  onSave,
}: EditTrackMetadataDialogProps) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [genre, setGenre] = useState('');
  const [year, setYear] = useState('');
  const [mix, setMix] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset form when track changes
  useEffect(() => {
    if (track) {
      setTitle(track.title || '');
      setArtist(track.artist || '');
      setAlbum(track.album || '');
      setGenre(track.genre || '');
      setYear(track.year?.toString() || '');
      setMix(track.mix || '');
    }
  }, [track]);

  const handleSave = async () => {
    if (!track) return;

    setSaving(true);
    try {
      await onSave(track.id, {
        title: title.trim() || null,
        artist: artist.trim() || null,
        album: album.trim() || null,
        genre: genre.trim() || null,
        year: year ? parseInt(year, 10) : null,
        mix: mix.trim() || null,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return '—';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const getFilename = (filePath: string) => {
    return filePath.split('/').pop() || filePath;
  };

  const getDirectory = (filePath: string) => {
    const parts = filePath.split('/');
    parts.pop(); // Remove filename
    return parts.join('/');
  };

  if (!track) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Music className="h-5 w-5" />
            Edit Track Metadata
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-1 pt-2">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground bg-muted/50 p-2 rounded-md">
                <FileAudio className="h-4 w-4 shrink-0" />
                <span className="truncate" title={getFilename(track.file_path)}>
                  {getFilename(track.file_path)}
                </span>
              </div>
              <div className="text-xs text-muted-foreground truncate pl-1" title={getDirectory(track.file_path)}>
                {getDirectory(track.file_path)}
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Track title"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="artist">Artist</Label>
            <Input
              id="artist"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              placeholder="Artist name"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="album">Album</Label>
            <Input
              id="album"
              value={album}
              onChange={(e) => setAlbum(e.target.value)}
              placeholder="Album name"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="genre">Genre</Label>
            <Input
              id="genre"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              placeholder="Genre"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="year">Year</Label>
              <Input
                id="year"
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="Year"
                min="1900"
                max="2100"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="mix">Mix/Version</Label>
              <Input
                id="mix"
                value={mix}
                onChange={(e) => setMix(e.target.value)}
                placeholder="e.g., Extended Mix"
              />
            </div>
          </div>

          {/* Read-only metadata */}
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground border-t pt-4 mt-2">
            {track.bpm && (
              <span>BPM: <span className="text-foreground">{track.bpm}</span></span>
            )}
            {track.key && (
              <span>Key: <span className="text-foreground">{track.key}</span></span>
            )}
            {track.bitrate && (
              <span>Bitrate: <span className="text-foreground">{track.bitrate} kbps</span></span>
            )}
            {track.file_size && (
              <span>Size: <span className="text-foreground">{formatFileSize(track.file_size)}</span></span>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
