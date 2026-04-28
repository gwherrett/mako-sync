import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Disc3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { PhysicalMediaRecord } from '@/types/discogs';

interface CoverFlowViewProps {
  records: PhysicalMediaRecord[];
  onSelect: (record: PhysicalMediaRecord) => void;
}

const CAP = 200;
const WINDOW = 5;

const X_OFFSETS = [0, 240, 360, 420, 460, 500];

function getTransform(offset: number): React.CSSProperties {
  const abs = Math.abs(offset);
  const sign = Math.sign(offset);
  return {
    transform: [
      `translateX(${sign * X_OFFSETS[Math.min(abs, 5)]}px)`,
      `translateZ(${-abs * 60}px)`,
      `rotateY(${sign * Math.min(abs * 45, 75)}deg)`,
      `scale(${Math.max(1 - abs * 0.12, 0.4)})`,
    ].join(' '),
    zIndex: 10 - abs,
    transition: 'transform 400ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
  };
}

export const CoverFlowView: React.FC<CoverFlowViewProps> = ({ records, onSelect }) => {
  const capped = records.slice(0, CAP);
  const [activeIndex, setActiveIndex] = useState(0);

  const prev = useCallback(() => setActiveIndex((i) => Math.max(0, i - 1)), []);
  const next = useCallback(() => setActiveIndex((i) => Math.min(capped.length - 1, i + 1)), [capped.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next]);

  // Reset active index if records shrink below it
  useEffect(() => {
    if (activeIndex >= capped.length) setActiveIndex(Math.max(0, capped.length - 1));
  }, [capped.length, activeIndex]);

  if (capped.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
        <Disc3 className="h-10 w-10 opacity-30" />
        <p>No records to display.</p>
      </div>
    );
  }

  const active = capped[activeIndex];

  return (
    <div className="space-y-4">
      {records.length > CAP && (
        <Alert className="border-amber-500/50 bg-amber-500/10">
          <AlertDescription className="text-amber-600 text-sm">
            Cover Flow shows the first {CAP} records. Use filters to narrow your collection.
          </AlertDescription>
        </Alert>
      )}

      <div
        className="relative bg-zinc-950 rounded-lg overflow-hidden select-none"
        style={{ height: 340 }}
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'ArrowLeft') prev(); else if (e.key === 'ArrowRight') next(); }}
      >
        {/* 3D stage */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ perspective: '1000px', perspectiveOrigin: '50% 40%' }}
        >
          <div style={{ position: 'relative', transformStyle: 'preserve-3d', width: 220, height: 220 }}>
            {capped.map((record, i) => {
              const offset = i - activeIndex;
              if (Math.abs(offset) > WINDOW) return null;
              const isActive = offset === 0;
              const imgUrl = record.cover_image_url;

              return (
                <div
                  key={record.id}
                  onClick={() => isActive ? onSelect(record) : setActiveIndex(i)}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: 220,
                    height: 220,
                    cursor: 'pointer',
                    ...getTransform(offset),
                  }}
                >
                  {/* Cover */}
                  {imgUrl ? (
                    <img
                      src={imgUrl}
                      alt={record.title}
                      loading="lazy"
                      className="w-full h-full object-cover rounded shadow-2xl"
                    />
                  ) : (
                    <div className="w-full h-full rounded bg-zinc-800 flex items-center justify-center shadow-2xl">
                      <Disc3 className="h-16 w-16 text-zinc-600" />
                    </div>
                  )}

                  {/* Reflection */}
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      width: '100%',
                      height: '100%',
                      transformOrigin: 'top',
                      transform: 'scaleY(-1)',
                      background: 'linear-gradient(to bottom, rgba(0,0,0,0.5), transparent)',
                    }}
                  >
                    {imgUrl && (
                      <img
                        src={imgUrl}
                        alt=""
                        loading="lazy"
                        className="w-full h-full object-cover rounded"
                        style={{ opacity: 0.6, transform: 'scaleY(-1)' }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Navigation arrows */}
        <Button
          variant="ghost"
          size="icon"
          className="absolute left-2 top-1/2 -translate-y-1/2 text-white/70 hover:text-white hover:bg-white/10 z-20"
          onClick={prev}
          disabled={activeIndex === 0}
        >
          <ChevronLeft className="h-6 w-6" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-white/70 hover:text-white hover:bg-white/10 z-20"
          onClick={next}
          disabled={activeIndex === capped.length - 1}
        >
          <ChevronRight className="h-6 w-6" />
        </Button>

        {/* Caption bar */}
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent px-4 py-3 text-center z-20">
          <p className="text-white text-sm font-medium truncate">
            {active.title} — {active.artist}
          </p>
          {active.year && (
            <p className="text-white/60 text-xs">{active.year}</p>
          )}
        </div>
      </div>

      {/* Dot indicator */}
      <p className="text-center text-xs text-muted-foreground">
        {activeIndex + 1} / {capped.length}
      </p>
    </div>
  );
};
