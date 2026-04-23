import React from 'react';
import { useUnifiedSpotifyAuth } from '@/hooks/useUnifiedSpotifyAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { CheckCircle, Play, Disc, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDiscogsAuth } from '@/hooks/useDiscogsAuth';

interface ChecklistItem {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  completed: boolean;
  action?: () => void;
  actionLabel?: string;
  loading?: boolean;
}

const SetupChecklist: React.FC = () => {
  const { isConnected: isDiscogsConnected, connectDiscogs, isConnecting: isDiscogsConnecting } = useDiscogsAuth();
  const { isConnected, connectSpotify } = useUnifiedSpotifyAuth();

  const checklist: ChecklistItem[] = [
    {
      id: 'discogs-connected',
      title: 'Connect Discogs Account',
      description: 'Link your Discogs to sync your vinyl collection',
      icon: <Disc className="w-5 h-5" />,
      completed: isDiscogsConnected,
      action: connectDiscogs,
      actionLabel: 'Connect Discogs',
      loading: isDiscogsConnecting,
    },
    {
      id: 'spotify-connected',
      title: 'Connect Spotify Account',
      description: 'Link your Spotify to sync liked songs',
      icon: <Play className="w-5 h-5" />,
      completed: isConnected,
      action: connectSpotify,
      actionLabel: 'Connect Spotify',
    },
  ];

  const completedItems = checklist.filter(item => item.completed).length;
  const totalItems = checklist.length;
  const progress = (completedItems / totalItems) * 100;

  const isSetupComplete = completedItems === totalItems;

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Setup Progress</CardTitle>
            <CardDescription>
              {isSetupComplete 
                ? 'Setup complete! You can now use all features.'
                : 'Complete these steps to get the most out of Mako Sync'
              }
            </CardDescription>
          </div>
          <div className="text-right">
            <div className="text-sm text-muted-foreground mb-1">
              {completedItems} of {totalItems} completed
            </div>
            <Progress value={progress} className="w-24" />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {checklist.map((item) => (
          <div
            key={item.id}
            className={cn(
              'flex items-center justify-between p-3 rounded-lg border transition-colors',
              item.completed
                ? 'bg-green-500/10 border-green-500/20'
                : 'bg-muted/50 border-border hover:bg-muted/80'
            )}
          >
            <div className="flex items-center space-x-3">
              <div className={cn(
                'flex items-center justify-center w-8 h-8 rounded-full',
                item.completed
                  ? 'bg-green-500 text-white'
                  : 'bg-muted text-muted-foreground'
              )}>
                {item.completed ? (
                  <CheckCircle className="w-4 h-4" />
                ) : (
                  item.icon
                )}
              </div>
              
              <div className="flex-1">
                <h4 className="font-medium text-foreground">
                  {item.title}
                </h4>
                <p className="text-sm text-muted-foreground">
                  {item.description}
                </p>
              </div>
            </div>

            {!item.completed && item.action && (
              <Button
                size="sm"
                onClick={item.action}
                disabled={item.loading}
                className="ml-4"
              >
                {item.loading ? 'Connecting...' : item.actionLabel}
                <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
            )}
          </div>
        ))}

        {isSetupComplete && (
          <div className="mt-6 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
            <div className="flex items-center space-x-2 text-green-400">
              <CheckCircle className="w-5 h-5" />
              <span className="font-medium">Setup Complete!</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              You're all set to start syncing and organizing your music library.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default SetupChecklist;