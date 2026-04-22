import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Disc3, Trash2 } from 'lucide-react';
import type { PhysicalMediaRecord } from '@/types/discogs';

interface VinylCardProps {
  record: PhysicalMediaRecord;
  onClick: () => void;
  onRemove: (id: string) => void;
}

export const VinylCard: React.FC<VinylCardProps> = ({ record, onClick, onRemove }) => {

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow group overflow-hidden"
      onClick={onClick}
    >
      {/* Cover art */}
      <div className="aspect-square bg-muted relative overflow-hidden">
        {record.cover_image_url ? (
          <img
            src={record.cover_image_url}
            alt={`${record.artist} — ${record.title}`}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Disc3 className="h-12 w-12 text-muted-foreground/40" />
          </div>
        )}
        {record.rating && (
          <span className="absolute top-2 right-2 text-xs font-bold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            {'★'.repeat(record.rating)}{'☆'.repeat(5 - record.rating)}
          </span>
        )}
        {/* Remove button — visible on hover */}
        <Button
          variant="destructive"
          size="icon"
          className="absolute bottom-2 right-2 h-7 w-7 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(record.id);
          }}
          title="Remove record"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <CardContent className="p-3">
        <p className="font-semibold text-sm truncate leading-tight">{record.title}</p>
        <p className="text-xs text-muted-foreground truncate mt-0.5">{record.artist}</p>
        <div className="flex items-center gap-1 mt-2 flex-wrap">
          {record.year && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0">{record.year}</Badge>
          )}
          {record.format && (
            <Badge variant="outline" className="text-xs px-1.5 py-0">{record.format}</Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default VinylCard;
