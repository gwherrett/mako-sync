import { useState, useEffect } from 'react';
import { Search, Edit3, ArrowUpDown, RefreshCw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Pagination, PaginationContent, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious, PaginationEllipsis,
} from '@/components/ui/pagination';
import type { DiscogsTermMapping } from '@/services/discogsGenreMapping.service';
import { SUPER_GENRES, type SuperGenre } from '@/types/genreMapping';

const PAGE_SIZE = 50;

interface DiscogsGenreMappingTableProps {
  mappings: DiscogsTermMapping[];
  onSetOverride: (discogsTerm: string, superGenre: SuperGenre) => void;
  onRemoveOverride: (discogsTerm: string) => void;
  onRecomputeAll: () => void;
  isLoading?: boolean;
  isRecomputing?: boolean;
}

export const DiscogsGenreMappingTable: React.FC<DiscogsGenreMappingTableProps> = ({
  mappings,
  onSetOverride,
  onRemoveOverride,
  onRecomputeAll,
  isLoading = false,
  isRecomputing = false,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterSuperGenre, setFilterSuperGenre] = useState('all');
  const [filterTermType, setFilterTermType] = useState('all');
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<'discogs_term' | 'super_genre' | 'term_type'>('term_type');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);

  const filtered = mappings.filter(m => {
    const matchesSearch =
      m.discogs_term.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (m.super_genre && m.super_genre.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesType = filterTermType === 'all' || m.term_type === filterTermType;
    const matchesSuperGenre =
      filterSuperGenre === 'all' ? true :
      filterSuperGenre === 'unmapped' ? !m.super_genre :
      m.super_genre === filterSuperGenre;
    return matchesSearch && matchesType && matchesSuperGenre;
  }).sort((a, b) => {
    const aVal = sortColumn === 'discogs_term' ? a.discogs_term :
                 sortColumn === 'term_type' ? a.term_type :
                 (a.super_genre || '');
    const bVal = sortColumn === 'discogs_term' ? b.discogs_term :
                 sortColumn === 'term_type' ? b.term_type :
                 (b.super_genre || '');
    const cmp = aVal.localeCompare(bVal);
    return sortDirection === 'asc' ? cmp : -cmp;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => { setCurrentPage(1); }, [searchTerm, filterSuperGenre, filterTermType, sortColumn, sortDirection]);

  const toggleSort = (col: typeof sortColumn) => {
    if (sortColumn === col) setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortColumn(col); setSortDirection('asc'); }
  };

  const overriddenCount = mappings.filter(m => m.is_overridden).length;
  const unmappedCount = mappings.filter(m => !m.super_genre).length;

  if (isLoading) {
    return <div className="flex items-center justify-center h-64">Loading Discogs mappings...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <CardTitle>Discogs Genre Mapping</CardTitle>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              {mappings.length} total • {overriddenCount} overridden • {unmappedCount} unmapped
            </p>
          </div>
          <Button onClick={onRecomputeAll} variant="outline" size="sm" disabled={isRecomputing} className="self-start sm:self-auto">
            <RefreshCw className={`w-4 h-4 mr-2 ${isRecomputing ? 'animate-spin' : ''}`} />
            {isRecomputing ? 'Recomputing…' : 'Recompute All'}
          </Button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search terms…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-10" />
          </div>
          <Select value={filterTermType} onValueChange={setFilterTermType}>
            <SelectTrigger className="w-full sm:w-36">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="style">Style</SelectItem>
              <SelectItem value="genre">Genre</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterSuperGenre} onValueChange={setFilterSuperGenre}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Filter by Supergenre" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="unmapped">Unmapped</SelectItem>
              {[...SUPER_GENRES].sort().map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Button variant="ghost" size="sm" onClick={() => toggleSort('discogs_term')} className="font-semibold -ml-3">
                    Discogs Term <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button variant="ghost" size="sm" onClick={() => toggleSort('term_type')} className="font-semibold -ml-3">
                    Type <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button variant="ghost" size="sm" onClick={() => toggleSort('super_genre')} className="font-semibold -ml-3">
                    Supergenre <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead className="hidden md:table-cell">Source</TableHead>
                <TableHead className="w-20">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.map(m => (
                <TableRow key={m.discogs_term} className={m.is_overridden ? 'bg-accent/50' : ''}>
                  <TableCell className="font-medium text-sm">{m.discogs_term}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {m.term_type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {editingRow === m.discogs_term ? (
                      <Select value={m.super_genre || ''} onValueChange={val => { onSetOverride(m.discogs_term, val as SuperGenre); setEditingRow(null); }}>
                        <SelectTrigger className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[...SUPER_GENRES].sort().map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-sm">
                        {m.super_genre ?? <span className="text-muted-foreground italic">Unmapped</span>}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Badge variant={!m.super_genre ? 'destructive' : m.is_overridden ? 'secondary' : 'outline'}>
                      {!m.super_genre ? 'Unmapped' : m.is_overridden ? 'Override' : 'Base'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditingRow(editingRow === m.discogs_term ? null : m.discogs_term)}>
                        <Edit3 className="w-4 h-4" />
                      </Button>
                      {m.is_overridden && (
                        <Button size="sm" variant="ghost" onClick={() => onRemoveOverride(m.discogs_term)} className="text-muted-foreground hover:text-foreground hidden sm:inline-flex">
                          Reset
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {totalPages > 1 && (
          <div className="mt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
            <p className="text-xs sm:text-sm text-muted-foreground">
              Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
            </p>
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious onClick={() => setCurrentPage(p => Math.max(1, p - 1))} className={currentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'} />
                </PaginationItem>
                {currentPage > 2 && <PaginationItem><PaginationLink onClick={() => setCurrentPage(1)} className="cursor-pointer">1</PaginationLink></PaginationItem>}
                {currentPage > 3 && <PaginationItem><PaginationEllipsis /></PaginationItem>}
                {currentPage > 1 && <PaginationItem><PaginationLink onClick={() => setCurrentPage(currentPage - 1)} className="cursor-pointer">{currentPage - 1}</PaginationLink></PaginationItem>}
                <PaginationItem><PaginationLink isActive>{currentPage}</PaginationLink></PaginationItem>
                {currentPage < totalPages && <PaginationItem><PaginationLink onClick={() => setCurrentPage(currentPage + 1)} className="cursor-pointer">{currentPage + 1}</PaginationLink></PaginationItem>}
                {currentPage < totalPages - 2 && <PaginationItem><PaginationEllipsis /></PaginationItem>}
                {currentPage < totalPages - 1 && <PaginationItem><PaginationLink onClick={() => setCurrentPage(totalPages)} className="cursor-pointer">{totalPages}</PaginationLink></PaginationItem>}
                <PaginationItem>
                  <PaginationNext onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} className={currentPage === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'} />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}

        {filtered.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No terms found matching your search criteria.
          </div>
        )}
      </CardContent>
    </Card>
  );
};
