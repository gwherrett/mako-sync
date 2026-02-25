import React, { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { scanDirectoryForLocalFiles } from '@/services/fileScanner';
import { extractMetadataBatch } from '@/services/metadataExtractor';
import { withTimeout } from '@/utils/promiseUtils';
import { generateFileHash } from '@/utils/fileHash';

const DB_UPSERT_TIMEOUT_MS = 60000; // 60 seconds per batch (shorter timeout, more retries)
const BATCH_SIZE = 25; // Files per DB batch (sequential processing prevents API exhaustion)
const MAX_RETRIES = 3; // More retries to handle token refresh interruptions
const WARMUP_TIMEOUT_MS = 30000; // 30 seconds for warmup query
const BATCH_DELAY_MS = 500; // Delay between batches to allow browser cleanup
const RETRY_DELAY_MS = 3000; // Wait before retry to allow token refresh to complete
const HASH_PAGE_SIZE = 1000; // Supabase max rows per query

export const useLocalScanner = (onScanComplete?: () => void) => {
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
  const { toast } = useToast();
  const [user, setUser] = useState<any>(null);

  // Get user on mount
  React.useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user));
  }, []);

  const scanLocalFiles = async () => {
    console.log('🎯 SCAN STARTED: scanLocalFiles function called');

    if (!user) {
      console.log('❌ No user found, aborting scan');
      toast({
        title: "Authentication Required",
        description: "Please sign in to scan local files.",
        variant: "destructive",
      });
      return;
    }

    console.log('✅ All checks passed, proceeding with scan');
    setIsScanning(true);
    setScanProgress({ current: 0, total: 0 });

    // Detect token refreshes mid-scan so we can pause before the next upsert
    // rather than letting the in-flight request hang and timeout.
    let tokenRefreshPending = false;
    const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'TOKEN_REFRESHED') {
        tokenRefreshPending = true;
        console.log('🔑 Token refreshed mid-scan, will pause before next batch');
      }
    });

    try {
      // Scan directory for local files
      const localFiles = await scanDirectoryForLocalFiles();

      toast({
        title: "Scan Started",
        description: `Found ${localFiles.length} local files. Processing in batches...`,
      });

      setScanProgress({ current: 0, total: localFiles.length });

      // Load all existing hashes for this user — used to skip unchanged files on rescan.
      // Pages through results to work around Supabase's 1000-row limit.
      console.log('🔥 Loading existing hashes from database...');
      const existingHashes = new Set<string>();
      const hashLoadStart = Date.now();
      try {
        let page = 0;
        let hasMore = true;
        while (hasMore) {
          const result = await withTimeout(
            supabase
              .from('local_mp3s')
              .select('hash')
              .eq('user_id', user.id)
              .not('hash', 'is', null)
              .range(page * HASH_PAGE_SIZE, (page + 1) * HASH_PAGE_SIZE - 1),
            WARMUP_TIMEOUT_MS,
            'Hash load query timed out'
          );
          if (result.error) {
            console.warn('⚠️ Hash load returned error:', result.error);
            break;
          }
          (result.data ?? []).forEach((row: { hash: string }) => existingHashes.add(row.hash));
          hasMore = (result.data?.length ?? 0) === HASH_PAGE_SIZE;
          page++;
        }
        console.log(`✅ Loaded ${existingHashes.size} existing hashes in ${Date.now() - hashLoadStart}ms`);
      } catch (hashLoadErr) {
        console.warn('⚠️ Hash load failed, proceeding without skip logic:', hashLoadErr);
      }

      // Import normalization service once
      const { NormalizationService } = await import('@/services/normalization.service');
      const normalizer = new NormalizationService();

      const totalBatches = Math.ceil(localFiles.length / BATCH_SIZE);
      let processedCount = 0;
      let insertedCount = 0;
      let skippedCount = 0;

      console.log(`📊 Processing ${localFiles.length} files in ${totalBatches} batches of ${BATCH_SIZE} (${existingHashes.size} already in DB)`);

      // Process files in batches: extract metadata then insert immediately
      for (let i = 0; i < localFiles.length; i += BATCH_SIZE) {
        const fileBatch = localFiles.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;

        // Log every 10 batches to reduce console noise
        if (batchNumber % 10 === 1 || batchNumber === totalBatches) {
          console.log(`📦 Batch ${batchNumber}/${totalBatches}: Processing...`);
        }

        // Hash files first to skip ones already in the DB.
        // generateFileHash reads the full file (same I/O as parseBlob) but is much
        // faster — skipping the metadata parse for unchanged files saves significant time.
        const newFiles: File[] = [];
        for (const file of fileBatch) {
          const hash = await generateFileHash(file);
          if (existingHashes.has(hash)) {
            skippedCount++;
          } else {
            newFiles.push(file);
          }
        }

        // Advance progress for skipped files
        setScanProgress({ current: i + fileBatch.length, total: localFiles.length });

        if (newFiles.length === 0) {
          continue; // entire batch already in DB
        }

        // Extract metadata only for new/changed files
        const scannedTracks = await extractMetadataBatch(
          newFiles,
          (current, _total) => {
            setScanProgress({ current: i + (fileBatch.length - newFiles.length) + current, total: localFiles.length });
          }
        );

        processedCount += scannedTracks.length;

        // Normalize and add user_id
        const tracksWithUserId = scannedTracks.map(track => {
          const normalized = normalizer.processMetadata(track.title, track.artist);
          return {
            ...track,
            user_id: user.id,
            normalized_title: normalized.normalizedTitle,
            normalized_artist: normalized.normalizedArtist,
            core_title: normalized.coreTitle,
            primary_artist: normalized.primaryArtist,
            featured_artists: normalized.featuredArtists,
            mix: normalized.mix,
          };
        });

        // Deduplicate by hash within this batch
        const uniqueTracks = tracksWithUserId.filter((track, index, self) => {
          if (!track.hash) return true;
          return self.findIndex(t => t.hash === track.hash) === index;
        });

        // Only log insert details on error or every 10 batches

        // If a token refresh fired since the last batch, pause to let it settle
        // before issuing the next upsert. This prevents the request from going
        // out with a briefly-invalid token and hanging for 60 seconds.
        if (tokenRefreshPending) {
          console.log('⏸️ Pausing 2s for token refresh to settle...');
          await new Promise(resolve => setTimeout(resolve, 2000));
          tokenRefreshPending = false;
        }

        // Insert this batch into database with retry logic
        // Handles token refresh interruptions by waiting and retrying
        let lastError: any = null;
        let success = false;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            if (attempt > 0) {
              // Wait longer on retry to allow token refresh to complete
              console.log(`🔄 Retry attempt ${attempt} for batch ${batchNumber} (waiting ${RETRY_DELAY_MS}ms)...`);
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));

              // Always verify session on retry — a timeout may have been caused by a
              // mid-flight token refresh, which doesn't produce an auth error code.
              const { data: { session } } = await supabase.auth.getSession();
              if (!session) {
                console.warn(`⚠️ No session on retry attempt ${attempt}, waiting for auth...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
              }
            }

            const result = await withTimeout(
              supabase
                .from('local_mp3s')
                .upsert(uniqueTracks, {
                  onConflict: 'hash',
                  ignoreDuplicates: false
                }),
              DB_UPSERT_TIMEOUT_MS,
              `Database upsert batch ${batchNumber} timed out after ${DB_UPSERT_TIMEOUT_MS / 1000}s`
            );

            if (result.error) {
              throw result.error;
            }

            success = true;
            break;
          } catch (err: any) {
            lastError = err;
            const isTimeout = err?.message?.includes('timed out');
            const isAuthError = err?.message?.includes('JWT') || err?.code === 'PGRST301';

            if (isTimeout || isAuthError) {
              console.warn(`⚠️ Batch ${batchNumber} attempt ${attempt + 1} failed (${isTimeout ? 'timeout' : 'auth'}), will retry...`);
            } else {
              console.warn(`⚠️ Batch ${batchNumber} attempt ${attempt + 1} failed:`, err?.message || err);
            }
          }
        }

        if (!success) {
          console.error(`❌ Database insertion error (batch ${batchNumber}) after ${MAX_RETRIES + 1} attempts:`, lastError);
          throw lastError;
        }

        insertedCount += uniqueTracks.length;

        // Log progress every 10 batches
        if (batchNumber % 10 === 0 || batchNumber === totalBatches) {
          console.log(`✅ Progress: ${batchNumber}/${totalBatches} batches (${insertedCount} tracks inserted)`);
        }

        // Delay between batches to avoid rate limits
        if (i + BATCH_SIZE < localFiles.length) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }

      console.log(`✅ All batches complete: ${processedCount} new files processed, ${insertedCount} tracks inserted, ${skippedCount} unchanged files skipped`);
      const description = skippedCount > 0
        ? `${processedCount} new files added, ${skippedCount} unchanged files skipped.`
        : `Successfully scanned ${processedCount} local files.`;
      toast({
        title: "Scan Complete",
        description,
      });

      // Trigger refresh callback
      if (onScanComplete) {
        onScanComplete();
      }

    } catch (error: any) {
      console.error('❌ Scan error:', error);
      toast({
        title: "Scan Failed",
        description: error.message || "Failed to scan local files.",
        variant: "destructive",
      });
    } finally {
      authSubscription.unsubscribe();
      console.log('🏁 Scan process finished, cleaning up...');
      setIsScanning(false);
      setScanProgress({ current: 0, total: 0 });
    }
  };

  return {
    isScanning,
    scanLocalFiles,
    scanProgress,
  };
};
