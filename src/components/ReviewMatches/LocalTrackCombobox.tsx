import React, { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import type { LocalTrack } from '@/services/trackMatchingEngine';
import { PICKER_RESULT_LIMIT, searchLocalTracks } from './reviewQueue.utils';

interface LocalTrackComboboxProps {
  /** The button that opens the picker. */
  children: React.ReactElement;
  /** Local files already loaded for the review session. Searched on the client. */
  localTracks: LocalTrack[];
  /** Files to leave out: ones already rejected for this track. */
  excludeIds?: string[];
  /** Files by this artist are listed first. */
  preferredArtist?: string | null;
  onSelect: (track: LocalTrack) => void;
}

/** Search-and-pick for a local file. Picking one commits straight away. */
export function LocalTrackCombobox({
  children,
  localTracks,
  excludeIds,
  preferredArtist,
  onSelect,
}: LocalTrackComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const results = useMemo(
    () => (open ? searchLocalTracks(localTracks, query, { excludeIds, preferredArtist }) : []),
    [open, localTracks, query, excludeIds, preferredArtist]
  );

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery('');
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-[420px] max-w-[90vw] p-0" align="end">
        {/* The list is filtered by searchLocalTracks, so cmdk's own filter is off. */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search local files by title or artist..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No local file found.</CommandEmpty>
            <CommandGroup>
              {results.map(track => (
                <CommandItem
                  key={track.id}
                  value={track.id}
                  onSelect={() => {
                    onSelect(track);
                    handleOpenChange(false);
                  }}
                  className="flex flex-col items-start gap-0.5"
                >
                  <span className="font-medium">
                    {track.title || 'Untitled'}
                    <span className="font-normal text-muted-foreground"> · {track.artist || 'Unknown artist'}</span>
                  </span>
                  <span className="w-full truncate text-xs text-muted-foreground">{track.file_path}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            {results.length === PICKER_RESULT_LIMIT && (
              <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                Showing the first {PICKER_RESULT_LIMIT} files. Type to narrow the list.
              </p>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
