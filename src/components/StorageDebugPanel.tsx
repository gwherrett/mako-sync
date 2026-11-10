import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { 
  Database, 
  Trash2, 
  RefreshCw, 
  AlertTriangle, 
  CheckCircle, 
  Info,
  Download,
  Upload,
  Shield,
  Clock,
  HardDrive
} from 'lucide-react';
import StorageManagerService, { type StorageAuditResult, type ResolvedStorageKey } from '@/services/storageManager.service';

interface StorageDebugPanelProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export const StorageDebugPanel: React.FC<StorageDebugPanelProps> = ({ 
  isOpen = true, 
  onClose 
}) => {
  const [auditResult, setAuditResult] = useState<StorageAuditResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [cleanupOptions, setCleanupOptions] = useState({
    categories: ['auth', 'spotify', 'debug'],
    preservePersistent: true,
    clearStaleOnly: false,
    dryRun: true
  });
  const [lastCleanup, setLastCleanup] = useState<{
    cleaned: ResolvedStorageKey[];
    preserved: ResolvedStorageKey[];
    errors: string[];
  } | null>(null);

  // Auto-refresh audit every 30 seconds
  useEffect(() => {
    if (isOpen) {
      performAudit();
      const interval = setInterval(performAudit, 30000);
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  const performAudit = async () => {
    setIsLoading(true);
    try {
      const result = StorageManagerService.auditStorage();
      setAuditResult(result);
    } catch (error) {
      console.error('Storage audit failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCleanup = async () => {
    if (!auditResult) return;
    
    setIsLoading(true);
    try {
      const result = await StorageManagerService.cleanStorage(cleanupOptions);
      setLastCleanup(result);
      
      // Refresh audit after cleanup
      await performAudit();
    } catch (error) {
      console.error('Storage cleanup failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmergencyReset = () => {
    if (confirm('⚠️ This will clear ALL application storage. Are you sure?')) {
      StorageManagerService.emergencyReset();
      performAudit();
    }
  };

  const exportStorageData = () => {
    if (!auditResult) return;
    
    const data = {
      audit: auditResult,
      timestamp: new Date().toISOString(),
      debugInfo: StorageManagerService.getDebugInfo()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mako-storage-audit-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getContaminationColor = (level: string) => {
    switch (level) {
      case 'low': return 'text-green-600 bg-green-50';
      case 'medium': return 'text-yellow-600 bg-yellow-50';
      case 'high': return 'text-orange-600 bg-orange-50';
      case 'critical': return 'text-red-600 bg-red-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'auth': return <Shield className="w-4 h-4" />;
      case 'spotify': return <Database className="w-4 h-4" />;
      case 'ui': return <Info className="w-4 h-4" />;
      case 'logging': return <Clock className="w-4 h-4" />;
      case 'debug': return <AlertTriangle className="w-4 h-4" />;
      case 'system': return <HardDrive className="w-4 h-4" />;
      default: return <Info className="w-4 h-4" />;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5" />
            <h2 className="text-xl font-semibold">Storage Debug Panel</h2>
            {auditResult && (
              <Badge className={getContaminationColor(auditResult.contamination.level)}>
                {auditResult.contamination.level.toUpperCase()} CONTAMINATION
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportStorageData}>
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
            <Button variant="outline" size="sm" onClick={performAudit} disabled={isLoading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            {onClose && (
              <Button variant="outline" size="sm" onClick={onClose}>
                Close
              </Button>
            )}
          </div>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
          {isLoading && !auditResult && (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-6 h-6 animate-spin mr-2" />
              <span>Analyzing storage...</span>
            </div>
          )}

          {auditResult && (
            <Tabs defaultValue="overview" className="space-y-4">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="keys">Storage Keys</TabsTrigger>
                <TabsTrigger value="cleanup">Cleanup</TabsTrigger>
                <TabsTrigger value="isolation">Session Isolation</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4">
                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">Total Keys</p>
                          <p className="text-2xl font-bold">{auditResult.totalKeys}</p>
                        </div>
                        <Database className="w-8 h-8 text-blue-500" />
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">Stale Keys</p>
                          <p className="text-2xl font-bold text-orange-600">{auditResult.staleKeys.length}</p>
                        </div>
                        <Clock className="w-8 h-8 text-orange-500" />
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">Duplicates</p>
                          <p className="text-2xl font-bold text-red-600">{auditResult.duplicateKeys.length}</p>
                        </div>
                        <AlertTriangle className="w-8 h-8 text-red-500" />
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">Size</p>
                          <p className="text-2xl font-bold">{Math.round(auditResult.sizeEstimate / 1024)}KB</p>
                        </div>
                        <HardDrive className="w-8 h-8 text-purple-500" />
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Contamination Analysis */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5" />
                      Contamination Analysis
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center gap-2">
                      <span>Contamination Level:</span>
                      <Badge className={getContaminationColor(auditResult.contamination.level)}>
                        {auditResult.contamination.level.toUpperCase()}
                      </Badge>
                    </div>

                    {auditResult.contamination.issues.length > 0 && (
                      <div>
                        <h4 className="font-medium mb-2">Issues Detected:</h4>
                        <ul className="space-y-1">
                          {auditResult.contamination.issues.map((issue, index) => (
                            <li key={index} className="flex items-center gap-2 text-sm">
                              <AlertTriangle className="w-4 h-4 text-orange-500" />
                              {issue}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {auditResult.contamination.recommendations.length > 0 && (
                      <div>
                        <h4 className="font-medium mb-2">Recommendations:</h4>
                        <ul className="space-y-1">
                          {auditResult.contamination.recommendations.map((rec, index) => (
                            <li key={index} className="flex items-center gap-2 text-sm">
                              <CheckCircle className="w-4 h-4 text-green-500" />
                              {rec}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Category Breakdown */}
                <Card>
                  <CardHeader>
                    <CardTitle>Storage by Category</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {Object.entries(auditResult.keysByCategory).map(([category, keys]) => (
                        <div key={category} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                          <div className="flex items-center gap-2">
                            {getCategoryIcon(category)}
                            <span className="font-medium capitalize">{category}</span>
                          </div>
                          <Badge variant="outline">{keys.length} keys</Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="keys" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>All Storage Keys</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Key</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Description</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.values(auditResult.keysByCategory).flat().map((key, index) => (
                          <TableRow key={index}>
                            <TableCell className="font-mono text-sm">{key.key}</TableCell>
                            <TableCell>
                              <Badge variant={key.type === 'localStorage' ? 'default' : 'secondary'}>
                                {key.type === 'localStorage' ? 'Local' : 'Session'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                {getCategoryIcon(key.category)}
                                <span className="capitalize">{key.category}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                {auditResult.staleKeys.includes(key) && (
                                  <Badge variant="destructive" className="text-xs">Stale</Badge>
                                )}
                                {auditResult.duplicateKeys.includes(key) && (
                                  <Badge variant="outline" className="text-xs">Duplicate</Badge>
                                )}
                                {key.persistent && (
                                  <Badge variant="secondary" className="text-xs">Persistent</Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {key.description}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="cleanup" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Storage Cleanup</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <h4 className="font-medium mb-2">Categories to Clean</h4>
                        <div className="space-y-2">
                          {['auth', 'spotify', 'debug', 'ui', 'logging'].map(category => (
                            <div key={category} className="flex items-center space-x-2">
                              <Switch
                                checked={cleanupOptions.categories.includes(category)}
                                onCheckedChange={(checked) => {
                                  setCleanupOptions(prev => ({
                                    ...prev,
                                    categories: checked 
                                      ? [...prev.categories, category]
                                      : prev.categories.filter(c => c !== category)
                                  }));
                                }}
                              />
                              <label className="capitalize">{category}</label>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <h4 className="font-medium mb-2">Options</h4>
                        <div className="space-y-2">
                          <div className="flex items-center space-x-2">
                            <Switch
                              checked={cleanupOptions.preservePersistent}
                              onCheckedChange={(checked) => 
                                setCleanupOptions(prev => ({ ...prev, preservePersistent: checked }))
                              }
                            />
                            <label>Preserve Persistent Keys</label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Switch
                              checked={cleanupOptions.clearStaleOnly}
                              onCheckedChange={(checked) => 
                                setCleanupOptions(prev => ({ ...prev, clearStaleOnly: checked }))
                              }
                            />
                            <label>Clear Stale Keys Only</label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Switch
                              checked={cleanupOptions.dryRun}
                              onCheckedChange={(checked) => 
                                setCleanupOptions(prev => ({ ...prev, dryRun: checked }))
                              }
                            />
                            <label>Dry Run (Preview Only)</label>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button onClick={handleCleanup} disabled={isLoading}>
                        <Trash2 className="w-4 h-4 mr-2" />
                        {cleanupOptions.dryRun ? 'Preview Cleanup' : 'Clean Storage'}
                      </Button>
                      <Button variant="destructive" onClick={handleEmergencyReset}>
                        <AlertTriangle className="w-4 h-4 mr-2" />
                        Emergency Reset
                      </Button>
                    </div>

                    {lastCleanup && (
                      <Alert>
                        <CheckCircle className="w-4 h-4" />
                        <AlertDescription>
                          Cleanup completed: {lastCleanup.cleaned.length} keys cleaned, 
                          {lastCleanup.preserved.length} preserved
                          {lastCleanup.errors.length > 0 && `, ${lastCleanup.errors.length} errors`}
                        </AlertDescription>
                      </Alert>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="isolation" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Session Isolation</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Create isolated storage sessions to prevent contamination between user sessions.
                    </p>
                    
                    <Button onClick={() => {
                      const sessionId = StorageManagerService.createSessionIsolation();
                      alert(`Created isolated session: ${sessionId}`);
                      performAudit();
                    }}>
                      <Shield className="w-4 h-4 mr-2" />
                      Create Isolated Session
                    </Button>

                    <div className="mt-4">
                      <h4 className="font-medium mb-2">Current Session Info</h4>
                      <div className="bg-muted p-3 rounded-lg font-mono text-sm">
                        Session ID: {sessionStorage.getItem('mako_session_id') || 'None'}<br />
                        Started: {sessionStorage.getItem('mako_session_start') || 'Unknown'}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
};

export default StorageDebugPanel;