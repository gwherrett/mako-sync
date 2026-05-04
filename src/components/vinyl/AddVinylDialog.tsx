import React, { useState } from 'react';
import { Loader2, Info } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { DiscogsReleaseSelector } from './DiscogsReleaseSelector';
import { CameraCapture } from './CameraCapture';
import { useDiscogsAuth } from '@/hooks/useDiscogsAuth';
import { useDiscogsAddToCollection } from '@/hooks/useDiscogsAddToCollection';
import type { DiscogsRelease, VinylIdentifyResult } from '@/types/discogs';

const RATING_OPTIONS = [
  { value: 5, label: '5 — Mint' },
  { value: 4, label: '4 — Very Good Plus' },
  { value: 3, label: '3 — Good' },
  { value: 2, label: '2 — Fair' },
  { value: 1, label: '1 — Poor' },
];

const RATING_TOOLTIP = `Discogs Rating Scale
5 – Mint (M) — Played once or never
4 – Very Good Plus (VG+) — Shows some signs of play
3 – Good (G) — Significant marks or surface noise
2 – Fair (F) — Heavily played/damaged
1 – Poor (P) — Barely playable

Leave unrated to set later on Discogs.`;

interface AddVinylDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = 0 | 1 | 2;

interface FormData {
  artist: string;
  title: string;
  label: string;
  catalogue_number: string;
  year: string;
  country: string;
  format: string;
}

const EMPTY_FORM: FormData = {
  artist: '',
  title: '',
  label: '',
  catalogue_number: '',
  year: '',
  country: '',
  format: '',
};

const STEP_LABELS: Record<Step, string> = {
  0: 'Scan label',
  1: 'Record details',
  2: 'Find on Discogs',
};

export const AddVinylDialog: React.FC<AddVinylDialogProps> = ({ open, onOpenChange }) => {
  const [step, setStep] = useState<Step>(0);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [rating, setRating] = useState<number | null>(null);
  const { isConnected: discogsConnected } = useDiscogsAuth();
  const { addToCollection, isPending } = useDiscogsAddToCollection();

  const set = (field: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }));
  const setSelect = (field: keyof FormData) => (value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const handleClose = () => {
    onOpenChange(false);
    // Reset after animation
    setTimeout(() => {
      setStep(0);
      setForm(EMPTY_FORM);
      setRating(null);
    }, 200);
  };

  const handleIdentified = (result: VinylIdentifyResult) => {
    setForm({
      artist: result.artist ?? '',
      title: result.title ?? '',
      label: result.label ?? '',
      catalogue_number: result.catalogue_number ?? '',
      year: result.year != null ? String(result.year) : '',
      country: '',
      format: '',
    });
    setStep(1);
  };

  const handleDiscogsSelect = async (release: DiscogsRelease) => {
    try {
      await addToCollection({ releaseId: release.id, rating });
      handleClose();
    } catch {
      // hook's onError shows a toast; step back so user can retry
      setStep(2);
    }
  };

  const canAdvance = form.artist.trim() || form.title.trim();

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg h-[100dvh] sm:h-auto flex flex-col top-0 translate-y-0 sm:top-[50%] sm:translate-y-[-50%] rounded-none sm:rounded-lg">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>
            Add to Discogs
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {step === 0 ? STEP_LABELS[0] : `Step ${step} of 2 — ${STEP_LABELS[step]}`}
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Step 0 — Camera capture */}
        {step === 0 && (
          <div className="flex-1 overflow-y-auto">
            <CameraCapture
              onIdentified={handleIdentified}
              onError={() => setStep(1)}
              onSkip={() => setStep(1)}
            />
          </div>
        )}

        {/* Step 1 — Record details */}
        {step === 1 && (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Artist</Label>
                    <Input value={form.artist} onChange={set('artist')} placeholder="e.g. Orbital" />
                  </div>
                  <div className="space-y-1">
                    <Label>Title</Label>
                    <Input value={form.title} onChange={set('title')} placeholder="e.g. In Sides" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">At least one of Artist or Title is required</p>
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
                <div className="flex items-center gap-1">
                  <Label>Rating</Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs whitespace-pre-line">
                        {RATING_TOOLTIP}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Select
                  value={rating !== null ? String(rating) : ''}
                  onValueChange={v => setRating(v ? Number(v) : null)}
                >
                  <SelectTrigger><SelectValue placeholder="Unrated" /></SelectTrigger>
                  <SelectContent>
                    {RATING_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
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
            </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 pb-4 flex-shrink-0 border-t mt-2">
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={() => setStep(2)} disabled={!canAdvance}>
                Find on Discogs
              </Button>
            </div>
          </div>
        )}

        {/* Step 2 — Discogs search */}
        {step === 2 && (
          <div className="flex flex-col flex-1 min-h-0 gap-4">
            <div className="flex-1 overflow-y-auto space-y-4">
              {!discogsConnected && (
                <p className="text-sm text-muted-foreground rounded-md border border-border bg-muted/40 px-3 py-2">
                  Connect your Discogs account on the{' '}
                  <a href="/security" className="underline underline-offset-2">Settings page</a>{' '}
                  to add records to your collection.
                </p>
              )}
              {isPending ? (
                <div className="flex items-center justify-center py-12 gap-3 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <span>Adding to Discogs…</span>
                </div>
              ) : (
                <DiscogsReleaseSelector
                  initialArtist={form.artist}
                  initialTitle={form.title}
                  onSelect={handleDiscogsSelect}
                  onSkip={handleClose}
                  confirmDisabled={!discogsConnected}
                />
              )}
            </div>
            {!isPending && (
              <div className="flex-shrink-0 border-t pt-2 pb-4">
                <Button variant="ghost" size="sm" onClick={() => setStep(1)} className="text-muted-foreground">
                  ← Back
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default AddVinylDialog;
