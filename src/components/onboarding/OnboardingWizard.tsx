import React, { useState } from 'react';
import { useAuth } from '@/contexts/NewAuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { CheckCircle, Circle, Music2, Upload, Settings, Play } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  component: React.ReactNode;
  completed: boolean;
  optional?: boolean;
}

interface OnboardingWizardProps {
  onComplete: () => void;
}

const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ onComplete }) => {
  const { user, updateProfile } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());

  const steps: OnboardingStep[] = [
    {
      id: 'welcome',
      title: 'Welcome to Mako Sync',
      description: 'Let\'s get you set up to sync your music library',
      icon: <Music2 className="w-6 h-6" />,
      component: <WelcomeStep />,
      completed: completedSteps.has('welcome'),
    },
    {
      id: 'spotify',
      title: 'Connect Spotify',
      description: 'Link your Spotify account to sync your liked songs',
      icon: <Play className="w-6 h-6" />,
      component: <SpotifyStep />,
      completed: completedSteps.has('spotify'),
    },
    {
      id: 'local',
      title: 'Scan Local Files',
      description: 'Upload your local music files for comparison',
      icon: <Upload className="w-6 h-6" />,
      component: <LocalFilesStep />,
      completed: completedSteps.has('local'),
      optional: true,
    },
    {
      id: 'preferences',
      title: 'Set Preferences',
      description: 'Customize your sync and genre preferences',
      icon: <Settings className="w-6 h-6" />,
      component: <PreferencesStep />,
      completed: completedSteps.has('preferences'),
      optional: true,
    },
  ];

  const progress = (completedSteps.size / steps.length) * 100;

  const markStepCompleted = (stepId: string) => {
    setCompletedSteps(prev => new Set([...prev, stepId]));
  };

  const handleNext = () => {
    const currentStepData = steps[currentStep];
    markStepCompleted(currentStepData.id);
    
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSkip = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handleComplete = async () => {
    // Mark onboarding as completed
    await updateProfile({ onboarding_completed: true });
    onComplete();
  };

  const currentStepData = steps[currentStep];

  return (
    <div className="min-h-screen bg-gradient-to-br from-expos-dark via-expos-dark-elevated to-black flex items-center justify-center p-4">
      <Card className="w-full max-w-4xl bg-spotify-dark border-white/10">
        <CardHeader>
          <div className="flex items-center justify-between mb-4">
            <div>
              <CardTitle className="text-2xl text-white">
                Getting Started
              </CardTitle>
              <CardDescription className="text-gray-400">
                Step {currentStep + 1} of {steps.length}
              </CardDescription>
            </div>
            <div className="text-right">
              <div className="text-sm text-gray-400 mb-2">
                {Math.round(progress)}% Complete
              </div>
              <Progress value={progress} className="w-32" />
            </div>
          </div>

          {/* Step indicators */}
          <div className="flex items-center space-x-4 overflow-x-auto pb-4">
            {steps.map((step, index) => (
              <div
                key={step.id}
                className={cn(
                  'flex items-center space-x-2 min-w-fit px-3 py-2 rounded-lg transition-colors',
                  index === currentStep
                    ? 'bg-primary/20 border border-primary/30'
                    : step.completed
                    ? 'bg-green-500/20 border border-green-500/30'
                    : 'bg-white/5 border border-white/10'
                )}
              >
                <div className={cn(
                  'flex items-center justify-center w-8 h-8 rounded-full',
                  index === currentStep
                    ? 'bg-primary text-primary-foreground'
                    : step.completed
                    ? 'bg-green-500 text-white'
                    : 'bg-white/10 text-gray-400'
                )}>
                  {step.completed ? (
                    <CheckCircle className="w-4 h-4" />
                  ) : (
                    step.icon
                  )}
                </div>
                <div className="text-sm">
                  <div className={cn(
                    'font-medium',
                    index === currentStep ? 'text-white' : 'text-gray-400'
                  )}>
                    {step.title}
                  </div>
                  {step.optional && (
                    <div className="text-xs text-gray-500">Optional</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Current step content */}
          <div className="min-h-[300px]">
            <div className="mb-6">
              <h3 className="text-xl font-semibold text-white mb-2">
                {currentStepData.title}
              </h3>
              <p className="text-gray-400">
                {currentStepData.description}
              </p>
            </div>
            
            {currentStepData.component}
          </div>

          {/* Navigation buttons */}
          <div className="flex items-center justify-between pt-6 border-t border-white/10">
            <Button
              variant="outline"
              onClick={handlePrevious}
              disabled={currentStep === 0}
              className="bg-white/10 border-white/20 text-white hover:bg-white/20"
            >
              Previous
            </Button>

            <div className="flex items-center space-x-3">
              {currentStepData.optional && (
                <Button
                  variant="ghost"
                  onClick={handleSkip}
                  className="text-gray-400 hover:text-white"
                >
                  Skip
                </Button>
              )}
              
              <Button
                onClick={handleNext}
                className="spotify-gradient text-black font-medium"
              >
                {currentStep === steps.length - 1 ? 'Complete Setup' : 'Next'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// Individual step components
const WelcomeStep = () => (
  <div className="text-center space-y-6">
    <div className="w-24 h-24 bg-green-500 rounded-full flex items-center justify-center mx-auto">
      <Music2 className="w-12 h-12 text-black" />
    </div>
    <div className="space-y-4">
      <h4 className="text-lg font-medium text-white">
        Welcome to Mako Sync!
      </h4>
      <p className="text-gray-400 max-w-md mx-auto">
        Mako Sync helps you bridge the gap between your Spotify liked songs and local music collection. 
        We'll help you identify missing tracks, organize by genre, and keep your libraries in sync.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
        <div className="text-center space-y-2">
          <Play className="w-8 h-8 text-green-400 mx-auto" />
          <div className="text-sm text-white">Sync Spotify</div>
          <div className="text-xs text-gray-400">Connect your account</div>
        </div>
        <div className="text-center space-y-2">
          <Upload className="w-8 h-8 text-blue-400 mx-auto" />
          <div className="text-sm text-white">Scan Local Files</div>
          <div className="text-xs text-gray-400">Upload your music</div>
        </div>
        <div className="text-center space-y-2">
          <Settings className="w-8 h-8 text-purple-400 mx-auto" />
          <div className="text-sm text-white">Organize & Analyze</div>
          <div className="text-xs text-gray-400">Find missing tracks</div>
        </div>
      </div>
    </div>
  </div>
);

const SpotifyStep = () => (
  <div className="text-center space-y-6">
    <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto">
      <Play className="w-8 h-8 text-black" />
    </div>
    <div className="space-y-4">
      <h4 className="text-lg font-medium text-white">
        Connect Your Spotify Account
      </h4>
      <p className="text-gray-400 max-w-md mx-auto">
        We'll sync your liked songs and extract metadata to help organize your music library.
        Your login credentials are never stored - we only access your public profile and liked songs.
      </p>
      <Button className="spotify-gradient text-black font-medium">
        Connect Spotify
      </Button>
    </div>
  </div>
);

const LocalFilesStep = () => (
  <div className="text-center space-y-6">
    <div className="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center mx-auto">
      <Upload className="w-8 h-8 text-white" />
    </div>
    <div className="space-y-4">
      <h4 className="text-lg font-medium text-white">
        Scan Your Local Music Files
      </h4>
      <p className="text-gray-400 max-w-md mx-auto">
        Scan your local music files so we can compare them with your Spotify library.
        Files are processed locally in your browser - nothing is uploaded to our servers.
      </p>
      <div className="border-2 border-dashed border-white/20 rounded-lg p-8 hover:border-white/40 transition-colors cursor-pointer">
        <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
        <div className="text-sm text-gray-400">
          Click to select music files or drag and drop
        </div>
      </div>
    </div>
  </div>
);

const PreferencesStep = () => (
  <div className="space-y-6">
    <div className="text-center">
      <div className="w-16 h-16 bg-purple-500 rounded-full flex items-center justify-center mx-auto mb-4">
        <Settings className="w-8 h-8 text-white" />
      </div>
      <h4 className="text-lg font-medium text-white mb-2">
        Customize Your Experience
      </h4>
      <p className="text-gray-400 max-w-md mx-auto">
        Set your preferences for how Mako Sync organizes and processes your music.
      </p>
    </div>
    
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="space-y-4">
        <h5 className="font-medium text-white">Sync Preferences</h5>
        <div className="space-y-3">
          <label className="flex items-center space-x-3">
            <input type="checkbox" className="rounded" defaultChecked />
            <span className="text-sm text-gray-300">Auto-sync new liked songs</span>
          </label>
          <label className="flex items-center space-x-3">
            <input type="checkbox" className="rounded" defaultChecked />
            <span className="text-sm text-gray-300">Sync audio features (BPM, key)</span>
          </label>
          <label className="flex items-center space-x-3">
            <input type="checkbox" className="rounded" />
            <span className="text-sm text-gray-300">Sync artist genres</span>
          </label>
        </div>
      </div>
      
      <div className="space-y-4">
        <h5 className="font-medium text-white">Genre Organization</h5>
        <div className="space-y-3">
          <label className="flex items-center space-x-3">
            <input type="checkbox" className="rounded" defaultChecked />
            <span className="text-sm text-gray-300">Use AI genre suggestions</span>
          </label>
          <label className="flex items-center space-x-3">
            <input type="checkbox" className="rounded" defaultChecked />
            <span className="text-sm text-gray-300">Group similar genres</span>
          </label>
          <label className="flex items-center space-x-3">
            <input type="checkbox" className="rounded" />
            <span className="text-sm text-gray-300">Strict genre validation</span>
          </label>
        </div>
      </div>
    </div>
  </div>
);

export default OnboardingWizard;