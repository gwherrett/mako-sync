import React from 'react';
import { Settings, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/NewAuthContext';
import { useUnifiedSpotifyAuth } from '@/hooks/useUnifiedSpotifyAuth';
import { SlskdConfigSection } from '@/components/SlskdConfigSection';
import { format } from 'date-fns';

type TokenStatus = 'Valid' | 'Missing' | 'Expired' | 'Unknown';

interface TokenInfo {
  token: string;
  status: TokenStatus;
  expiration: string;
}

const getStatusBadgeVariant = (status: TokenStatus) => {
  switch (status) {
    case 'Valid':
      return 'default';
    case 'Missing':
      return 'destructive';
    case 'Expired':
      return 'destructive';
    case 'Unknown':
      return 'secondary';
    default:
      return 'secondary';
  }
};

const Security = () => {
  const { session } = useAuth();
  const { isConnected, connection } = useUnifiedSpotifyAuth();

  // Determine Supabase token status
  const getSupabaseTokenInfo = (): TokenInfo => {
    if (!session) {
      return { token: 'Supabase', status: 'Missing', expiration: '—' };
    }
    
    const expiresAt = session.expires_at;
    if (expiresAt) {
      const expirationDate = new Date(expiresAt * 1000);
      const now = new Date();
      
      if (expirationDate < now) {
        return { 
          token: 'Supabase', 
          status: 'Expired', 
          expiration: format(expirationDate, 'MMM d, yyyy h:mm a') 
        };
      }
      
      return { 
        token: 'Supabase', 
        status: 'Valid', 
        expiration: format(expirationDate, 'MMM d, yyyy h:mm a') 
      };
    }
    
    return { token: 'Supabase', status: 'Unknown', expiration: '—' };
  };

  // Determine Spotify token status
  const getSpotifyTokenInfo = (): TokenInfo => {
    if (!isConnected || !connection) {
      return { token: 'Spotify', status: 'Missing', expiration: '—' };
    }
    
    const expiresAt = connection.expires_at;
    if (expiresAt) {
      const expirationDate = new Date(expiresAt);
      const now = new Date();
      
      if (expirationDate < now) {
        return { 
          token: 'Spotify', 
          status: 'Expired', 
          expiration: format(expirationDate, 'MMM d, yyyy h:mm a') 
        };
      }
      
      return { 
        token: 'Spotify', 
        status: 'Valid', 
        expiration: format(expirationDate, 'MMM d, yyyy h:mm a') 
      };
    }
    
    return { token: 'Spotify', status: 'Unknown', expiration: '—' };
  };

  const tokens: TokenInfo[] = [
    getSupabaseTokenInfo(),
    getSpotifyTokenInfo(),
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center gap-4">
            <Link to="/">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
              </Button>
            </Link>
            <div className="flex items-center gap-3">
              <Settings className="h-8 w-8 text-primary" />
              <div>
                <h1 className="text-2xl font-bold text-foreground">Options & Authentication</h1>
                <p className="text-muted-foreground">Configuration and token status</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Token Status</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Token</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expiration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((tokenInfo) => (
                  <TableRow key={tokenInfo.token}>
                    <TableCell className="font-medium">{tokenInfo.token}</TableCell>
                    <TableCell>
                      <Badge variant={getStatusBadgeVariant(tokenInfo.status)}>
                        {tokenInfo.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {tokenInfo.expiration}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* slskd Configuration */}
        <SlskdConfigSection />
      </main>
    </div>
  );
};

export default Security;
