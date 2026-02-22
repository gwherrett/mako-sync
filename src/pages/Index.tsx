import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Database, Search, Sparkles, Download } from 'lucide-react';
import LibraryHeader from '@/components/LibraryHeader';
import { StatsOverview } from '@/components/StatsOverview';
import SetupChecklist from '@/components/SetupChecklist';
import TracksTable from '@/components/TracksTable';
import LocalTracksTable from '@/components/LocalTracksTable';
import FileUploadScanner from '@/components/FileUploadScanner';
import SpotifySyncButton from '@/components/SpotifySyncButton';
import MissingTracksAnalyzer from '@/components/MissingTracksAnalyzer';
import { DownloadProcessingSection } from '@/components/DownloadProcessingSection';
import { TrackLevelProcessor } from '@/components/NoGenreTracks/TrackLevelProcessor';
import { TrackMatchingService } from '@/services/trackMatching.service';
import { GenreMappingService } from '@/services/genreMapping.service';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/NewAuthContext';
import { withQueryTimeout } from '@/utils/supabaseQuery';

interface SpotifyTrack {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  genre: string | null;
  super_genre: string | null;
  bpm: number | null;
  key: string | null;
  danceability: number | null;
  year: number | null;
  added_at: string | null;
  spotify_id: string;
  mix: string | null;
}

interface LocalTrack {
  id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  year: number | null;
  bpm: number | null;
  key: string | null;
  bitrate: number | null;
  file_path: string;
  file_size: number | null;
  last_modified: string | null;
  created_at: string | null;
  hash: string | null;
  rating: number | null;
  play_count: number | null;
  mix: string | null;
}

const Index = () => {
  const [searchParams] = useSearchParams();
  const [selectedTrack, setSelectedTrack] = useState<SpotifyTrack | null>(null);
  const [selectedLocalTrack, setSelectedLocalTrack] = useState<LocalTrack | null>(null);
  const [isDashboardCollapsed, setIsDashboardCollapsed] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Get initial tab from URL query param or default to 'spotify'
  const initialTab = searchParams.get('tab') || 'spotify';
  const [activeTab, setActiveTab] = useState(initialTab);

  // State for MissingTracksAnalyzer
  const [superGenres, setSuperGenres] = useState<string[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<string>('all');
  const [user, setUser] = useState<any>(null);

  // Tab badge counts
  const { initialDataReady } = useAuth();
  const [spotifyCount, setSpotifyCount] = useState<number | null>(null);
  const [localCount, setLocalCount] = useState<number | null>(null);
  const [noGenreCount, setNoGenreCount] = useState<number | null>(null);

  // Update active tab when URL query param changes
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam && ['spotify', 'local', 'missing', 'nogenre', 'downloads'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  // Load user and super genres for Missing Tracks tab
  useEffect(() => {
    const loadData = async () => {
      const { data: { user } } = await supabase.auth.getUser();
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

  // Fetch tab badge counts
  useEffect(() => {
    if (!initialDataReady) return;

    const fetchCounts = async () => {
      try {
        // Fetch Spotify count
        const spotifyResult = await withQueryTimeout(
          async (signal) => supabase
            .from('spotify_liked')
            .select('*', { count: 'exact' })
            .range(0, 0)
            .abortSignal(signal),
          10000,
          'Index:spotifyCount'
        );
        if (spotifyResult.data) {
          setSpotifyCount(spotifyResult.data.count || 0);
        }

        // Fetch Local count
        const localResult = await withQueryTimeout(
          async (signal) => supabase
            .from('local_mp3s')
            .select('*', { count: 'exact' })
            .range(0, 0)
            .abortSignal(signal),
          10000,
          'Index:localCount'
        );
        if (localResult.data) {
          setLocalCount(localResult.data.count || 0);
        }

        // Fetch No Genre count
        const noGenre = await GenreMappingService.getNoGenreCount();
        setNoGenreCount(noGenre);
      } catch (error) {
        console.error('Failed to fetch tab counts:', error);
      }
    };

    fetchCounts();

    // Set up realtime subscription for count updates
    const channel = supabase
      .channel('tab-count-updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'spotify_liked' },
        () => fetchCounts()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'local_mp3s' },
        () => fetchCounts()
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [initialDataReady]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-expos-dark via-expos-dark-elevated to-black">
      <LibraryHeader 
        isDashboardCollapsed={isDashboardCollapsed}
        onToggleDashboard={() => setIsDashboardCollapsed(!isDashboardCollapsed)}
      />
      
      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Collapsible Dashboard Section */}
        {!isDashboardCollapsed && (
          <div className="mb-8">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-in fade-in slide-in-from-top-2 duration-300">
              {/* Stats Cards - Left Column */}
              <div className="lg:col-span-4">
                <StatsOverview />
              </div>
              
              {/* Setup Checklist - Right Column */}
              <div className="lg:col-span-8">
                <SetupChecklist />
              </div>
            </div>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-5 mb-8">
            {/* Tab 1: Spotify Sync - Priority 1 */}
            <TabsTrigger value="spotify" className="gap-1 sm:gap-2 px-1 sm:px-3">
              <svg viewBox="0 0 24 24" className="w-4 h-4 flex-shrink-0" fill="currentColor">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
              </svg>
              <span className="hidden sm:inline truncate">Spotify</span>
              {spotifyCount !== null && spotifyCount > 0 && (
                <Badge variant="secondary" className="hidden md:inline-flex ml-1 h-5 px-1.5 text-xs">
                  {spotifyCount.toLocaleString()}
                </Badge>
              )}
            </TabsTrigger>
            {/* Tab 2: Local Files - Priority 2 */}
            <TabsTrigger value="local" className="gap-1 sm:gap-2 px-1 sm:px-3">
              <Database className="w-4 h-4 flex-shrink-0" />
              <span className="hidden sm:inline truncate">Local</span>
              {localCount !== null && localCount > 0 && (
                <Badge variant="secondary" className="hidden md:inline-flex ml-1 h-5 px-1.5 text-xs">
                  {localCount.toLocaleString()}
                </Badge>
              )}
            </TabsTrigger>
            {/* Tab 3: Missing Tracks - Priority 3 */}
            <TabsTrigger value="missing" className="gap-1 sm:gap-2 px-1 sm:px-3">
              <Search className="w-4 h-4 flex-shrink-0" />
              <span className="hidden sm:inline truncate">Missing</span>
            </TabsTrigger>
            {/* Tab 4: No Genre Tracks - Priority 4 */}
            <TabsTrigger value="nogenre" className="gap-1 sm:gap-2 px-1 sm:px-3">
              <Sparkles className="w-4 h-4 flex-shrink-0" />
              <span className="hidden sm:inline truncate">No Genre</span>
              {noGenreCount !== null && noGenreCount > 0 && (
                <Badge variant="secondary" className="hidden md:inline-flex ml-1 h-5 px-1.5 text-xs">
                  {noGenreCount.toLocaleString()}
                </Badge>
              )}
            </TabsTrigger>
            {/* Tab 5: Process Downloads - Priority 5 */}
            <TabsTrigger value="downloads" className="gap-1 sm:gap-2 px-1 sm:px-3">
              <Download className="w-4 h-4 flex-shrink-0" />
              <span className="hidden sm:inline truncate">Downloads</span>
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="spotify" className="space-y-8">
            <SpotifySyncButton />
            <TracksTable
              onTrackSelect={setSelectedTrack}
              selectedTrack={selectedTrack}
            />
            {selectedTrack && (
              <div className="bg-expos-dark-elevated/30 rounded-lg border border-expos-blue/20 p-6">
                <h3 className="text-xl font-semibold text-white mb-4">Track Details</h3>
                <div className="p-4 bg-expos-dark-elevated/50 rounded-lg border border-expos-blue/10">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h4 className="font-semibold text-white text-lg">{selectedTrack.title}</h4>
                      <p className="text-gray-300">{selectedTrack.artist} • {selectedTrack.album || 'Unknown Album'}</p>
                      {selectedTrack.genre && (
                        <p className="text-purple-400 text-sm">{selectedTrack.genre}</p>
                      )}
                    </div>
                    <button 
                      className="text-expos-blue hover:text-expos-blue/80 transition-colors"
                      onClick={() => {
                        window.open(
                          `https://open.spotify.com/track/${selectedTrack.spotify_id}`, 
                          'spotify-track'
                        );
                      }}
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                    <div>
                      <span className="text-xs text-gray-400 block">BPM</span>
                      <span className="text-sm text-expos-blue font-semibold">
                        {selectedTrack.bpm ? Math.round(selectedTrack.bpm) : 'Unknown'}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-gray-400 block">Key</span>
                      <span className="text-sm text-expos-blue font-semibold">
                        {selectedTrack.key ? (() => {
                          const keys = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
                          const keyNum = parseInt(selectedTrack.key);
                          return keys[keyNum] || 'Unknown';
                        })() : 'Unknown'}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-gray-400 block">Year</span>
                      <span className="text-sm text-white">{selectedTrack.year || 'Unknown'}</span>
                    </div>
                    <div>
                      <span className="text-xs text-gray-400 block">Added</span>
                      <span className="text-sm text-white">
                        {selectedTrack.added_at ? new Date(selectedTrack.added_at).toLocaleDateString() : 'Unknown'}
                      </span>
                    </div>
                  </div>

                  <div className="flex space-x-2">
                    {selectedTrack.danceability && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-expos-blue/10 text-expos-blue border border-expos-blue/30">
                        Danceability: {(selectedTrack.danceability * 100).toFixed(0)}%
                      </span>
                    )}
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-expos-red/10 text-expos-red border border-expos-red/30">
                      Spotify Track
                    </span>
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          {/* Tab 2: Local Files */}
          <TabsContent value="local" className="space-y-8">
            <FileUploadScanner onScanComplete={() => setRefreshTrigger(prev => prev + 1)} />
            <LocalTracksTable
              onTrackSelect={setSelectedLocalTrack}
              selectedTrack={selectedLocalTrack}
              refreshTrigger={refreshTrigger}
              isActive={activeTab === 'local'}
            />
            {selectedLocalTrack && (
              <div className="bg-expos-dark-elevated/30 rounded-lg border border-expos-blue/20 p-6">
                <h3 className="text-xl font-semibold text-white mb-4">Local Track Details</h3>
                <div className="p-4 bg-expos-dark-elevated/50 rounded-lg border border-expos-blue/10">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h4 className="font-semibold text-white text-lg">
                        {selectedLocalTrack.title || selectedLocalTrack.file_path.split('/').pop()}
                      </h4>
                      <p className="text-gray-300">
                        {selectedLocalTrack.artist || 'Unknown Artist'} • {selectedLocalTrack.album || 'Unknown Album'}
                      </p>
                      <p className="text-xs text-gray-400 mt-1" title={selectedLocalTrack.file_path}>
                        {selectedLocalTrack.file_path}
                      </p>
                    </div>
                  </div>

                   <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                     <div>
                       <span className="text-xs text-gray-400 block">BPM</span>
                       <span className="text-sm text-expos-blue font-semibold">
                         {selectedLocalTrack.bpm || 'Unknown'}
                       </span>
                     </div>
                     <div>
                       <span className="text-xs text-gray-400 block">Key</span>
                       <span className="text-sm text-expos-blue font-semibold">
                         {selectedLocalTrack.key || 'Unknown'}
                       </span>
                     </div>
                     <div>
                       <span className="text-xs text-gray-400 block">Bitrate</span>
                       <span className="text-sm text-white">
                         {selectedLocalTrack.bitrate || 'Unknown'}
                       </span>
                     </div>
                     <div>
                       <span className="text-xs text-gray-400 block">Genre</span>
                       <span className="text-sm text-expos-blue font-semibold">
                         {selectedLocalTrack.genre || 'Unknown'}
                       </span>
                     </div>
                   </div>

                   <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-3">
                     <div>
                       <span className="text-xs text-gray-400 block">Year</span>
                       <span className="text-sm text-white">{selectedLocalTrack.year || 'Unknown'}</span>
                     </div>
                     <div>
                       <span className="text-xs text-gray-400 block">File Size</span>
                       <span className="text-sm text-white">
                         {selectedLocalTrack.file_size ?
                           `${(selectedLocalTrack.file_size / (1024 * 1024)).toFixed(1)} MB` : 'Unknown'}
                       </span>
                     </div>
                     <div>
                       <span className="text-xs text-gray-400 block">Last Modified</span>
                       <span className="text-sm text-white">
                         {selectedLocalTrack.last_modified ?
                           new Date(selectedLocalTrack.last_modified).toLocaleDateString() : 'Unknown'}
                       </span>
                     </div>
                   </div>

                  <div className="flex space-x-2">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-expos-red/10 text-expos-red border border-expos-red/30">
                      Local File
                    </span>
                    {selectedLocalTrack.hash && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/30">
                        Hashed
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          {/* Tab 3: Missing Tracks */}
          <TabsContent value="missing" className="space-y-6">
            <MissingTracksAnalyzer
              selectedGenre={selectedGenre}
              setSelectedGenre={setSelectedGenre}
              superGenres={superGenres}
            />
          </TabsContent>

          {/* Tab 4: No Genre Tracks */}
          <TabsContent value="nogenre">
            <TrackLevelProcessor />
          </TabsContent>

          {/* Tab 5: Process Downloads */}
          <TabsContent value="downloads">
            <DownloadProcessingSection />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Index;