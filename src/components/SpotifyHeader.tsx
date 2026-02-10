
import React from 'react';
import { Settings, Loader2, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import BrandLogo from '@/components/BrandLogo';
import { useUnifiedSpotifyAuth } from '@/hooks/useUnifiedSpotifyAuth';
import { useAuth } from '@/contexts/NewAuthContext';

const SpotifyHeader = () => {
  const { isConnected, isLoading, isSyncing, connectSpotify, syncLikedSongs } = useUnifiedSpotifyAuth();
  const { user, signOut } = useAuth();

  return (
    <header className="bg-spotify-dark border-b border-white/10 p-4">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <BrandLogo size={40} />
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-white">Spotify Metadata Sync</h1>
            <p className="text-xs sm:text-sm text-gray-400">
              Extract & sync your liked songs for Serato
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto">
          <div className="text-sm text-gray-400 hidden md:block">
            Welcome, {user?.email}
          </div>

          <Button variant="outline" size="sm" className="text-white border-white/20 hover:bg-white/10 min-h-[44px] sm:min-h-0">
            <Settings className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Settings</span>
          </Button>

          {isLoading ? (
            <Button disabled className="spotify-gradient text-black font-medium min-h-[44px] sm:min-h-0">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Checking...
            </Button>
          ) : isConnected ? (
            <Button
              onClick={() => syncLikedSongs(false)}
              disabled={isSyncing}
              className="bg-green-600 hover:bg-green-700 text-white font-bold px-4 sm:px-6 py-2 transition-colors shadow-lg min-h-[44px] sm:min-h-0"
            >
              {isSyncing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Syncing...
                </>
              ) : (
                'Sync Liked Songs'
              )}
            </Button>
          ) : (
            <Button
              onClick={connectSpotify}
              className="spotify-gradient text-black font-medium hover:opacity-90 transition-opacity min-h-[44px] sm:min-h-0"
            >
              Connect Spotify
            </Button>
          )}

          <Button
            onClick={signOut}
            variant="outline"
            size="sm"
            className="text-white border-white/20 hover:bg-white/10 min-h-[44px] sm:min-h-0"
          >
            <LogOut className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Sign Out</span>
          </Button>
        </div>
      </div>
    </header>
  );
};

export default SpotifyHeader;
