import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Shield,
  CheckCircle,
  XCircle,
  RefreshCw,
  Lock,
  Calendar,
  Activity
} from 'lucide-react';
import { useUnifiedSpotifyAuth } from '@/hooks/useUnifiedSpotifyAuth';
import { cn } from '@/lib/utils';

interface SecurityDashboardProps {
  className?: string;
  showDetailedMetrics?: boolean;
}

export const SpotifySecurityDashboard = ({
  className,
  showDetailedMetrics = true
}: SecurityDashboardProps) => {
  const { connection, isConnected, isLoading } = useUnifiedSpotifyAuth();

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getTokenStatus = () => {
    if (!connection) return { status: 'disconnected', color: 'destructive', icon: XCircle };
    // expires_at reflects the last-recorded access token expiry. Access tokens are
    // short-lived (1 hour) and refreshed automatically by edge functions — an
    // in-the-past expires_at does not mean the connection is broken.
    if (isConnected) return { status: 'connected', color: 'default', icon: CheckCircle };
    return { status: 'disconnected', color: 'destructive', icon: XCircle };
  };

  const tokenStatus = getTokenStatus();
  const StatusIcon = tokenStatus.icon;

  if (isLoading) {
    return (
      <Card className={cn('w-full', className)}>
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Loading security dashboard...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!isConnected) {
    return (
      <Card className={cn('w-full', className)}>
        <CardContent className="pt-6">
          <div className="text-center space-y-3">
            <Shield className="h-12 w-12 text-muted-foreground mx-auto" />
            <div>
              <h3 className="font-medium">No Spotify Connection</h3>
              <p className="text-sm text-muted-foreground">
                Connect your Spotify account to view security information
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-blue-500" />
          <div>
            <CardTitle>Security Overview</CardTitle>
            <CardDescription>
              Basic security information for your Spotify connection
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Connection Status */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Token Status</p>
                  <p className="text-lg font-semibold capitalize">
                    {tokenStatus.status}
                  </p>
                </div>
                <StatusIcon className={cn(
                  'h-8 w-8',
                  tokenStatus.color === 'destructive' && 'text-red-500',
                  tokenStatus.color === 'secondary' && 'text-yellow-500',
                  tokenStatus.color === 'default' && 'text-green-500'
                )} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Token Storage</p>
                  <p className="text-lg font-semibold">Encrypted</p>
                </div>
                <Lock className="h-8 w-8 text-green-500" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Connection Details */}
        {connection && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Connection Details</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  <span>Connected</span>
                </div>
                <div className="pl-6">
                  <span>{formatDate(connection.created_at)}</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Activity className="h-4 w-4" />
                  <span>Last Updated</span>
                </div>
                <div className="pl-6">
                  <span>{formatDate(connection.updated_at || connection.created_at)}</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <RefreshCw className="h-4 w-4" />
                  <span>Token Last Refreshed</span>
                </div>
                <div className="pl-6">
                  <span>{formatDate(connection.expires_at)}</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Lock className="h-4 w-4" />
                  <span>Security</span>
                </div>
                <div className="pl-6">
                  <Badge variant="default">Vault Encrypted</Badge>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Security Status */}
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>
            Your Spotify connection uses encrypted token storage and follows security best practices.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
};

export default SpotifySecurityDashboard;