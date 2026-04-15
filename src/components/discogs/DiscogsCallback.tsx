import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { DiscogsAuthManager } from '@/services/discogsAuthManager.service';
import { useAuth } from '@/contexts/NewAuthContext';
import { Loader2, Disc3, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const DiscogsCallback: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { loading: authLoading } = useAuth();
  const [isProcessing, setIsProcessing] = useState(true);
  const [failed, setFailed] = useState(false);
  const [failureReason, setFailureReason] = useState('');
  const authLoadingRef = useRef(authLoading);

  useEffect(() => { authLoadingRef.current = authLoading; }, [authLoading]);

  useEffect(() => {
    const executionFlag = 'discogs_callback_processing';
    if (sessionStorage.getItem(executionFlag)) return;
    sessionStorage.setItem(executionFlag, 'true');

    const process = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const oauthToken = params.get('oauth_token');
        const oauthVerifier = params.get('oauth_verifier');
        const denied = params.get('denied');

        if (denied) {
          toast({ title: 'Discogs Connection Cancelled', description: 'Authorization was denied.', variant: 'destructive' });
          sessionStorage.removeItem(executionFlag);
          setTimeout(() => navigate('/security'), 2000);
          return;
        }

        if (!oauthToken || !oauthVerifier) {
          throw new Error('Missing oauth_token or oauth_verifier in callback URL');
        }

        // Retrieve the request token secret saved before the redirect
        const oauthTokenSecret = sessionStorage.getItem('discogs_oauth_token_secret');
        if (!oauthTokenSecret) {
          throw new Error('OAuth token secret not found — please try connecting again');
        }

        // Wait for auth context
        const maxWait = 5000;
        const start = Date.now();
        while (authLoadingRef.current && Date.now() - start < maxWait) {
          await new Promise(r => setTimeout(r, 100));
        }

        const manager = DiscogsAuthManager.getInstance();
        const result = await manager.exchangeAccessToken(oauthToken, oauthVerifier, oauthTokenSecret);

        sessionStorage.removeItem(executionFlag);

        if (result.success) {
          toast({ title: 'Discogs Connected!', description: 'Your Discogs account has been successfully connected.' });
          setTimeout(() => navigate('/security'), 1500);
        } else {
          throw new Error(result.error || 'Failed to exchange access token');
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('🎵 DISCOGS: Callback error:', msg);
        setFailed(true);
        setFailureReason(msg);
        sessionStorage.removeItem('discogs_callback_processing');
      } finally {
        setIsProcessing(false);
      }
    };

    process();
  }, [navigate, toast]);

  if (failed) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-muted flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4 p-6 bg-card rounded-lg shadow-lg max-w-md">
          <AlertCircle className="w-12 h-12 text-destructive" />
          <h2 className="text-xl font-semibold">Connection Failed</h2>
          <p className="text-muted-foreground text-center">{failureReason}</p>
          <Button onClick={() => navigate('/security')}>Return to Settings</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted flex items-center justify-center p-4">
      <div className="flex flex-col items-center space-y-4">
        <div className="p-4 bg-orange-500/10 rounded-full">
          <Disc3 className="h-8 w-8 text-orange-500" />
        </div>
        <div className="flex items-center space-x-2">
          <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
          <span className="text-lg font-medium">Connecting to Discogs...</span>
        </div>
        <p className="text-sm text-muted-foreground text-center max-w-md">
          Securely storing your Discogs credentials. You'll be redirected automatically.
        </p>
      </div>
    </div>
  );
};

export default DiscogsCallback;
