import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Disc3 } from 'lucide-react';
import type { PhysicalMediaRecord } from '@/types/discogs';

interface VinylCardProps {
  record: PhysicalMediaRecord;
  onClick: () => void;
}

const CONDITION_VARIANTS: Record<string, string> = {
  M: 'bg-green-600 text-white',
  NM: 'bg-green-500 text-white',
  'VG+': 'bg-blue-500 text-white',
  VG: 'bg-yellow-500 text-white',
  'G+': 'bg-orange-500 text-white',
  G: 'bg-red-500 text-white',
  F: 'bg-red-700 text-white',
  P: 'bg-gray-500 text-white',
};

export const VinylCard: React.FC<VinylCardProps> = ({ record, onClick }) => {
  const conditionClass = record.condition ? CONDITION_VARIANTS[record.condition] : 'bg-muted text-muted-foreground';

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
        {record.condition && (
          <span className={`absolute top-2 right-2 text-xs font-bold px-1.5 py-0.5 rounded ${conditionClass}`}>
            {record.condition}
          </span>
        )}
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
