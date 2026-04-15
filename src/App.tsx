
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { NewAuthProvider } from "@/contexts/NewAuthContext";
import NewProtectedRoute from "@/components/NewProtectedRoute";
import Index from "./pages/Index";
import NewAuth from "./pages/NewAuth";
import ResetPassword from "./pages/ResetPassword";
import { UnifiedSpotifyCallback } from "./components/spotify/UnifiedSpotifyCallback";
import { DiscogsCallback } from "./components/discogs/DiscogsCallback";
import NotFound from "./pages/NotFound";
import { GenreTools } from "./pages/GenreTools";
import Security from "./pages/Security";
import { DuplicateTracksManager } from "./components/DuplicateTracksManager";
import Vinyl from "./pages/Vinyl";

const queryClient = new QueryClient();

// App content component
function AppContent() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth" element={<NewAuth />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/spotify-callback" element={<UnifiedSpotifyCallback />} />
        <Route path="/discogs-callback" element={<DiscogsCallback />} />
        <Route path="/" element={
          <NewProtectedRoute>
            <Index />
          </NewProtectedRoute>
        } />
        <Route path="/genre-tools" element={
          <NewProtectedRoute>
            <GenreTools />
          </NewProtectedRoute>
        } />
        {/* Redirect legacy routes */}
        <Route path="/genre-mapping" element={<Navigate to="/genre-tools" replace />} />
        <Route path="/no-genre-tracks" element={<Navigate to="/genre-tools?tab=assign" replace />} />
        <Route path="/security" element={
          <NewProtectedRoute>
            <Security />
          </NewProtectedRoute>
        } />
        <Route path="/duplicates" element={
          <NewProtectedRoute>
            <DuplicateTracksManager />
          </NewProtectedRoute>
        } />
        <Route path="/vinyl" element={
          <NewProtectedRoute>
            <Vinyl />
          </NewProtectedRoute>
        } />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <NewAuthProvider>
        <AppContent />
      </NewAuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
