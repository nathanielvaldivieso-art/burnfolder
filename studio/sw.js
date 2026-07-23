/* burnfolder studio PWA — config only. Strategy lives in /shared/sw-core.js. */
importScripts('/shared/sw-core.js');

self.createBurnfolderServiceWorker({
  cacheName: 'burnfolder-stream-v42',
  includeRoot: false,
  freshSuffixes: ['/entries.js', '/songs.js', '/shared/site-version.js', '/studio/js/studio-site-menu.js'],
  staticPrefixes: ['/studio/js/', '/studio/css/', '/shared/']
});
