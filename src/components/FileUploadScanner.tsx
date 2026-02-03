import React, { useState } from 'react';
import { FolderSearch, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useLocalScanner } from '@/hooks/useLocalScanner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface FileUploadScannerProps {
  onScanComplete?: () => void;
}

const FileUploadScanner = ({ onScanComplete }: FileUploadScannerProps) => {
  const { isScanning, scanLocalFiles, scanProgress } = useLocalScanner(onScanComplete);
  const { toast } = useToast();
  const [isDeleting, setIsDeleting] = useState(false);

  const deleteAllLocalFiles = async () => {
    setIsDeleting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast({
          title: "Error",
          description: "You must be logged in to delete files",
          variant: "destructive",
        });
        return;
      }

      const { error } = await supabase
        .from('local_mp3s')
        .delete()
        .eq('user_id', user.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "All local file metadata has been deleted",
      });
      
      // Trigger refresh of filter options
      if (onScanComplete) {
        onScanComplete();
      }
    } catch (error: any) {
      console.error('Delete error:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete local files",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderSearch className="w-5 h-5" />
          Scan Local Music Files
        </CardTitle>
        <CardDescription>
          Select folders to scan your local collection. Metadata is extracted and mapped to Supergenres for matching.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <Button 
            onClick={scanLocalFiles}
            disabled={isScanning}
            size="sm"
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {isScanning ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {scanProgress.total > 0 
                  ? `Scanning... ${scanProgress.current}/${scanProgress.total}`
                  : 'Scanning...'
                }
              </>
            ) : (
              <>
                <FolderSearch className="w-4 h-4 mr-2" />
                Scan Local Files
              </>
            )}
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 className="w-4 h-4 mr-2" />
                Delete All
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete All Local Files?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete all local file metadata from the database. 
                  This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={deleteAllLocalFiles} disabled={isDeleting}>
                  {isDeleting ? 'Deleting...' : 'Delete All'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
};

export default FileUploadScanner;