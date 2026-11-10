import React, { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Music, FolderOpen } from 'lucide-react';
import MissingTracksAnalyzer from '@/components/MissingTracksAnalyzer';
import { DownloadProcessingSection } from '@/components/DownloadProcessingSection';
import { TrackMatchingService } from '@/services/trackMatching.service';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';

interface SyncAnalysisProps {
  sharedSearchQuery?: string;
  sharedSuperGenre?: string;
}

const SyncAnalysis = ({ sharedSearchQuery = '', sharedSuperGenre = '' }: SyncAnalysisProps) => {
  const [user, setUser] = useState<User | null>(null);
  const [superGenres, setSuperGenres] = useState<string[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<string>('all');

  // Use shared supergenre if set, otherwise use local selection
  const effectiveGenre = sharedSuperGenre || selectedGenre;

  // Get user and load super genres on mount
  useEffect(() => {
    const loadData = async () => {
      const {
        data: {
          user
        }
      } = await supabase.auth.getUser();
      setUser(user);
      if (user) {
        try {
          const genres = await TrackMatchingService.fetchSuperGenres(user.id);
          setSuperGenres(genres);
        } catch (error) {
          console.error('Failed to fetch super genres:', error);
        }
      }
    };
    loadData();
  }, []);

  return (
    <Tabs defaultValue="missing" className="space-y-6">
      <TabsList>
        <TabsTrigger value="missing" className="flex items-center gap-2">
          <Music className="h-4 w-4" />
          Missing Tracks
        </TabsTrigger>
        <TabsTrigger value="downloads" className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4" />
          Process Downloads
        </TabsTrigger>
      </TabsList>

      <TabsContent value="missing" className="space-y-6">
        <MissingTracksAnalyzer
          selectedGenre={effectiveGenre}
          setSelectedGenre={setSelectedGenre}
          superGenres={superGenres}
          sharedSearchQuery={sharedSearchQuery}
        />
      </TabsContent>

      <TabsContent value="downloads">
        <DownloadProcessingSection />
      </TabsContent>
    </Tabs>
  );
};
export default SyncAnalysis;