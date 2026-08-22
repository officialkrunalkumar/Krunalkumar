/**
 * Vercel Speed Insights initialization
 * Automatically tracks web vitals and performance metrics
 * Based on @vercel/speed-insights v2.0.0
 */
(function() {
  'use strict';

  // Only run in production or when explicitly enabled
  const isDev = window.location.hostname === 'localhost' || 
                window.location.hostname === '127.0.0.1' ||
                window.location.hostname === '';
  
  if (isDev) {
    console.log('[Speed Insights] Skipping in development mode');
    return;
  }

  // Initialize the queue for Speed Insights
  if (!window.si) {
    window.si = function() {
      window.siq = window.siq || [];
      window.siq.push(arguments);
    };
  }

  // Check if script is already loaded
  const existingScript = document.head.querySelector('script[src*="speed-insights"]');
  if (existingScript) {
    return;
  }

  // Create and inject the Speed Insights script
  const script = document.createElement('script');
  script.src = '/_vercel/speed-insights/script.js';
  script.defer = true;
  
  // Add SDK information as data attributes
  script.dataset.sdkn = '@vercel/speed-insights';
  script.dataset.sdkv = '2.0.0';

  // Error handling
  script.onerror = function() {
    console.log(
      '[Vercel Speed Insights] Failed to load script. Please check if any content blockers are enabled.'
    );
  };

  // Inject the script
  document.head.appendChild(script);
})();
