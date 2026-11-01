import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Music, 
  Shield, 
  CheckCircle, 
  ArrowRight, 
  ExternalLink,
  AlertTriangle,
  RefreshCw,
  Clock,
  Key,
  Zap
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SpotifyAuthFlowProps {
  onConnect: () => Promise<void>;
  isConnecting?: boolean;
  className?: string;
}

interface AuthStep {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  status: 'pending' | 'active' | 'completed' | 'error';
}

export const SpotifyAuthFlow = ({
  onConnect,
  isConnecting = false,
  className
}: SpotifyAuthFlowProps) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [authSteps, setAuthSteps] = useState<AuthStep[]>([
    {
      id: 'prepare',
      title: 'Prepare Connection',
      description: 'Setting up secure authentication parameters',
      icon: Shield,
      status: 'pending'
    },
    {
      id: 'redirect',
      title: 'Spotify Authorization',
      description: 'Redirecting to Spotify for permission',
      icon: ExternalLink,
      status: 'pending'
    },
    {
      id: 'callback',
      title: 'Process Authorization',
      description: 'Handling Spotify response and tokens',
      icon: Key,
      status: 'pending'
    },
    {
      id: 'complete',
      title: 'Connection Established',
      description: 'Your Spotify account is now connected',
      icon: CheckCircle,
      status: 'pending'
    }
  ]);

  // Simulate auth flow progress when connecting
  useEffect(() => {
    if (!isConnecting) {
      // Reset steps when not connecting
      setCurrentStep(0);
      setAuthSteps(steps => steps.map(step => ({ ...step, status: 'pending' })));
      return;
    }

    // Simulate auth flow progression
    const progressAuth = async () => {
      // Step 1: Prepare
      setCurrentStep(0);
      setAuthSteps(steps => steps.map((step, index) => ({
        ...step,
        status: index === 0 ? 'active' : 'pending'
      })));

      await new Promise(resolve => setTimeout(resolve, 1000));

      // Step 2: Redirect (this is where the actual redirect happens)
      setCurrentStep(1);
      setAuthSteps(steps => steps.map((step, index) => ({
        ...step,
        status: index === 0 ? 'completed' : index === 1 ? 'active' : 'pending'
      })));
    };

    progressAuth();
  }, [isConnecting]);

  const handleConnect = async () => {
    try {
      await onConnect();
    } catch (error) {
      // Mark current step as error
      setAuthSteps(steps => steps.map((step, index) => ({
        ...step,
        status: index === currentStep ? 'error' : step.status
      })));
    }
  };

  const getStepIcon = (step: AuthStep, index: number) => {
    const IconComponent = step.icon;
    
    if (step.status === 'completed') {
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    }
    
    if (step.status === 'active') {
      return <RefreshCw className="h-5 w-5 text-blue-500 animate-spin" />;
    }
    
    if (step.status === 'error') {
      return <AlertTriangle className="h-5 w-5 text-red-500" />;
    }
    
    return <IconComponent className="h-5 w-5 text-muted-foreground" />;
  };

  const getProgressValue = () => {
    const completedSteps = authSteps.filter(step => step.status === 'completed').length;
    const activeStep = authSteps.findIndex(step => step.status === 'active');
    
    if (activeStep !== -1) {
      return ((completedSteps + 0.5) / authSteps.length) * 100;
    }
    
    return (completedSteps / authSteps.length) * 100;
  };

  return (
    <Card className={cn('w-full max-w-2xl', className)}>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-green-500/10 rounded-lg">
            <Music className="h-6 w-6 text-green-500" />
          </div>
          <div>
            <CardTitle>Connect to Spotify</CardTitle>
            <CardDescription>
              Securely link your Spotify account to sync your music library
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Connection Progress</span>
            <span className="text-muted-foreground">
              {Math.round(getProgressValue())}%
            </span>
          </div>
          <Progress value={getProgressValue()} className="h-2" />
        </div>

        {/* Auth Steps */}
        <div className="space-y-4">
          {authSteps.map((step, index) => (
            <div
              key={step.id}
              className={cn(
                'flex items-start gap-4 p-4 rounded-lg border transition-colors',
                step.status === 'active' && 'border-blue-200 bg-blue-50/50',
                step.status === 'completed' && 'border-green-200 bg-green-50/50',
                step.status === 'error' && 'border-red-200 bg-red-50/50',
                step.status === 'pending' && 'border-muted bg-muted/20'
              )}
            >
              <div className="shrink-0 mt-0.5">
                {getStepIcon(step, index)}
              </div>
              
              <div className="flex-1 min-w-0">
                <h4 className={cn(
                  'font-medium',
                  step.status === 'active' && 'text-blue-700',
                  step.status === 'completed' && 'text-green-700',
                  step.status === 'error' && 'text-red-700'
                )}>
                  {step.title}
                </h4>
                <p className="text-sm text-muted-foreground mt-1">
                  {step.description}
                </p>
                
                {step.status === 'active' && index === 1 && (
                  <div className="mt-2 text-xs text-blue-600">
                    You'll be redirected to Spotify to authorize the connection...
                  </div>
                )}
                
                {step.status === 'error' && (
                  <div className="mt-2 text-xs text-red-600">
                    Something went wrong. Please try again.
                  </div>
                )}
              </div>

              {step.status === 'active' && index === currentStep && (
                <div className="shrink-0">
                  <div className="h-2 w-2 bg-blue-500 rounded-full animate-pulse" />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Security Notice */}
        <Alert>
          <Shield className="h-4 w-4" />
          <AlertDescription>
            <strong>Secure Connection:</strong> Your Spotify credentials are never stored. 
            We only receive temporary access tokens that are encrypted and stored securely.
          </AlertDescription>
        </Alert>

        {/* Permissions Info */}
        <div className="space-y-3">
          <h4 className="font-medium text-sm">Required Permissions:</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span>Read your profile information</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span>Access your saved tracks</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span>View your playlists</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span>Read your listening history</span>
            </div>
          </div>
        </div>

        {/* Connect Button */}
        <div className="flex gap-3">
          <Button
            onClick={handleConnect}
            disabled={isConnecting}
            className="flex-1"
            size="lg"
          >
            {isConnecting ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <Music className="h-4 w-4 mr-2" />
                Connect to Spotify
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>
        </div>

        {/* Quick Benefits */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t">
          <div className="text-center space-y-2">
            <Zap className="h-8 w-8 text-yellow-500 mx-auto" />
            <h5 className="font-medium text-sm">Instant Sync</h5>
            <p className="text-xs text-muted-foreground">
              Automatically sync your liked songs and playlists
            </p>
          </div>
          <div className="text-center space-y-2">
            <Shield className="h-8 w-8 text-blue-500 mx-auto" />
            <h5 className="font-medium text-sm">Secure</h5>
            <p className="text-xs text-muted-foreground">
              Bank-level encryption for all your data
            </p>
          </div>
          <div className="text-center space-y-2">
            <Clock className="h-8 w-8 text-green-500 mx-auto" />
            <h5 className="font-medium text-sm">Real-time</h5>
            <p className="text-xs text-muted-foreground">
              Updates sync automatically as you listen
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default SpotifyAuthFlow;