import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ExternalLink, X, Info } from 'lucide-react';
import { isInIframe } from '@/utils/linkUtils';

export const IframeBanner = () => {
  // Show the banner if we're in an iframe and the user hasn't dismissed it
  const [showBanner, setShowBanner] = useState(
    () => isInIframe() && !localStorage.getItem('iframe-banner-dismissed')
  );
  const [isDismissed, setIsDismissed] = useState(false);

  const handleDismiss = () => {
    setIsDismissed(true);
    setShowBanner(false);
    localStorage.setItem('iframe-banner-dismissed', 'true');
  };

  if (!showBanner || isDismissed) {
    return null;
  }

  return (
    <Alert className="border-primary/20 bg-primary/5 mb-4">
      <Info className="h-4 w-4" />
      <AlertDescription className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <span className="text-sm">
            Links may not open in new tabs due to browser restrictions. 
            Use <kbd className="px-1.5 py-0.5 text-xs bg-muted rounded">Ctrl+Click</kbd> or 
            copy links to open them manually.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(window.location.href, '_blank')}
            className="text-xs h-7"
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            Open in New Tab
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            className="h-7 w-7 p-0"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
};