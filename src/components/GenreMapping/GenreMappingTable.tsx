import { useState, useEffect } from 'react';
import { Search, Download, Edit3, ArrowUpDown, CheckCircle2, Circle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  PaginationEllipsis,
} from '@/components/ui/pagination';
import type { GenreMapping, SuperGenre } from '@/types/genreMapping';
import { SUPER_GENRES } from '@/types/genreMapping';

const PAGE_SIZE = 50;
interface GenreMappingTableProps {
  mappings: GenreMapping[];
  onSetOverride: (spotifyGenre: string, superGenre: SuperGenre) => void;
  onRemoveOverride: (spotifyGenre: string) => void;
  onBulkOverrides: (overrides: Array<{ spotifyGenre: string; superGenre: SuperGenre }>) => Promise<void>;
  onExport: () => void;
  isLoading?: boolean;
}
export const GenreMappingTable: React.FC<GenreMappingTableProps> = ({
  mappings,
  onSetOverride,
  onRemoveOverride,
  onBulkOverrides,
  onExport,
  isLoading = false
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterSuperGenre, setFilterSuperGenre] = useState<string>('all');
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<'spotify_genre' | 'super_genre' | 'reviewed'>('spotify_genre');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [reviewedGenres, setReviewedGenres] = useState<Set<string>>(new Set());
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // Load reviewed genres from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('reviewedGenres');
    if (stored) {
      try {
        setReviewedGenres(new Set(JSON.parse(stored)));
      } catch (e) {
        console.error('Failed to load reviewed genres', e);
      }
    }
  }, []);

  // Save reviewed genres to localStorage
  useEffect(() => {
    localStorage.setItem('reviewedGenres', JSON.stringify(Array.from(reviewedGenres)));
  }, [reviewedGenres]);
  const filteredMappings = mappings.filter(mapping => {
    const matchesSearch = 
      mapping.spotify_genre.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (mapping.super_genre && mapping.super_genre.toLowerCase().includes(searchTerm.toLowerCase()));
    let matchesFilter = true;
    if (filterSuperGenre === 'no-super-genre') {
      matchesFilter = !mapping.super_genre;
    } else if (filterSuperGenre !== 'all') {
      matchesFilter = mapping.super_genre === filterSuperGenre;
    }
    return matchesSearch && matchesFilter;
  }).sort((a, b) => {
    if (sortColumn === 'reviewed') {
      const aReviewed = reviewedGenres.has(a.spotify_genre) ? 1 : 0;
      const bReviewed = reviewedGenres.has(b.spotify_genre) ? 1 : 0;
      const comparison = aReviewed - bReviewed;
      return sortDirection === 'asc' ? comparison : -comparison;
    }
    const aValue = sortColumn === 'spotify_genre' ? a.spotify_genre : (a.super_genre || '');
    const bValue = sortColumn === 'spotify_genre' ? b.spotify_genre : (b.super_genre || '');
    const comparison = aValue.localeCompare(bValue);
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  // Pagination
  const totalPages = Math.ceil(filteredMappings.length / PAGE_SIZE);
  const paginatedMappings = filteredMappings.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterSuperGenre, sortColumn, sortDirection]);

  const overriddenCount = mappings.filter(m => m.is_overridden).length;
  const unmappedCount = mappings.filter(m => !m.super_genre).length;
  const handleRowSelect = (spotifyGenre: string, checked: boolean) => {
    const newSelected = new Set(selectedRows);
    if (checked) {
      newSelected.add(spotifyGenre);
    } else {
      newSelected.delete(spotifyGenre);
    }
    setSelectedRows(newSelected);
  };
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedRows(new Set(paginatedMappings.map(m => m.spotify_genre)));
    } else {
      setSelectedRows(new Set());
    }
  };
  const handleInlineEdit = (spotifyGenre: string, newSuperGenre: SuperGenre) => {
    onSetOverride(spotifyGenre, newSuperGenre);
    setEditingRow(null);
  };
  const handleResetToDefault = (mapping: GenreMapping) => {
    if (mapping.is_overridden) {
      onRemoveOverride(mapping.spotify_genre);
    }
  };

  const toggleSort = (column: 'spotify_genre' | 'super_genre' | 'reviewed') => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const toggleReviewed = (spotifyGenre: string) => {
    const newReviewed = new Set(reviewedGenres);
    if (newReviewed.has(spotifyGenre)) {
      newReviewed.delete(spotifyGenre);
    } else {
      newReviewed.add(spotifyGenre);
    }
    setReviewedGenres(newReviewed);
  };

  const handleBulkSetGenre = async (superGenre: SuperGenre) => {
    setIsBulkUpdating(true);
    try {
      const overrides = Array.from(selectedRows).map(spotifyGenre => ({
        spotifyGenre,
        superGenre
      }));
      await onBulkOverrides(overrides);
      setSelectedRows(new Set());
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const reviewedCount = Array.from(reviewedGenres).filter(genre => 
    mappings.some(m => m.spotify_genre === genre)
  ).length;
  if (isLoading) {
    return <div className="flex items-center justify-center h-64">Loading genre mappings...</div>;
  }
  return <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <CardTitle>Summary</CardTitle>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              {mappings.length} total • {overriddenCount} overridden • {unmappedCount} unmapped • {reviewedCount} reviewed
            </p>
          </div>
          <Button onClick={onExport} variant="outline" size="sm" className="self-start sm:self-auto min-h-[44px] sm:min-h-0">
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 sm:items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search genres..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-10" />
          </div>

          <Select value={filterSuperGenre} onValueChange={setFilterSuperGenre}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Filter by Supergenre" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Genres</SelectItem>
              <SelectItem value="no-super-genre">Unmapped</SelectItem>
              {[...SUPER_GENRES].sort().map(genre => <SelectItem key={genre} value={genre}>{genre}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="hidden sm:table-cell w-12">
                  <input type="checkbox" checked={selectedRows.size === paginatedMappings.length && paginatedMappings.length > 0} onChange={e => handleSelectAll(e.target.checked)} className="rounded" />
                </TableHead>
                <TableHead>
                  <Button variant="ghost" size="sm" onClick={() => toggleSort('spotify_genre')} className="font-semibold -ml-3">
                    Spotify Genre
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button variant="ghost" size="sm" onClick={() => toggleSort('super_genre')} className="font-semibold -ml-3">
                    Supergenre
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead className="hidden md:table-cell">Source</TableHead>
                <TableHead className="hidden md:table-cell w-12">
                  <Button variant="ghost" size="sm" onClick={() => toggleSort('reviewed')} className="font-semibold -ml-3">
                    Reviewed
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead className="w-20 md:w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedMappings.map(mapping => <TableRow key={mapping.spotify_genre} className={mapping.is_overridden ? 'bg-accent/50' : ''}>
                  <TableCell className="hidden sm:table-cell">
                    <input type="checkbox" checked={selectedRows.has(mapping.spotify_genre)} onChange={e => handleRowSelect(mapping.spotify_genre, e.target.checked)} className="rounded" />
                  </TableCell>
                  <TableCell className="font-medium text-sm">{mapping.spotify_genre}</TableCell>
                  <TableCell>
                    {editingRow === mapping.spotify_genre ? <Select value={mapping.super_genre || ''} onValueChange={value => handleInlineEdit(mapping.spotify_genre, value as SuperGenre)}>
                        <SelectTrigger className="w-32 md:w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[...SUPER_GENRES].sort().map(genre => <SelectItem key={genre} value={genre}>{genre}</SelectItem>)}
                        </SelectContent>
                      </Select> : <span className="text-sm">
                          {mapping.super_genre ? mapping.super_genre : <span className="text-muted-foreground italic">Unmapped</span>}
                        </span>}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Badge variant={!mapping.super_genre ? 'destructive' : mapping.is_overridden ? 'secondary' : 'outline'}>
                      {!mapping.super_genre ? 'Unmapped' : mapping.is_overridden ? 'Override' : 'Base'}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleReviewed(mapping.spotify_genre)}
                      className="p-0 h-auto min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center"
                    >
                      {reviewedGenres.has(mapping.spotify_genre) ? (
                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                      ) : (
                        <Circle className="w-5 h-5 text-muted-foreground" />
                      )}
                    </Button>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0" onClick={() => setEditingRow(editingRow === mapping.spotify_genre ? null : mapping.spotify_genre)}>
                        <Edit3 className="w-4 h-4 sm:w-3 sm:h-3" />
                      </Button>
                      {mapping.is_overridden && <Button size="sm" variant="ghost" onClick={() => handleResetToDefault(mapping)} className="text-muted-foreground hover:text-foreground hidden sm:inline-flex">
                          Reset
                        </Button>}
                    </div>
                  </TableCell>
                </TableRow>)}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
            <p className="text-xs sm:text-sm text-muted-foreground">
              Showing {(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, filteredMappings.length)} of {filteredMappings.length}
            </p>
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious 
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    className={currentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                  />
                </PaginationItem>
                
                {/* First page */}
                {currentPage > 2 && (
                  <PaginationItem>
                    <PaginationLink onClick={() => setCurrentPage(1)} className="cursor-pointer">1</PaginationLink>
                  </PaginationItem>
                )}
                
                {currentPage > 3 && (
                  <PaginationItem>
                    <PaginationEllipsis />
                  </PaginationItem>
                )}
                
                {/* Previous page */}
                {currentPage > 1 && (
                  <PaginationItem>
                    <PaginationLink onClick={() => setCurrentPage(currentPage - 1)} className="cursor-pointer">
                      {currentPage - 1}
                    </PaginationLink>
                  </PaginationItem>
                )}
                
                {/* Current page */}
                <PaginationItem>
                  <PaginationLink isActive>{currentPage}</PaginationLink>
                </PaginationItem>
                
                {/* Next page */}
                {currentPage < totalPages && (
                  <PaginationItem>
                    <PaginationLink onClick={() => setCurrentPage(currentPage + 1)} className="cursor-pointer">
                      {currentPage + 1}
                    </PaginationLink>
                  </PaginationItem>
                )}
                
                {currentPage < totalPages - 2 && (
                  <PaginationItem>
                    <PaginationEllipsis />
                  </PaginationItem>
                )}
                
                {/* Last page */}
                {currentPage < totalPages - 1 && (
                  <PaginationItem>
                    <PaginationLink onClick={() => setCurrentPage(totalPages)} className="cursor-pointer">
                      {totalPages}
                    </PaginationLink>
                  </PaginationItem>
                )}
                
                <PaginationItem>
                  <PaginationNext 
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    className={currentPage === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}

        {selectedRows.size > 0 && <div className="mt-4 p-3 bg-accent rounded-lg">
            <p className="text-sm font-medium mb-2">
              {selectedRows.size} genre{selectedRows.size !== 1 ? 's' : ''} selected
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Select onValueChange={handleBulkSetGenre} disabled={isBulkUpdating}>
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue placeholder="Set Supergenre for selected" />
                </SelectTrigger>
                <SelectContent>
                  {[...SUPER_GENRES].sort().map(genre => <SelectItem key={genre} value={genre}>{genre}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedRows(new Set())}
                disabled={isBulkUpdating}
              >
                Clear Selection
              </Button>
              {isBulkUpdating && (
                <span className="text-sm text-muted-foreground flex items-center">
                  Updating...
                </span>
              )}
            </div>
          </div>}
        
        {filteredMappings.length === 0 && <div className="text-center py-8 text-muted-foreground">
            No genres found matching your search criteria.
          </div>}
      </CardContent>
    </Card>;
};