import { useState, useCallback } from 'react';
import { Disc3, ChevronUp, ChevronDown, ChevronsUpDown, Download, Loader2 } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { useSlskdSync } from '@/hooks/useSlskdSync';
import type { PhysicalMediaRecord } from '@/types/discogs';

interface VinylListViewProps {
  records: PhysicalMediaRecord[];
  onSelect: (record: PhysicalMediaRecord) => void;
}

type SortField = 'artist' | 'title' | 'year' | 'label' | 'lowest_price_cad';
type SortDir = 'asc' | 'desc';

function formatCAD(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(value);
}

function SortIcon({ field, sortField, sortDir }: { field: SortField; sortField: SortField; sortDir: SortDir }) {
  if (field !== sortField) return <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground/50" />;
  return sortDir === 'asc'
    ? <ChevronUp className="h-3.5 w-3.5" />
    : <ChevronDown className="h-3.5 w-3.5" />;
}

export const VinylListView: React.FC<VinylListViewProps> = ({ records, onSelect }) => {
  const [sortField, setSortField] = useState<SortField>('artist');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [pushingId, setPushingId] = useState<string | null>(null);
  const { syncAlbumToSlskd } = useSlskdSync();

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const handleSlskd = useCallback(async (e: React.MouseEvent, record: PhysicalMediaRecord) => {
    e.stopPropagation();
    setPushingId(record.id);
    await syncAlbumToSlskd({
      artist: record.artist,
      primary_artist: record.artist,
      title: record.title,
      album: record.title,
    });
    setPushingId(null);
  }, [syncAlbumToSlskd]);

  const sorted = [...records].sort((a, b) => {
    let av: string | number | null = null;
    let bv: string | number | null = null;
    if (sortField === 'artist') { av = a.artist ?? ''; bv = b.artist ?? ''; }
    else if (sortField === 'title') { av = a.title ?? ''; bv = b.title ?? ''; }
    else if (sortField === 'year') { av = a.year ?? 0; bv = b.year ?? 0; }
    else if (sortField === 'label') { av = a.label ?? ''; bv = b.label ?? ''; }
    else if (sortField === 'lowest_price_cad') { av = a.lowest_price_cad ?? -1; bv = b.lowest_price_cad ?? -1; }

    if (av === null || av === '' || av === -1) return sortDir === 'asc' ? 1 : -1;
    if (bv === null || bv === '' || bv === -1) return sortDir === 'asc' ? -1 : 1;
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3 text-muted-foreground">
        <Disc3 className="h-10 w-10 opacity-30" />
        <p>No records match the current filters.</p>
      </div>
    );
  }

  const th = (label: string, field: SortField) => (
    <TableHead
      className="cursor-pointer hover:bg-muted/50 select-none px-3 py-1.5"
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center gap-1">
        {label}
        <SortIcon field={field} sortField={sortField} sortDir={sortDir} />
      </div>
    </TableHead>
  );

  return (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12 px-3 py-1.5" />
            {th('Artist', 'artist')}
            {th('Title', 'title')}
            {th('Year', 'year')}
            {th('Label', 'label')}
            <TableHead className="px-3 py-1.5 font-mono text-xs">Cat#</TableHead>
            {th('Low (CAD)', 'lowest_price_cad')}
            <TableHead className="px-3 py-1.5">slskd</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((record) => (
            <TableRow
              key={record.id}
              className="cursor-pointer"
              onClick={() => onSelect(record)}
            >
              <TableCell className="px-3 py-1.5 w-12">
                {record.cover_image_url ? (
                  <img
                    src={record.cover_image_url}
                    alt={record.title}
                    className="h-10 w-10 rounded object-cover"
                  />
                ) : (
                  <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
                    <Disc3 className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
              </TableCell>
              <TableCell className="px-3 py-1.5 max-w-[150px] truncate font-medium">{record.artist}</TableCell>
              <TableCell className="px-3 py-1.5 max-w-[150px] truncate">{record.title}</TableCell>
              <TableCell className="px-3 py-1.5 tabular-nums">{record.year ?? '—'}</TableCell>
              <TableCell className="px-3 py-1.5 max-w-[120px] truncate">{record.label ?? '—'}</TableCell>
              <TableCell className="px-3 py-1.5 font-mono text-xs">{record.catalogue_number ?? '—'}</TableCell>
              <TableCell className="px-3 py-1.5 tabular-nums text-sm">{formatCAD(record.lowest_price_cad)}</TableCell>
              <TableCell className="px-3 py-1.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={(e) => handleSlskd(e, record)}
                  disabled={pushingId === record.id}
                  title={`Search "${record.artist} – ${record.title}" in slskd`}
                >
                  {pushingId === record.id
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Download className="h-3.5 w-3.5" />
                  }
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
