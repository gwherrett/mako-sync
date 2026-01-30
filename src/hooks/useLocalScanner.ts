import React, { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { scanDirectoryForLocalFiles } from '@/services/fileScanner';
import { extractMetadataBatch } from '@/services/metadataExtractor';
import { withTimeout } from '@/utils/promiseUtils';

const DB_UPSERT_TIMEOUT_MS = 60000; // 60 seconds per batch (shorter timeout, more retries)
const BATCH_SIZE = 25; // Files per DB batch (sequential processing prevents API exhaustion)
const MAX_RETRIES = 3; // More retries to handle token refresh interruptions
const WARMUP_TIMEOUT_MS = 30000; // 30 seconds for warmup query
const BATCH_DELAY_MS = 500; // Delay between batches to allow browser cleanup
const RETRY_DELAY_MS = 3000; // Wait before retry to allow token refresh to complete

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

    try {
      // Scan directory for local files
      const localFiles = await scanDirectoryForLocalFiles();

      toast({
        title: "Scan Started",
        description: `Found ${localFiles.length} local files. Processing in batches...`,
      });

      setScanProgress({ current: 0, total: localFiles.length });

      // Warmup database connection before starting batches
      console.log('🔥 Warming up database connection...');
      const warmupStart = Date.now();
      try {
        const warmupResult = await withTimeout(
          Promise.resolve(supabase.from('local_mp3s').select('hash').limit(1)),
          WARMUP_TIMEOUT_MS,
          'Database warmup query timed out'
        );
        const warmupTime = Date.now() - warmupStart;
        if (warmupResult.error) {
          console.warn('⚠️ Warmup query returned error:', warmupResult.error);
        } else {
          console.log(`✅ Database connection warmed up in ${warmupTime}ms`);
        }
      } catch (warmupErr) {
        console.warn('⚠️ Warmup failed, proceeding anyway:', warmupErr);
      }

      // Import normalization service once
      const { NormalizationService } = await import('@/services/normalization.service');
      const normalizer = new NormalizationService();

      const totalBatches = Math.ceil(localFiles.length / BATCH_SIZE);
      let processedCount = 0;
      let insertedCount = 0;

      console.log(`📊 Processing ${localFiles.length} files in ${totalBatches} batches of ${BATCH_SIZE}`);

      // Process files in batches: extract metadata then insert immediately
      for (let i = 0; i < localFiles.length; i += BATCH_SIZE) {
        const fileBatch = localFiles.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;

        // Log every 10 batches to reduce console noise
        if (batchNumber % 10 === 1 || batchNumber === totalBatches) {
          console.log(`📦 Batch ${batchNumber}/${totalBatches}: Processing...`);
        }

        // Extract metadata for this batch
        const scannedTracks = await extractMetadataBatch(
          fileBatch,
          (current, _total) => {
            // Update progress relative to overall file count
            setScanProgress({ current: i + current, total: localFiles.length });
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

              // Verify session is valid before retry
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

      console.log(`✅ All batches complete: ${processedCount} files processed, ${insertedCount} tracks inserted`);
      toast({
        title: "Scan Complete",
        description: `Successfully scanned ${processedCount} local files.`,
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
