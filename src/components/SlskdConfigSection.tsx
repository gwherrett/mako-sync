/**
 * SlskdConfigSection Component
 *
 * Configuration UI for connecting to a slskd instance.
 * Allows users to enter their slskd API endpoint and key,
 * configure downloads folder and search format preferences,
 * test the connection, and save the configuration.
 *
 * Configuration is stored in browser localStorage.
 * Directory handle is stored in IndexedDB for persistent file access.
 */

import { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useSlskdConfig } from '@/hooks/useSlskdConfig';
import { Loader2, Server, CheckCircle2, XCircle, Info, FolderOpen } from 'lucide-react';
import {
  isFileSystemAccessSupported,
  requestDirectoryAccess,
  getDownloadsDirectory,
  clearStoredDirectoryHandle,
} from '@/services/directoryHandle.service';

export function SlskdConfigSection() {
  const {
    config,
    saveConfig,
    isSaving,
    testConnection,
    isTesting,
  } = useSlskdConfig();

  const [apiEndpoint, setApiEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [downloadsFolder, setDownloadsFolder] = useState('');
  const [searchFormat, setSearchFormat] = useState<'primary' | 'full'>('primary');

  // File System Access API state
  const isDirectoryPickerSupported = isFileSystemAccessSupported();
  const [directoryHandle, setDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [isLoadingDirectory, setIsLoadingDirectory] = useState(true);

  // Sync local state with loaded config
  useEffect(() => {
    if (config) {
      setApiEndpoint(config.apiEndpoint || '');
      setApiKey(config.apiKey || '');
      setDownloadsFolder(config.downloadsFolder || '');
      setSearchFormat(config.searchFormat || 'primary');
    }
  }, [config]);

  // Try to restore saved directory handle on mount
  useEffect(() => {
    async function restoreHandle() {
      if (!isDirectoryPickerSupported) {
        setIsLoadingDirectory(false);
        return;
      }

      try {
        const handle = await getDownloadsDirectory();
        if (handle) {
          setDirectoryHandle(handle);
          // Update the downloads folder path in config if different
          if (handle.name !== downloadsFolder) {
            setDownloadsFolder(handle.name);
          }
        }
      } catch (error) {
        console.error('Failed to restore directory handle:', error);
      } finally {
        setIsLoadingDirectory(false);
      }
    }

    restoreHandle();
  }, [isDirectoryPickerSupported]);

  // Handle selecting a directory
  const handleSelectDirectory = async () => {
    try {
      const handle = await requestDirectoryAccess();
      if (handle) {
        setDirectoryHandle(handle);
        setDownloadsFolder(handle.name);
      }
    } catch (error) {
      console.error('Failed to select directory:', error);
    }
  };

  // Handle clearing the directory
  const handleClearDirectory = async () => {
    await clearStoredDirectoryHandle();
    setDirectoryHandle(null);
    setDownloadsFolder('');
  };

  const handleSave = () => {
    saveConfig({ apiEndpoint, apiKey, downloadsFolder, searchFormat });
  };

  const handleTest = () => {
    testConnection({ apiEndpoint, apiKey });
  };

  const hasChanges =
    config &&
    (apiEndpoint !== config.apiEndpoint ||
      apiKey !== config.apiKey ||
      downloadsFolder !== config.downloadsFolder ||
      searchFormat !== config.searchFormat);

  const canSave = apiEndpoint.trim() && apiKey.trim();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Server className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>slskd Integration</CardTitle>
              <CardDescription>
                Connect to your slskd instance to push missing tracks to
                wishlist
              </CardDescription>
            </div>
          </div>
          {config?.connectionStatus ? (
            <Badge
              variant="default"
              className="bg-green-500 hover:bg-green-600"
            >
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Connected
            </Badge>
          ) : config?.apiEndpoint ? (
            <Badge variant="destructive">
              <XCircle className="h-3 w-3 mr-1" />
              Disconnected
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Configuration is stored locally in your browser. It is not synced to the server.
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <Label htmlFor="slskd-endpoint">API Endpoint</Label>
          <Input
            id="slskd-endpoint"
            type="url"
            placeholder="http://localhost:5030"
            value={apiEndpoint}
            onChange={(e) => setApiEndpoint(e.target.value)}
          />
          <p className="text-sm text-muted-foreground">
            The URL of your slskd instance (e.g., http://localhost:5030)
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="slskd-api-key">API Key</Label>
          <Input
            id="slskd-api-key"
            type="password"
            placeholder="Your slskd API key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <p className="text-sm text-muted-foreground">
            Found in slskd Options → API. Enable the API and copy your key.
          </p>
        </div>

        {isDirectoryPickerSupported && (
          <div className="space-y-2">
            <Label>Folder Access (for Tag Writing)</Label>
            {isLoadingDirectory ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking for saved folder access...
              </div>
            ) : directoryHandle ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-md flex-1">
                  <FolderOpen className="h-4 w-4" />
                  <span className="font-medium">{directoryHandle.name}</span>
                  <Badge variant="outline" className="text-xs">Read/Write Access Granted</Badge>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSelectDirectory}
                >
                  Change
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearDirectory}
                >
                  Clear
                </Button>
              </div>
            ) : (
              <Button variant="outline" onClick={handleSelectDirectory}>
                <FolderOpen className="h-4 w-4 mr-2" />
                Grant Folder Access
              </Button>
            )}
            <p className="text-sm text-muted-foreground">
              {directoryHandle
                ? 'Browser has read/write access to this folder. Tags can be written directly to files.'
                : 'Grant browser access to your downloads folder to enable writing SuperGenre tags directly to MP3 files.'}
            </p>
          </div>
        )}

        {!isDirectoryPickerSupported && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Your browser doesn't support the File System Access API. Use Chrome or Edge for direct tag writing.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label>Search Query Format</Label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="searchFormat"
                checked={searchFormat === 'primary'}
                onChange={() => setSearchFormat('primary')}
                className="w-4 h-4"
              />
              <span className="text-sm">Primary artist only (Recommended)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="searchFormat"
                checked={searchFormat === 'full'}
                onChange={() => setSearchFormat('full')}
                className="w-4 h-4"
              />
              <span className="text-sm">Full artist string</span>
            </label>
          </div>
          <p className="text-sm text-muted-foreground">
            "Primary artist only" strips featured artists for better search results.
          </p>
        </div>

        {config?.lastConnectionTest && (
          <p className="text-xs text-muted-foreground">
            Last tested:{' '}
            {new Date(config.lastConnectionTest).toLocaleString()}
          </p>
        )}

        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={isTesting || !canSave}
          >
            {isTesting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Test Connection
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !canSave}
          >
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save & Test Connection
          </Button>
        </div>

        {hasChanges && (
          <p className="text-xs text-amber-600">
            You have unsaved changes
          </p>
        )}
      </CardContent>
    </Card>
  );
}
