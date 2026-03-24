import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Music } from 'lucide-react';
import { SUPER_GENRES, type SuperGenre } from '@/types/genreMapping';
import { TrackGenreService } from '@/services/trackGenre.service';

export interface SpotifyTrackForGenreEdit {
  id: string;
  title: string;
  artist: string;
  genre: string | null;
  super_genre: SuperGenre | null;
  super_genre_manual_override: boolean;
}

interface EditSpotifyTrackGenreDialogProps {
  track: SpotifyTrackForGenreEdit | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (trackId: string, superGenre: SuperGenre | null, isOverride: boolean) => void;
}

export function EditSpotifyTrackGenreDialog({
  track,
  open,
  onOpenChange,
  onSaved,
}: EditSpotifyTrackGenreDialogProps) {
  const [selectedGenre, setSelectedGenre] = useState<SuperGenre | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (track) {
      setSelectedGenre(track.super_genre);
    }
  }, [track]);

  const handleSave = async () => {
    if (!track || !selectedGenre) return;
    setSaving(true);
    try {
      await TrackGenreService.assignGenreToTrack(track.id, selectedGenre);
      onSaved(track.id, selectedGenre, true);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const handleResetToAuto = async () => {
    if (!track) return;
    setSaving(true);
    try {
      await TrackGenreService.resetGenreOverride(track.id);
      onSaved(track.id, track.super_genre, false);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  if (!track) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Music className="h-5 w-5" />
            Edit SuperGenre
          </DialogTitle>
          <DialogDescription asChild>
            <div className="pt-2 space-y-0.5">
              <p className="text-sm font-medium text-foreground">{track.title}</p>
              <p className="text-sm text-muted-foreground">{track.artist}</p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {track.genre && (
            <div className="grid gap-1">
              <Label className="text-muted-foreground text-xs">Spotify genres</Label>
              <p className="text-sm">{track.genre}</p>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="super-genre">SuperGenre</Label>
            <Select
              value={selectedGenre ?? ''}
              onValueChange={(v) => setSelectedGenre(v as SuperGenre)}
            >
              <SelectTrigger id="super-genre">
                <SelectValue placeholder="Select a SuperGenre" />
              </SelectTrigger>
              <SelectContent>
                {SUPER_GENRES.map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {track.super_genre_manual_override && (
            <Button
              variant="outline"
              onClick={handleResetToAuto}
              disabled={saving}
              className="mr-auto"
            >
              Reset to auto
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !selectedGenre}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
