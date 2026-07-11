/* burnfolder.com — config only. Strategy lives in /shared/sw-core.js. */
importScripts('/shared/sw-core.js');

self.createBurnfolderServiceWorker({
  cacheName: 'burnfolder-site-v27',
  includeRoot: true,
  freshSuffixes: ['/entries.js', '/songs.js', '/album-pages.js', '/song-pages.js', '/spa-router.js', '/shared/site-version.js'],
  staticPrefixes: ['/shared/', '/IMAGES/']
});
