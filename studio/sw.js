/* burnfolder studio PWA — config only. Strategy lives in /shared/sw-core.js. */
importScripts('/shared/sw-core.js');

self.createBurnfolderServiceWorker({
  cacheName: 'burnfolder-stream-v41',
  includeRoot: false,
  freshSuffixes: [
    '/entries.js',
    '/songs.js',
    '/shared/site-version.js',
    '/studio/js/studio-version.js',
    '/studio/js/dashboard-page.js',
    '/studio/js/studio-ai-panel.js',
    '/studio/js/studio-spa-router.js'
  ],
  staticPrefixes: ['/studio/js/', '/studio/css/', '/shared/']
});
