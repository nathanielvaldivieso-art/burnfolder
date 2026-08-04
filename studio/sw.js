/* burnfolder studio PWA — config only. Strategy lives in /shared/sw-core.js. */
importScripts('/shared/sw-core.js');

self.createBurnfolderServiceWorker({
  cacheName: 'burnfolder-stream-v69',
  includeRoot: false,
  freshSuffixes: [
    '/entries.js',
    '/songs.js',
    '/shared/site-version.js',
    '/shared/mux-playback.js',
    '/shared/playback-recall.js',
    '/shared/studio-playback-stack.js',
    '/studio/js/studio-site-menu.js',
    '/studio/js/clips-page.js',
    '/studio/js/clips-store.js',
    '/studio/js/studio-playback-shell.js',
    '/studio/js/studio-version.js',
    '/studio/js/stream-album-page.js',
    '/studio/js/stream-page.js',
    '/studio/js/stream-player.js',
    '/studio/js/studio-spa-router.js'
  ],
  staticPrefixes: ['/studio/js/', '/studio/css/', '/shared/']
});
