import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DiscogsReleaseSelector } from './DiscogsReleaseSelector';
import { usePhysicalMedia } from '@/hooks/usePhysicalMedia';
import type { DiscogsRelease, NewPhysicalMedia } from '@/types/discogs';

interface AddVinylDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = 1 | 2 | 3;

interface FormData {
  artist: string;
  title: string;
  label: string;
  catalogue_number: string;
  year: string;
  country: string;
  pressing: string;
  condition: string;
  format: string;
  format_details: string;
  notes: string;
}

const EMPTY_FORM: FormData = {
  artist: '',
  title: '',
  label: '',
  catalogue_number: '',
  year: '',
  country: '',
  pressing: '',
  condition: '',
  format: '',
  format_details: '',
  notes: '',
};

const STEP_LABELS: Record<Step, string> = {
  1: 'Record details',
  2: 'Find on Discogs',
  3: 'Saving…',
};

export const AddVinylDialog: React.FC<AddVinylDialogProps> = ({ open, onOpenChange }) => {
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [discogsRelease, setDiscogsRelease] = useState<DiscogsRelease | null>(null);
  const { addRecord, isAdding } = usePhysicalMedia();

  const set = (field: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }));
  const setSelect = (field: keyof FormData) => (value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const handleClose = () => {
    onOpenChange(false);
    // Reset after animation
    setTimeout(() => {
      setStep(1);
      setForm(EMPTY_FORM);
      setDiscogsRelease(null);
    }, 200);
  };

  const handleDiscogsSelect = async (release: DiscogsRelease) => {
    setDiscogsRelease(release);
    await saveRecord(release);
  };

  const handleDiscogsSkip = async () => {
    await saveRecord(null);
  };

  const saveRecord = async (release: DiscogsRelease | null) => {
    setStep(3);
    try {
      const record: NewPhysicalMedia = {
        artist: form.artist,
        title: form.title,
        label: form.label || null,
        catalogue_number: form.catalogue_number || null,
        year: form.year ? parseInt(form.year, 10) : null,
        country: form.country || null,
        pressing: (form.pressing as NewPhysicalMedia['pressing']) || null,
        condition: (form.condition as NewPhysicalMedia['condition']) || null,
        format: (form.format as NewPhysicalMedia['format']) || null,
        format_details: form.format_details || null,
        notes: form.notes || null,
        discogs_release_id: release?.id ?? null,
        discogs_master_id: release?.master_id ?? null,
        cover_image_url: release?.images?.[0]?.uri ?? null,
        tracklist: release?.tracklist ?? null,
        genres: release?.genres ?? null,
        styles: release?.styles ?? null,
      };
      await addRecord(record);
      handleClose();
    } catch {
      // addRecord already shows a toast on error; step back to form
      setStep(1);
    }
  };

  const canAdvance = form.artist.trim() && form.title.trim();

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Add vinyl record
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              Step {step} of 2 — {STEP_LABELS[step === 3 ? 3 : step]}
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Step 1 — Record details */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Artist *</Label>
                  <Input value={form.artist} onChange={set('artist')} placeholder="e.g. Orbital" />
                </div>
                <div className="space-y-1">
                  <Label>Title *</Label>
                  <Input value={form.title} onChange={set('title')} placeholder="e.g. In Sides" />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Label</Label>
                <Input value={form.label} onChange={set('label')} placeholder="e.g. ffrr" />
              </div>
              <div className="space-y-1">
                <Label>Cat. number</Label>
                <Input value={form.catalogue_number} onChange={set('catalogue_number')} placeholder="e.g. 828 727-1" />
              </div>
              <div className="space-y-1">
                <Label>Year</Label>
                <Input value={form.year} onChange={set('year')} type="number" placeholder="e.g. 1996" />
              </div>
              <div className="space-y-1">
                <Label>Country</Label>
                <Input value={form.country} onChange={set('country')} placeholder="e.g. UK" />
              </div>
              <div className="space-y-1">
                <Label>Pressing</Label>
                <Select value={form.pressing} onValueChange={setSelect('pressing')}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="original">Original</SelectItem>
                    <SelectItem value="reissue">Reissue</SelectItem>
                    <SelectItem value="remaster">Remaster</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Condition</Label>
                <Select value={form.condition} onValueChange={setSelect('condition')}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    {['M', 'NM', 'VG+', 'VG', 'G+', 'G', 'F', 'P'].map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Format</Label>
                <Select value={form.format} onValueChange={setSelect('format')}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    {['LP', '12"', '7"', '10"', 'EP', 'Single', 'Other'].map(f => (
                      <SelectItem key={f} value={f}>{f}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-1">
                <Label>Format details</Label>
                <Input value={form.format_details} onChange={set('format_details')} placeholder="e.g. Red vinyl, gatefold" />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={set('notes')} placeholder="Any other notes…" rows={2} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={() => setStep(2)} disabled={!canAdvance}>
                Find on Discogs
              </Button>
            </div>
          </div>
        )}

        {/* Step 2 — Discogs search */}
        {step === 2 && (
          <div className="space-y-4">
            <DiscogsReleaseSelector
              initialArtist={form.artist}
              initialTitle={form.title}
              onSelect={handleDiscogsSelect}
              onSkip={handleDiscogsSkip}
            />
            <Button variant="ghost" size="sm" onClick={() => setStep(1)} className="text-muted-foreground">
              ← Back
            </Button>
          </div>
        )}

        {/* Step 3 — Saving */}
        {step === 3 && (
          <div className="flex items-center justify-center py-12 gap-3 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span>Saving to your collection…</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default AddVinylDialog;
