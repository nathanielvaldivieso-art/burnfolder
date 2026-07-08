/* burnfolder.com — config only. Strategy lives in /shared/sw-core.js. */
importScripts('/shared/sw-core.js');

self.createBurnfolderServiceWorker({
  cacheName: 'burnfolder-site-v11',
  includeRoot: true,
  freshSuffixes: ['/entries.js', '/songs.js', '/shared/site-version.js'],
  staticPrefixes: ['/shared/', '/IMAGES/']
});
