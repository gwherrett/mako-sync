/**
 * Service Worker Cleanup Utility
 * 
 * This utility helps clean up any existing service workers that might be
 * causing aggressive caching issues with authentication flows.
 */

export const unregisterServiceWorkers = async (): Promise<void> => {
  if ('serviceWorker' in navigator) {
    try {
      // Get all registrations
      const registrations = await navigator.serviceWorker.getRegistrations();
      
      // Unregister all service workers
      const unregisterPromises = registrations.map(registration => {
        console.log('Unregistering service worker:', registration.scope);
        return registration.unregister();
      });
      
      await Promise.all(unregisterPromises);
      
      if (registrations.length > 0) {
        console.log(`Successfully unregistered ${registrations.length} service worker(s)`);
      }
    } catch (error) {
      console.warn('Failed to unregister service workers:', error);
    }
  }
};

export const clearAllCaches = async (): Promise<void> => {
  if ('caches' in window) {
    try {
      const cacheNames = await caches.keys();
      const deletePromises = cacheNames.map(cacheName => {
        console.log('Deleting cache:', cacheName);
        return caches.delete(cacheName);
      });
      
      await Promise.all(deletePromises);
      
      if (cacheNames.length > 0) {
        console.log(`Successfully cleared ${cacheNames.length} cache(s)`);
      }
    } catch (error) {
      console.warn('Failed to clear caches:', error);
    }
  }
};

export const performFullCleanup = async (): Promise<void> => {
  console.log('Starting service worker and cache cleanup...');

  await Promise.all([
    unregisterServiceWorkers(),
    clearAllCaches()
  ]);

  console.log('Service worker and cache cleanup completed');
};

// Auto-cleanup on page load
if (import.meta.env.DEV) {
  // In development, always perform full cleanup to avoid caching issues during rapid iterations
  performFullCleanup().catch(console.warn);
} else {
  // In production, run a one-time cleanup per browser profile to clear any legacy service workers
  // that might interfere with Supabase/network requests. This helps fix issues where regular
  // tabs hang while incognito works correctly due to stale service workers or caches.
  try {
    const cleanupKey = 'mako-sync-service-worker-cleanup-v1';
    const hasRunCleanup = localStorage.getItem(cleanupKey) === 'true';

    if (!hasRunCleanup) {
      performFullCleanup()
        .then(() => {
          localStorage.setItem(cleanupKey, 'true');
        })
        .catch((error) => {
          console.warn('Service worker cleanup failed in production:', error);
        });
    }
  } catch (error) {
    console.warn('Unable to access localStorage for cleanup flag:', error);
  }
}
