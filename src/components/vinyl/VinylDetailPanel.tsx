import React, { useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Disc3, CheckCircle2, XCircle, Trash2 } from 'lucide-react';
import { useVinylMissingTracks } from '@/hooks/useVinylMissingTracks';
import { usePhysicalMedia } from '@/hooks/usePhysicalMedia';
import { useIsMobile } from '@/hooks/use-mobile';
import type { PhysicalMediaRecord } from '@/types/discogs';

interface VinylDetailPanelProps {
  record: PhysicalMediaRecord | null;
  open: boolean;
  onClose: () => void;
}

const RATING_LABELS: Record<number, string> = {
  5: 'Mint',
  4: 'Very Good Plus',
  3: 'Good',
  2: 'Fair',
  1: 'Poor',
};

function RatingDisplay({ rating }: { rating: number | null }) {
  if (rating === null) return null;
  const filled = '★'.repeat(rating);
  const empty = '☆'.repeat(5 - rating);
  return (
    <Badge variant="outline" className="text-xs">
      {filled}{empty} {RATING_LABELS[rating]}
    </Badge>
  );
}

export const VinylDetailPanel: React.FC<VinylDetailPanelProps> = ({ record, open, onClose }) => {
  const { matched, missing, isLoading: isMatching } = useVinylMissingTracks(record);
  const { deleteRecord, isDeleting } = usePhysicalMedia();
  const isMobile = useIsMobile();

  // Push a history entry when the sheet opens so Android back-swipe closes
  // the sheet instead of exiting the app.
  useEffect(() => {
    if (!open) return;
    window.history.pushState({ vinylDetail: true }, '');
    const handlePopState = () => onClose();
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (window.history.state?.vinylDetail) {
        window.history.back();
      }
    };
  }, [open, onClose]);

  const handleDelete = async () => {
    if (!record) return;
    await deleteRecord(record.id);
    onClose();
  };

  if (!record) return null;

  return (
    <Sheet open={open} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className={isMobile
          ? 'max-h-[70vh] rounded-t-2xl flex flex-col overflow-hidden'
          : 'w-full sm:max-w-lg flex flex-col'
        }
      >
        {isMobile && (
          <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
            <div className="w-12 h-1.5 rounded-full bg-muted-foreground/30" />
          </div>
        )}
        <SheetHeader>
          <SheetTitle className="flex items-start gap-3">
            {record.cover_image_url ? (
              <img
                src={record.cover_image_url}
                alt=""
                className="w-14 h-14 object-cover rounded flex-shrink-0"
              />
            ) : (
              <div className="w-14 h-14 bg-muted rounded flex items-center justify-center flex-shrink-0">
                <Disc3 className="h-7 w-7 text-muted-foreground/40" />
              </div>
            )}
            <div className="min-w-0">
              <p className="font-bold text-base leading-tight truncate">{record.title}</p>
              <p className="text-sm text-muted-foreground truncate">{record.artist}</p>
              <div className="flex flex-wrap gap-1 mt-1">
                {record.year && <Badge variant="secondary" className="text-xs">{record.year}</Badge>}
                {record.format && <Badge variant="outline" className="text-xs">{record.format}</Badge>}
                <RatingDisplay rating={record.rating} />
              </div>
            </div>
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="flex-1 mt-4 -mx-6 px-6">
          {/* Metadata */}
          <div className="space-y-1 text-sm">
            {record.label && <p><span className="text-muted-foreground">Label:</span> {record.label}</p>}
            {record.catalogue_number && <p><span className="text-muted-foreground">Cat. no:</span> {record.catalogue_number}</p>}
            {record.country && <p><span className="text-muted-foreground">Country:</span> {record.country}</p>}
            {record.pressing && <p><span className="text-muted-foreground">Pressing:</span> {record.pressing}</p>}
            {record.format_details && <p><span className="text-muted-foreground">Format:</span> {record.format_details}</p>}
            {record.genres && record.genres.length > 0 && (
              <p><span className="text-muted-foreground">Genres:</span> {record.genres.join(', ')}</p>
            )}
            {record.notes && <p className="text-muted-foreground italic mt-1">{record.notes}</p>}
          </div>

          {/* Tracklist + cross-reference */}
          {record.tracklist && record.tracklist.length > 0 && (
            <>
              <Separator className="my-4" />
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-sm">Tracklist</h3>
                  {isMatching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  {!isMatching && record.tracklist.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {matched.length}/{record.tracklist.length} in library
                    </span>
                  )}
                </div>
                <div className="space-y-1">
                  {record.tracklist.map((t, i) => {
                    const isMissing = missing.some(m => m.position === t.position && m.title === t.title);
                    const isFound = !isMatching && !isMissing;
                    return (
                      <div key={i} className="flex items-center gap-2 text-sm py-0.5">
                        <span className="text-muted-foreground w-6 text-right flex-shrink-0 text-xs">
                          {t.position}
                        </span>
                        <span className="flex-1 truncate">{t.title}</span>
                        {!isMatching && (
                          isFound
                            ? <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                            : <XCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {!record.tracklist && (
            <p className="text-sm text-muted-foreground mt-4 italic">
              No tracklist available. Sync from Discogs to populate release data.
            </p>
          )}
        </ScrollArea>

        {/* Actions */}
        <div className="flex items-center pt-4 border-t mt-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            {isDeleting ? 'Removing…' : 'Remove'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default VinylDetailPanel;
