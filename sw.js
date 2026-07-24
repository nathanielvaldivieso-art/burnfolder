/* burnfolder.com — config only. Strategy lives in /shared/sw-core.js. */
importScripts('/shared/sw-core.js');

self.createBurnfolderServiceWorker({
  cacheName: 'burnfolder-site-v20260723a',
  includeRoot: true,
  freshSuffixes: ['/entries.js', '/songs.js', '/album-pages.js', '/song-pages.js', '/spa-router.js', '/shared/site-menu.js', '/shared/site-version.js', '/skins/soft-enter-audio.js', '/skins/skins.js'],
  staticPrefixes: ['/shared/', '/IMAGES/']
});
