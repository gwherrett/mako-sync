import React from 'react';
import { LogOut, Database, Home, ChevronUp, ChevronDown, Settings } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import BrandLogo from '@/components/BrandLogo';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/NewAuthContext';
import { cn } from '@/lib/utils';

interface LibraryHeaderProps {
  isDashboardCollapsed?: boolean;
  onToggleDashboard?: () => void;
}

const LibraryHeader = ({ isDashboardCollapsed, onToggleDashboard }: LibraryHeaderProps) => {
  const { user, signOut } = useAuth();
  const location = useLocation();

  const handleSignOut = async () => {
    console.log('🔴 SIGNOUT CLICK: Button clicked!');
    try {
      await signOut();
      console.log('🔴 SIGNOUT CLICK: signOut completed');
    } catch (err) {
      console.error('🔴 SIGNOUT CLICK: Error:', err);
    }
  };

  const navItems = [
    { path: '/', label: 'Dashboard', icon: Home },
    { path: '/genre-mapping', label: 'Genre Mapper', icon: Database },
    { path: '/security', label: 'Settings', icon: Settings },
  ];

  return (
    <header className="bg-spotify-dark border-b border-white/10">
      <div className="max-w-7xl mx-auto">
        {/* Top row with logo and user controls */}
        <div className="flex items-center justify-between p-4">
          <Link to="/" className="flex items-center space-x-4 group">
            <BrandLogo size={56} className="flex-shrink-0 group-hover:animate-swim-shake" />
            <div className="flex flex-col justify-center transition-transform duration-300 group-hover:translate-x-1">
              <h1 className="text-3xl font-bold text-white leading-tight">Mako Sync</h1>
            </div>
          </Link>
          
          <div className="flex items-center space-x-4">
            {user?.email && (
              <span className="text-sm text-muted-foreground hidden sm:block">
                {user.email}
              </span>
            )}
            {onToggleDashboard && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onToggleDashboard}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {isDashboardCollapsed ? (
                  <>
                    <ChevronDown className="w-4 h-4 mr-2" />
                    Show Dashboard
                  </>
                ) : (
                  <>
                    <ChevronUp className="w-4 h-4 mr-2" />
                    Hide Dashboard
                  </>
                )}
              </Button>
            )}
            <Button
              onClick={handleSignOut}
              variant="outline"
              size="sm"
              className="text-white border-white/20 hover:bg-white/10"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </div>

        {/* Navigation menu */}
        <div className="border-t border-white/10">
          <nav className="flex space-x-1 px-4 py-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    "flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    isActive
                      ? "bg-expos-blue/20 text-expos-blue border border-expos-blue/30"
                      : "text-gray-300 hover:text-white hover:bg-white/10"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
};

export default LibraryHeader;