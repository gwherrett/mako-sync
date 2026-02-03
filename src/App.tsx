
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
import NotFound from "./pages/NotFound";
import { GenreMapping } from "./pages/GenreMapping";
import Security from "./pages/Security";

const queryClient = new QueryClient();

// App content component
function AppContent() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth" element={<NewAuth />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/spotify-callback" element={<UnifiedSpotifyCallback />} />
        <Route path="/" element={
          <NewProtectedRoute>
            <Index />
          </NewProtectedRoute>
        } />
        <Route path="/genre-mapping" element={
          <NewProtectedRoute>
            <GenreMapping />
          </NewProtectedRoute>
        } />
        {/* Redirect /no-genre-tracks to Dashboard - No Genre tab is now Tab 4 */}
        <Route path="/no-genre-tracks" element={<Navigate to="/?tab=nogenre" replace />} />
        <Route path="/security" element={
          <NewProtectedRoute>
            <Security />
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
