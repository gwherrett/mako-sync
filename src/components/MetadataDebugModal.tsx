/**
 * MetadataDebugModal Component
 *
 * Shows raw ID3 tag metadata for debugging mismatches between
 * what MediaMonkey shows and what Mako Sync reads.
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';
import { getFileDebugMetadata, type FileDebugMetadata } from '@/services/downloadProcessor.service';
import type { ProcessedFile } from '@/types/slskd';

interface MetadataDebugModalProps {
  file: ProcessedFile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Genre-related frame IDs to highlight
const GENRE_FRAME_IDS = ['TCON', 'GENRE', 'TXXX'];

export function MetadataDebugModal({ file, open, onOpenChange }: MetadataDebugModalProps) {
  const [metadata, setMetadata] = useState<FileDebugMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['extracted', 'common']));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open && file?.file) {
      setIsLoading(true);
      setError(null);
      setMetadata(null);

      getFileDebugMetadata(file.file)
        .then((data) => {
          setMetadata(data);
          // Auto-expand native formats
          const newExpanded = new Set(['extracted', 'common']);
          data.nativeFormats.forEach((f) => newExpanded.add(f));
          setExpandedSections(newExpanded);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to read metadata');
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [open, file]);

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const copyToClipboard = () => {
    if (metadata) {
      navigator.clipboard.writeText(JSON.stringify(metadata, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return '(empty)';
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  };

  const isGenreRelated = (frameId: string, value: unknown): boolean => {
    if (GENRE_FRAME_IDS.includes(frameId)) {
      if (frameId === 'TXXX' && typeof value === 'object' && value !== null) {
        const txxx = value as { description?: string };
        const desc = (txxx.description || '').toLowerCase();
        return desc.includes('genre') || desc === 'style' || desc === 'styles' || desc === 'custom1';
      }
      return true;
    }
    return false;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between pr-8">
            <span className="truncate">
              Metadata Debug: {file?.artist} - {file?.title}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={copyToClipboard}
              disabled={!metadata}
              className="ml-2 shrink-0"
            >
              {copied ? (
                <Check className="h-4 w-4 mr-1" />
              ) : (
                <Copy className="h-4 w-4 mr-1" />
              )}
              {copied ? 'Copied' : 'Copy JSON'}
            </Button>
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 space-y-3 pr-2">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>Reading metadata...</span>
            </div>
          )}

          {error && (
            <div className="text-destructive text-center py-8">
              Error: {error}
            </div>
          )}

          {metadata && (
            <>
              {/* Extracted Values */}
              <Section
                title="Extracted Values (What Mako Sync Uses)"
                expanded={expandedSections.has('extracted')}
                onToggle={() => toggleSection('extracted')}
              >
                <div className="space-y-1 text-sm">
                  <Row label="Artist" value={metadata.extracted.artist} />
                  <Row label="Title" value={metadata.extracted.title} />
                  <Row label="Album" value={metadata.extracted.album || '(none)'} />
                  <Row
                    label="Genres"
                    value={
                      metadata.extracted.genres.length > 0
                        ? metadata.extracted.genres.join(', ')
                        : '(none found)'
                    }
                    highlight={metadata.extracted.genres.length === 0}
                  />
                  <Row
                    label="SuperGenre"
                    value={file?.superGenre || '(not assigned)'}
                  />
                </div>
              </Section>

              {/* Raw Common Tags */}
              <Section
                title="Raw Common Tags (metadata.common)"
                expanded={expandedSections.has('common')}
                onToggle={() => toggleSection('common')}
              >
                <div className="space-y-1 text-sm font-mono">
                  <Row label="title" value={formatValue(metadata.common.title)} />
                  <Row label="artist" value={formatValue(metadata.common.artist)} />
                  <Row label="album" value={formatValue(metadata.common.album)} />
                  <Row
                    label="genre"
                    value={formatValue(metadata.common.genre)}
                    highlight
                  />
                  <Row label="year" value={formatValue(metadata.common.year)} />
                  <Row label="track" value={formatValue(metadata.common.track)} />
                  <Row label="albumartist" value={formatValue(metadata.common.albumartist)} />
                  <Row label="composer" value={formatValue(metadata.common.composer)} />
                  <Row label="bpm" value={formatValue(metadata.common.bpm)} />
                  <Row label="key" value={formatValue(metadata.common.key)} />
                </div>
              </Section>

              {/* Native Tags by Format */}
              {metadata.nativeFormats.map((format) => (
                <Section
                  key={format}
                  title={`Native Tags: ${format} (${metadata.tags[format]?.length || 0} tags)`}
                  expanded={expandedSections.has(format)}
                  onToggle={() => toggleSection(format)}
                >
                  <div className="space-y-1 text-sm font-mono">
                    {metadata.tags[format]?.map((tag, idx) => (
                      <Row
                        key={`${tag.id}-${idx}`}
                        label={tag.id}
                        value={formatValue(tag.value)}
                        highlight={isGenreRelated(tag.id, tag.value)}
                      />
                    ))}
                    {(!metadata.tags[format] || metadata.tags[format].length === 0) && (
                      <div className="text-muted-foreground italic">No tags in this format</div>
                    )}
                  </div>
                </Section>
              ))}

              {metadata.nativeFormats.length === 0 && (
                <div className="text-muted-foreground text-center py-4">
                  No native tag formats found in this file
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border rounded-lg">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0" />
        )}
        <span className="font-medium text-sm">{title}</span>
      </button>
      {expanded && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

function Row({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground w-24 shrink-0">{label}:</span>
      <span
        className={`break-all ${
          highlight ? 'text-yellow-600 dark:text-yellow-400 font-medium' : ''
        }`}
      >
        {value}
        {highlight && value !== '(none found)' && value !== '(empty)' && (
          <Badge variant="outline" className="ml-2 text-xs">
            genre
          </Badge>
        )}
      </span>
    </div>
  );
}
