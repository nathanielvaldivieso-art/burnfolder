/**
 * Clips board — Are.na-style typed blocks.
 * Folder pick/drop creates one folder clip; open it to browse/sort contents.
 */
(function () {
  'use strict';

  var store = null;
  var state = null;
  var openGroupId = null;
  var openFolderId = null;
  var boardKindFilter = 'all'; // 'all' | 'video'
  var selectMode = false;
  var selectedBlockIds = {};
  var lastUploadedVideoId = null;
  var bound = false;
  var boundRoot = null;
  var windowEventsBound = false;
  var statusTimer = null;
  var statusSticky = false;
  var initGeneration = 0;
  var libraryCache = [];
  var coverFileInput = null;
  var uploadQueue = null;
  var uploadRowIds = new WeakMap();
  var UPLOAD_CONCURRENCY = 2;

  var IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i;
  var AUDIO_RE = /\.(mp3|wav|flac|aiff|aif|m4a|ogg|aac)(\?.*)?$/i;
  var VIDEO_RE = /\.(mp4|mov|m4v|webm|mkv|avi|mpeg|mpg)(\?.*)?$/i;
  var CAMERA_VIDEO_STEM_RE = /(?:^|[^a-z0-9])(mvi|mov)_\d+/i;

  function el(id) {
    return document.getElementById(id);
  }

  function haptic(pattern) {
    try {
      if (navigator.vibrate) navigator.vibrate(pattern || 12);
    } catch (e) {}
  }

  function setStatus(msg, opts) {
    var node = el('clipsStatus');
    if (!node) return;
    if (statusTimer) clearTimeout(statusTimer);
    statusSticky = !!(opts && opts.sticky);
    node.textContent = '';
    if (msg) node.appendChild(document.createTextNode(msg));
    var action = opts && opts.action;
    if (action && action.label) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'clipsStatusAction';
      btn.className = 'clips-status-action';
      btn.textContent = action.label;
      btn.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof action.onClick === 'function') action.onClick();
      });
      node.appendChild(document.createTextNode(' '));
      node.appendChild(btn);
    }
    if (msg && !statusSticky) {
      statusTimer = setTimeout(function () {
        node.textContent = '';
      }, 4000);
    }
  }

  function ensureUploadQueue() {
    if (uploadQueue) return uploadQueue;
    var host = el('clipsUploadQueue');
    uploadQueue = window.BurnfolderUploadQueue
      ? window.BurnfolderUploadQueue.attach(host)
      : {
          add: function () {
            return '';
          },
          update: function () {},
          remove: function () {}
        };
    return uploadQueue;
  }

  function beginUploadRow(file) {
    var q = ensureUploadQueue();
    var id = q.add(file);
    if (file) uploadRowIds.set(file, id);
    return id;
  }

  function updateUploadRow(file, patch) {
    var id = file && uploadRowIds.get(file);
    if (!id) return;
    ensureUploadQueue().update(id, patch);
  }

  function finishUploadRow(file, ok, errMsg) {
    var id = file && uploadRowIds.get(file);
    if (!id) return;
    var q = ensureUploadQueue();
    if (ok) {
      q.update(id, { percent: 100, status: 'success', message: 'ready ✓' });
      q.remove(id, 1400);
    } else {
      q.update(id, {
        percent: 100,
        status: 'error',
        message: errMsg || 'failed'
      });
      q.remove(id, 8000);
    }
  }

  function runWithConcurrency(items, limit, worker) {
    var list = items || [];
    if (!list.length) return Promise.resolve([]);
    var max = Math.max(1, limit || 1);
    var results = new Array(list.length);
    var next = 0;

    function pump() {
      if (next >= list.length) return Promise.resolve();
      var index = next;
      next += 1;
      return Promise.resolve()
        .then(function () {
          return worker(list[index], index);
        })
        .then(function (value) {
          results[index] = { ok: true, value: value };
        })
        .catch(function (err) {
          results[index] = { ok: false, error: err };
        })
        .then(pump);
    }

    var starters = [];
    for (var i = 0; i < Math.min(max, list.length); i += 1) {
      starters.push(pump());
    }
    return Promise.all(starters).then(function () {
      return results;
    });
  }

  function canWrite() {
    var auth = window.BurnfolderStudioAuth;
    if (auth && typeof auth.canWriteMusic === 'function') return !!auth.canWriteMusic();
    return true;
  }

  function markNav() {
    document.querySelectorAll('.studio-main-nav-link[data-nav]').forEach(function (link) {
      link.classList.toggle('is-active', link.getAttribute('data-nav') === 'clips');
    });
    if (window.BurnfolderStudioSiteMenu && window.BurnfolderStudioSiteMenu.sync) {
      window.BurnfolderStudioSiteMenu.sync();
    }
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function classifyFile(file) {
    var name = (file && file.name) || '';
    var type = (file && file.type) || '';
    if (type.indexOf('image/') === 0 || IMAGE_RE.test(name)) return 'image';
    if (type.indexOf('video/') === 0 || VIDEO_RE.test(name) || CAMERA_VIDEO_STEM_RE.test(name)) {
      return 'video';
    }
    if (type.indexOf('audio/') === 0 || AUDIO_RE.test(name)) return 'audio';
    return 'file';
  }

  function libraryAssetForBlock(block) {
    if (!block || !block.playbackId || !libraryCache || !libraryCache.length) return null;
    var id = block.playbackId;
    for (var i = 0; i < libraryCache.length; i++) {
      var row = libraryCache[i];
      if (row && (row.playbackId === id || row.muxAssetId === id)) return row;
    }
    return null;
  }

  /** Prefer live Mux/library kind so mis-filed camera clips still open as video. */
  function effectiveBlockKind(block) {
    if (!block) return '';
    if (block.kind !== 'audio' && block.kind !== 'video') return block.kind;
    var shared = window.BurnfolderStreamShared;
    var asset = libraryAssetForBlock(block);
    var probe = {
      kind: block.kind,
      playbackId: block.playbackId,
      passthrough: block.passthrough || (asset && asset.passthrough) || '',
      filename: block.filename || (asset && asset.name) || '',
      name: block.filename || block.title || '',
      displayTitle: block.title || '',
      title: block.title || '',
      hasVideoTrack: asset ? asset.hasVideoTrack : undefined,
      isVideo: asset && (asset.isVideo || asset.kind === 'video')
    };
    if (asset && asset.kind) probe.kind = asset.kind;
    if (shared && typeof shared.resolveMediaKind === 'function') {
      return shared.resolveMediaKind(probe);
    }
    if (probe.hasVideoTrack === true || probe.isVideo) return 'video';
    if (
      VIDEO_RE.test(probe.passthrough || probe.filename || probe.name) ||
      CAMERA_VIDEO_STEM_RE.test(probe.passthrough || probe.filename || probe.name || probe.title)
    ) {
      return 'video';
    }
    return block.kind;
  }

  function isMuxable(kind) {
    return kind === 'audio' || kind === 'video';
  }

  function muxThumb(playbackId) {
    if (!playbackId) return '';
    return 'https://image.mux.com/' + encodeURIComponent(playbackId) + '/thumbnail.jpg?time=1&width=480';
  }

  function versionsApi() {
    return window.BurnfolderSongVersions || null;
  }

  function itemLabel(item) {
    var mux = window.BurnfolderStudioMux;
    if (mux && typeof mux.muxFileLabel === 'function') return mux.muxFileLabel(item);
    return (
      (item &&
        (item.muxCanonicalTitle || item.displayTitle || item.passthrough || item.title || item.name)) ||
      'untitled'
    );
  }

  function blockDisplayTitle(block) {
    var raw = (block && (block.title || block.filename || block.passthrough)) || '';
    raw = String(raw).replace(/\.[^.]+$/, '').trim();
    if (!raw) return defaultTitle(block);
    if (store && typeof store.baseTitleForLabel === 'function') {
      return store.baseTitleForLabel(raw) || raw;
    }
    var api = versionsApi();
    if (api && api.stripTrailingDate) return api.stripTrailingDate(raw) || raw;
    return raw;
  }

  function groupKeyForBlock(block) {
    if (!block) return '';
    if (store && typeof store.groupKeyForBlock === 'function') return store.groupKeyForBlock(block);
    var api = versionsApi();
    if (!api || !api.getTrackGroupKey) return block.playbackId || '';
    return api.getTrackGroupKey(blockDisplayTitle(block) || block.title || '');
  }

  function mergedSongCatalog() {
    var api = versionsApi();
    if (!api) return [];
    return api.mergeSongCatalog(api.getSiteCatalog(window), libraryCache, itemLabel);
  }

  function clipsVersionCatalog() {
    var inLibrary = new Set(
      libraryCache
        .map(function (row) {
          return row && row.playbackId;
        })
        .filter(Boolean)
    );
    return mergedSongCatalog().filter(function (song) {
      return song && inLibrary.has(song.playbackId);
    });
  }

  function versionCountForBlock(block) {
    var api = versionsApi();
    if (!api || !block || block.kind !== 'audio') return 1;
    var key = groupKeyForBlock(block);
    if (!key) return 1;
    var versions = api.collectVersionsByGroupKey(clipsVersionCatalog(), key);
    return versions.length || 1;
  }

  function syncNowPlayingCatalog() {
    var provider = {
      getCatalog: clipsVersionCatalog,
      getLibrary: function () {
        return libraryCache;
      },
      labelForItem: itemLabel
    };
    window.BurnfolderPlaybackCatalogProvider = provider;
    if (window.BurnfolderPlaybackContext && window.BurnfolderPlaybackContext.setCatalogProvider) {
      window.BurnfolderPlaybackContext.setCatalogProvider(provider);
    }
    if (window.BurnfolderStreamNowPlaying && window.BurnfolderStreamNowPlaying.setCatalogProvider) {
      window.BurnfolderStreamNowPlaying.setCatalogProvider(provider);
    }
  }

  function getApiBase() {
    var cfg = window.BurnfolderStudioConfig || {};
    if (cfg.muxApiBase) return String(cfg.muxApiBase).replace(/\/$/, '');
    var host = location.hostname;
    var isLocalDevServer =
      (host === 'localhost' || host === '127.0.0.1') && location.port && location.port !== '8888';
    if (isLocalDevServer) return 'http://localhost:8888/.netlify/functions';
    return '/.netlify/functions';
  }

  function authHeaders() {
    var auth = window.BurnfolderStudioAuth;
    return auth && auth.getAuthHeaders ? auth.getAuthHeaders() : {};
  }

  function fetchDownloadUrl(vaultKey, filename, options) {
    var opts = options || {};
    var params = new URLSearchParams();
    params.set('action', 'download');
    params.set('vaultKey', vaultKey);
    if (filename) params.set('filename', filename);
    if (opts.inline) params.set('inline', '1');
    return fetch(getApiBase() + '/studio-vault?' + params.toString(), {
      headers: authHeaders()
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error((data && data.message) || 'download failed');
        return data.downloadUrl || data.url || '';
      });
    });
  }

  function clipDownloadName(block) {
    var raw = (block && (block.filename || block.passthrough || block.title)) || 'clip';
    raw = String(raw)
      .replace(/[\\/]/g, '-')
      .replace(/[^\w.\-()+ ]/g, '-')
      .replace(/-+/g, '-')
      .trim()
      .slice(0, 160);
    if (!raw) raw = 'clip';
    if (
      block &&
      (block.kind === 'audio' || block.kind === 'video') &&
      !/\.[a-z0-9]{2,5}$/i.test(raw)
    ) {
      raw += block.kind === 'audio' ? '.m4a' : '.mp4';
    }
    return raw;
  }

  function canDownloadClip(block) {
    if (!block) return false;
    if (block.kind === 'folder') {
      return (block.items || []).some(function (item) {
        return canDownloadClip(folderItemAsBlock(item));
      });
    }
    if (block.vaultKey) return true;
    if (block.playbackId && (block.kind === 'audio' || block.kind === 'video')) return true;
    return false;
  }

  // Never build a stream.mux.com URL by hand: assets without that exact rendition
  // answer with a tiny error body that the browser saves as the "download".
  // The server confirms a ready rendition and real media bytes first.
  function muxDownloadUrl(playbackId, filename, kind) {
    var params = new URLSearchParams();
    params.set('playbackId', playbackId);
    if (filename) params.set('filename', filename);
    if (kind) params.set('kind', kind);
    return fetch(getApiBase() + '/mux-download?' + params.toString(), {
      headers: authHeaders()
    }).then(function (res) {
      return res
        .json()
        .catch(function () {
          return null;
        })
        .then(function (data) {
          if (res.ok && data && data.url) return data.url;
          var message = (data && data.message) || 'download unavailable';
          var err = new Error(message);
          err.downloadStatus = (data && data.status) || '';
          throw err;
        });
    });
  }

  function saveUrlAsFile(url, filename) {
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return Promise.resolve();
  }

  function resolveClipDownloadUrl(block) {
    if (!block) return Promise.reject(new Error('nothing to download'));
    var name = clipDownloadName(block);
    if (block.vaultKey) return fetchDownloadUrl(block.vaultKey, name);
    if (block.playbackId) return muxDownloadUrl(block.playbackId, name, block.kind);
    return Promise.reject(new Error('nothing to download'));
  }

  function downloadDelay(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  function downloadFolderContents(folder) {
    var items = ((folder && folder.items) || [])
      .map(folderItemAsBlock)
      .filter(canDownloadClip);
    if (!items.length) {
      setStatus('nothing to download');
      return Promise.resolve();
    }
    var index = 0;
    var saved = 0;
    var failures = [];
    var chain = Promise.resolve();
    items.forEach(function (item) {
      chain = chain.then(function () {
        index += 1;
        setStatus('downloading ' + index + '/' + items.length + '…');
        // One unavailable clip must not abort the rest of the folder.
        return resolveClipDownloadUrl(item)
          .then(function (url) {
            if (!url) throw new Error('no url');
            return saveUrlAsFile(url, clipDownloadName(item));
          })
          .then(function () {
            saved += 1;
          })
          .catch(function (err) {
            failures.push((item.title || item.filename || 'clip') + ': ' + ((err && err.message) || 'failed'));
          })
          .then(function () {
            return downloadDelay(350);
          });
      });
    });
    return chain.then(function () {
      if (!failures.length) {
        setStatus('downloaded ' + saved);
        return;
      }
      setStatus('downloaded ' + saved + ' of ' + items.length + ' — ' + failures[0]);
    });
  }

  function downloadClip(block) {
    if (!block) return Promise.resolve();
    if (block.kind === 'folder') return downloadFolderContents(block);
    if (!canDownloadClip(block)) {
      setStatus('nothing to download');
      return Promise.resolve();
    }
    setStatus('downloading…');
    return resolveClipDownloadUrl(block)
      .then(function (url) {
        if (!url) throw new Error('no url');
        return saveUrlAsFile(url, clipDownloadName(block));
      })
      .then(function () {
        setStatus('');
      })
      .catch(function (err) {
        setStatus((err && err.message) || 'download failed');
      });
  }

  function canShareClip(block) {
    return !!(block && effectiveBlockKind(block) === 'video' && block.playbackId);
  }

  function shareGroupKeyForBlock(block) {
    return 'clip:' + block.playbackId;
  }

  function shareIsInactive(share) {
    if (!share) return true;
    if (share.revokedAt) return true;
    if (share.expiresAt && Date.parse(share.expiresAt) < Date.now()) return true;
    if (share.maxPlays != null && share.playCount >= share.maxPlays) return true;
    return false;
  }

  /** Reuse an existing active link for this clip instead of piling up duplicates. */
  function findActiveVideoShare(block, shareOpts) {
    var api = window.BurnfolderShareLinks;
    var opts = shareOpts || {};
    if (!api || !api.listShares) return Promise.resolve(null);
    return api
      .listShares({ groupKey: shareGroupKeyForBlock(block) })
      .then(function (shares) {
        return (
          (shares || []).find(function (s) {
            if (shareIsInactive(s)) return false;
            if (!!s.oneTime !== !!opts.oneTime) return false;
            return true;
          }) || null
        );
      })
      .catch(function () {
        return null;
      });
  }

  function deliverShareLink(share, title) {
    var api = window.BurnfolderShareLinks;
    if (!share || !api) return Promise.reject(new Error('could not create share link'));
    var url = (api.watchPageUrl && api.watchPageUrl(share.token)) || share.url;
    var deliver =
      typeof api.shareOrCopy === 'function'
        ? api.shareOrCopy(url, { title: title, text: title })
        : api.copyText(url).then(function () {
            return { method: 'copy' };
          });
    return deliver.then(function (result) {
      var method = result && result.method;
      if (method === 'cancelled') {
        setStatus('');
        return;
      }
      if (method === 'share') {
        setStatus('shared');
        return;
      }
      setStatus('share link copied');
    });
  }

  function shareClip(block, shareOpts) {
    var api = window.BurnfolderShareLinks;
    var opts = shareOpts || {};
    if (!api || !canShareClip(block)) {
      setStatus('nothing to share');
      return Promise.resolve();
    }
    setStatus('creating share link…');
    var reuse =
      opts.tracks || opts.groupKey
        ? Promise.resolve(null)
        : findActiveVideoShare(block, opts);
    return reuse
      .then(function (existing) {
        if (existing) return existing;
        var tracks =
          opts.tracks ||
          [
            {
              title: opts.title || block.title || 'clip',
              playbackId: block.playbackId,
              kind: 'video',
              filename: clipDownloadName(block)
            }
          ];
        return api
          .createShare({
            scope: 'video',
            groupKey: opts.groupKey || shareGroupKeyForBlock(block),
            title: opts.title || block.title || 'clip',
            expiresIn: opts.expiresIn || '7d',
            oneTime: !!opts.oneTime,
            tracks: tracks
          })
          .then(function (data) {
            return data && data.share;
          });
      })
      .then(function (share) {
        if (!share) throw new Error('could not create share link');
        return deliverShareLink(share, opts.title || block.title || 'clip');
      })
      .catch(function (err) {
        setStatus((err && err.message) || 'could not create share link');
      });
  }

  function shareBlocks(blocks, shareOpts) {
    var videos = (blocks || []).filter(canShareClip);
    if (!videos.length) {
      setStatus('nothing to share');
      return Promise.resolve();
    }
    if (videos.length === 1) return shareClip(videos[0], shareOpts);
    var opts = shareOpts || {};
    var api = window.BurnfolderShareLinks;
    if (!api || typeof api.createShare !== 'function') {
      setStatus('sharing unavailable');
      return Promise.resolve();
    }
    setStatus('creating share link…');
    return api
      .createShare({
        scope: 'video',
        groupKey:
          opts.groupKey ||
          ('batch:' +
            videos
              .map(function (b) {
                return b.playbackId;
              })
              .sort()
              .join(',')),
        title: opts.title || videos.length + ' clips',
        expiresIn: opts.expiresIn || '7d',
        oneTime: !!opts.oneTime,
        tracks: videos.map(function (b) {
          return {
            title: b.title || 'clip',
            playbackId: b.playbackId,
            kind: 'video',
            filename: clipDownloadName(b)
          };
        })
      })
      .then(function (data) {
        var share = data && data.share;
        if (!share) throw new Error('could not create share link');
        return deliverShareLink(share, opts.title || videos.length + ' clips');
      })
      .catch(function (err) {
        setStatus((err && err.message) || 'could not create share link');
      });
  }

  function selectedBlocks() {
    var blocks = (state && state.blocks) || [];
    return blocks.filter(function (block) {
      return block && selectedBlockIds[block.id] && canShareClip(block);
    });
  }

  function selectedCount() {
    return Object.keys(selectedBlockIds).filter(function (id) {
      return !!selectedBlockIds[id];
    }).length;
  }

  function clearSelection() {
    selectedBlockIds = {};
  }

  function toggleBlockSelected(blockId) {
    if (!blockId) return;
    if (selectedBlockIds[blockId]) delete selectedBlockIds[blockId];
    else selectedBlockIds[blockId] = true;
    renderBoard();
  }

  function blockActionsMenuHtml(block, opts) {
    var o = opts || {};
    var removeAttr = o.folderItem ? 'data-folder-item-remove="1"' : 'data-remove="1"';
    var downloadItem = canDownloadClip(block)
      ? '<button type="button" class="clips-block-menu-item" data-download="1" role="menuitem">Download</button>'
      : '';
    var shareItem = canShareClip(block)
      ? '<button type="button" class="clips-block-menu-item" data-share="1" role="menuitem">Share (7d)</button>' +
        '<button type="button" class="clips-block-menu-item" data-share-once="1" role="menuitem">Share once</button>'
      : '';
    return (
      '<div class="clips-block-menu">' +
      '<button type="button" class="clips-block-more" data-clip-more="1" aria-label="More actions" aria-haspopup="menu" aria-expanded="false" title="more">⋯</button>' +
      '<div class="clips-block-menu-panel" role="menu" hidden>' +
      shareItem +
      downloadItem +
      '<button type="button" class="clips-block-menu-item" ' +
      removeAttr +
      ' role="menuitem">Remove</button>' +
      '</div>' +
      '</div>'
    );
  }

  function normalizeClipName(raw) {
    return String(raw || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
  }

  function openCollectionMeta() {
    var shared = window.BurnfolderStreamShared;
    if (!shared || !openGroupId || !shared.loadStackMeta) return { title: '', coverArt: '' };
    var meta = shared.loadStackMeta(openGroupId) || {};
    var album = store && state ? store.findAlbumBlock(state, openGroupId) : null;
    return {
      title: normalizeClipName(meta.title || (album && album.title) || ''),
      coverArt: meta.coverArt || (album && album.coverArt) || '',
      coverAssetId: meta.coverAssetId || '',
      coverAlt: meta.coverAlt || meta.title || ''
    };
  }

  function syncPageChrome() {
    var node = document.querySelector('#clipsRoot > .page-id');
    if (!node) return;
    if (openFolderId) {
      document.body.classList.add('clips-folder-open');
      document.body.classList.remove('clips-collection-open');
      var folder = findBlock(openFolderId);
      var folderName = (folder && folder.title) || 'folder';
      node.innerHTML =
        '<button type="button" class="clips-crumb-back" id="clipsCrumbBack">clips</button>' +
        '<span class="clips-crumb-sep"> — </span>' +
        '<span class="clips-crumb-current">' +
        escapeHtml(folderName) +
        '</span>';
      var folderBack = el('clipsCrumbBack');
      if (folderBack) {
        folderBack.addEventListener('click', function (event) {
          event.preventDefault();
          closeFolder();
        });
      }
      if (window.BurnfolderStudioSiteMenu && typeof window.BurnfolderStudioSiteMenu.sync === 'function') {
        window.BurnfolderStudioSiteMenu.sync();
      }
      return;
    }
    document.body.classList.remove('clips-folder-open');
    if (!openGroupId) {
      node.textContent = 'clips';
      document.body.classList.remove('clips-collection-open');
      if (window.BurnfolderStudioSiteMenu && typeof window.BurnfolderStudioSiteMenu.sync === 'function') {
        window.BurnfolderStudioSiteMenu.sync();
      }
      return;
    }
    document.body.classList.add('clips-collection-open');
    var meta = openCollectionMeta();
    var name = meta.title || 'collection';
    node.innerHTML =
      '<button type="button" class="clips-crumb-back" id="clipsCrumbBack">clips</button>' +
      '<span class="clips-crumb-sep"> — </span>' +
      '<span class="clips-crumb-current">' +
      escapeHtml(name) +
      '</span>';
    var back = el('clipsCrumbBack');
    if (back) {
      back.addEventListener('click', function (event) {
        event.preventDefault();
        closeCollection();
      });
    }
    if (window.BurnfolderStudioSiteMenu && typeof window.BurnfolderStudioSiteMenu.sync === 'function') {
      window.BurnfolderStudioSiteMenu.sync();
    }
  }

  function closeCollection() {
    openGroupId = null;
    render();
  }

  function closeFolder() {
    openFolderId = null;
    render();
  }

  function openFolder(block) {
    if (!block || block.kind !== 'folder') return;
    openGroupId = null;
    openFolderId = block.id;
    render();
  }

  function audioBlockForTrack(track) {
    if (!track || !state) return null;
    if (track.playbackId && store.findBlockByPlaybackId) {
      var byId = store.findBlockByPlaybackId(state, track.playbackId);
      if (byId && byId.kind === 'audio') return byId;
    }
    var title = track.title || '';
    var key =
      versionsApi() && versionsApi().getTrackGroupKey
        ? versionsApi().getTrackGroupKey(title)
        : '';
    if (key && store.findAudioBlockByGroupKey) {
      return store.findAudioBlockByGroupKey(state, key);
    }
    return null;
  }

  /** Unique songs in a collection, music-page collapse rules. */
  function songRowsForGroup(group) {
    if (!group) return [];
    var api = versionsApi();
    var rows = [];
    var byKey = new Map();

    (group.tracks || []).forEach(function (track) {
      if (!track || !track.playbackId) return;
      var block = audioBlockForTrack(track);
      var title = (block && blockDisplayTitle(block)) || track.title || 'untitled';
      var key =
        (api && api.getTrackGroupKey && api.getTrackGroupKey(title)) || track.playbackId;
      var versionCount = 1;
      if (api && api.collectVersionsByGroupKey) {
        versionCount = Math.max(
          1,
          (api.collectVersionsByGroupKey(clipsVersionCatalog(), key) || []).length
        );
      }
      if (!byKey.has(key)) {
        var row = {
          key: key,
          track: track,
          block: block,
          title: api && api.stripTrailingDate ? api.stripTrailingDate(title) || title : title,
          playbackId: (block && block.playbackId) || track.playbackId,
          versionCount: versionCount
        };
        byKey.set(key, row);
        rows.push(row);
        return;
      }
      var existing = byKey.get(key);
      existing.versionCount = Math.max(existing.versionCount, versionCount);
      if (block && (!existing.block || block.playbackId !== existing.playbackId)) {
        existing.block = block || existing.block;
        existing.playbackId = (block && block.playbackId) || existing.playbackId;
        existing.title =
          api && api.stripTrailingDate ? api.stripTrailingDate(title) || title : title;
      }
    });
    return rows;
  }

  function collectionSongRows() {
    var shared = window.BurnfolderStreamShared;
    if (!shared || !openGroupId) return [];
    return songRowsForGroup(shared.findGroupById(openGroupId));
  }

  /**
   * Continuous listen from the open collection through every collection after it.
   * Lock-screen advance needs this queue up front — DOM rebuild is unavailable while locked.
   */
  function collectionQueueFromOpen() {
    var shared = window.BurnfolderStreamShared;
    if (!shared || !openGroupId || typeof shared.loadGroups !== 'function') {
      return collectionSongRows();
    }
    var groups = shared.loadGroups() || [];
    var startIdx = groups.findIndex(function (g) {
      return g && g.id === openGroupId;
    });
    if (startIdx < 0) return collectionSongRows();
    var rows = [];
    for (var i = startIdx; i < groups.length; i++) {
      rows = rows.concat(songRowsForGroup(groups[i]));
    }
    return rows.length ? rows : collectionSongRows();
  }

  function unfiledAudioBlocks() {
    var membership = housedMembership();
    if (!state) return [];
    return (state.blocks || []).filter(function (block) {
      return block.kind === 'audio' && !isAudioHoused(block, membership);
    });
  }

  function collectionChromeHtml(meta) {
    var title = meta.title || '';
    var coverStyle = meta.coverArt
      ? ' style="background-image:url(\'' + escapeHtml(meta.coverArt) + '\')"'
      : '';
    return (
      '<header class="clips-collection-chrome">' +
      '<button type="button" class="clips-collection-cover' +
      (meta.coverArt ? '' : ' is-empty') +
      '" id="clipsCollectionCover" aria-label="' +
      (meta.coverArt ? 'Change cover' : 'Add cover') +
      '"' +
      coverStyle +
      '>' +
      (meta.coverArt ? '' : '<span>cover</span>') +
      '</button>' +
      '<div class="clips-collection-meta">' +
      '<input type="text" class="clips-collection-name" id="clipsCollectionName" ' +
      'maxlength="80" spellcheck="false" autocomplete="off" placeholder="name" value="' +
      escapeHtml(title) +
      '" />' +
      '<div class="clips-collection-actions">' +
      '<button type="button" class="clips-collection-play" id="clipsCollectionPlay" aria-label="Play">▶</button>' +
      (meta.coverArt
        ? '<button type="button" class="clips-collection-cover-clear" id="clipsCollectionCoverClear" aria-label="Remove cover">×</button>'
        : '') +
      '</div>' +
      '</div>' +
      '</header>'
    );
  }

  function songTileHtml(row, opts) {
    var o = opts || {};
    var versionCount = row.versionCount || 1;
    var blockId = (row.block && row.block.id) || '';
    var seed = blockId || row.key || row.playbackId || row.title || '';
    return (
      '<article class="clips-block clips-block--audio' +
      (versionCount > 0 ? ' has-density' : '') +
      (o.unfiled ? ' clips-block--unfiled' : ' clips-block--collection-track') +
      '" data-kind="audio"' +
      (blockId ? ' data-block-id="' + escapeHtml(blockId) + '"' : '') +
      ' data-playback-id="' +
      escapeHtml(row.playbackId || '') +
      '"' +
      (row.key ? ' data-song-key="' + escapeHtml(row.key) + '"' : '') +
      (o.unfiled ? ' data-unfiled="1"' : ' data-collection-track="1"') +
      ' data-item-count="' +
      versionCount +
      '" tabindex="0">' +
      blockActionsMenuHtml(row.block || { kind: 'audio', title: row.title }) +
      densityMarksHtml(seed, versionCount) +
      '<div class="clips-block-media clips-block-media--blank" aria-hidden="true"></div>' +
      '<h3 class="clips-block-title">' +
      escapeHtml(row.title || 'untitled') +
      '</h3>' +
      '</article>'
    );
  }

  function renderCollectionBoard() {
    var board = el('clipsBoard');
    if (!board || !state) return;
    var shared = window.BurnfolderStreamShared;
    var group = shared && shared.findGroupById ? shared.findGroupById(openGroupId) : null;
    if (!group) {
      setStatus('collection not found');
      openGroupId = null;
      renderBoard();
      return;
    }

    var meta = openCollectionMeta();
    var rows = collectionSongRows();
    var loose = unfiledAudioBlocks().map(function (block) {
      return {
        key: groupKeyForBlock(block),
        track: { playbackId: block.playbackId, title: block.title },
        block: block,
        title: blockDisplayTitle(block),
        playbackId: block.playbackId,
        versionCount: versionCountForBlock(block)
      };
    });

    var html = collectionChromeHtml(meta);
    html +=
      '<div class="clips-collection-grid clips-collection-drop" id="clipsCollectionGrid" aria-label="Collection">';
    if (!rows.length) {
      html +=
        '<p class="clips-collection-empty">drop songs here from unfiled</p>';
    } else {
      html += rows
        .map(function (row) {
          return songTileHtml(row, { unfiled: false });
        })
        .join('');
    }
    html += '</div>';

    html +=
      '<section class="clips-unfiled-shelf" id="clipsUnfiledShelf" aria-label="Unfiled clips">' +
      '<p class="clips-unfiled-label">unfiled</p>' +
      '<div class="clips-unfiled-grid">';
    if (!loose.length) {
      html += '<p class="clips-unfiled-empty">nothing loose</p>';
    } else {
      html += loose
        .map(function (row) {
          return songTileHtml(row, { unfiled: true });
        })
        .join('');
    }
    html += '</div></section>';

    board.innerHTML = html;
    board.classList.add('clips-board--collection');
    wireCollectionChrome();
    resolveCollectionCoverPreview(meta);
    wireBlockTaps(board);
    syncPlayingBlocks();
  }

  function resolveCollectionCoverPreview(meta) {
    var coverBtn = el('clipsCollectionCover');
    var coverApi = window.BurnfolderCoverArt;
    if (!coverBtn || !meta || !(meta.coverArt || meta.coverAssetId)) return;
    if (!coverApi || typeof coverApi.resolveCoverPreviewUrl !== 'function') return;
    coverApi.resolveCoverPreviewUrl(meta).then(function (src) {
      if (!src || !coverBtn.isConnected) return;
      coverBtn.style.backgroundImage = "url('" + String(src).replace(/'/g, '%27') + "')";
      coverBtn.classList.remove('is-empty');
      coverBtn.innerHTML = '';
    });
  }

  /** Cover fields for a playlist tile — prefer live stack meta over the block snapshot. */
  function albumCoverMeta(block) {
    var shared = window.BurnfolderStreamShared;
    var fromBlock = {
      coverArt: (block && block.coverArt) || '',
      coverAssetId: (block && block.coverAssetId) || '',
      coverAlt: (block && block.title) || ''
    };
    if (!block || !block.groupId || !shared || !shared.loadStackMeta) return fromBlock;
    var meta = shared.loadStackMeta(block.groupId) || {};
    return {
      coverArt: meta.coverArt || fromBlock.coverArt || '',
      coverAssetId: meta.coverAssetId || fromBlock.coverAssetId || '',
      coverAlt: meta.coverAlt || meta.title || fromBlock.coverAlt || ''
    };
  }

  /** How many tracks live in an album/collection clip. */
  function albumTrackCount(block) {
    var shared = window.BurnfolderStreamShared;
    if (!block || !block.groupId || !shared || typeof shared.findGroupById !== 'function') {
      return 0;
    }
    var group = shared.findGroupById(block.groupId);
    return (group && group.tracks && group.tracks.length) || 0;
  }

  /** “How much stuff” signal for density marks on any clip. */
  function blockItemCount(block) {
    if (!block) return 0;
    if (block.kind === 'album') return albumTrackCount(block);
    if (block.kind === 'folder') return (block.items && block.items.length) || 0;
    if (block.kind === 'audio') return versionCountForBlock(block);
    return 1;
  }

  /** Map item count → stroke count (same fullness ≈ same amount of ink). */
  function densityMarkCount(itemCount) {
    var n = Math.max(0, itemCount | 0);
    if (n <= 0) return 0;
    if (n === 1) return 1;
    if (n === 2) return 3;
    if (n === 3) return 4;
    if (n <= 5) return 6;
    if (n <= 8) return 8;
    return Math.min(14, 7 + Math.floor(n / 2));
  }

  function hashSeed(str) {
    var h = 2166136261;
    var s = String(str || '');
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function nextRand(h) {
    return (Math.imul(h, 1664525) + 1013904223) >>> 0;
  }

  function randUnit(h) {
    return (h >>> 0) / 4294967296;
  }

  /**
   * Layout families — same stroke count can land in very different shapes,
   * so two 2-track folders read as “about as full” but look like different constellations.
   */
  function densityLayoutPoint(layout, index, total, h) {
    var t = total <= 1 ? 0 : index / (total - 1);
    var x;
    var y;
    h = nextRand(h);
    var jx = randUnit(h) * 14 - 7;
    h = nextRand(h);
    var jy = randUnit(h) * 14 - 7;

    switch (layout) {
      case 1: // left cluster
        h = nextRand(h);
        x = 10 + randUnit(h) * 38;
        h = nextRand(h);
        y = 12 + randUnit(h) * 70;
        break;
      case 2: // right cluster
        h = nextRand(h);
        x = 48 + randUnit(h) * 40;
        h = nextRand(h);
        y = 12 + randUnit(h) * 70;
        break;
      case 3: // top band
        h = nextRand(h);
        x = 8 + randUnit(h) * 80;
        h = nextRand(h);
        y = 8 + randUnit(h) * 32;
        break;
      case 4: // bottom band
        h = nextRand(h);
        x = 8 + randUnit(h) * 80;
        h = nextRand(h);
        y = 48 + randUnit(h) * 36;
        break;
      case 5: // diagonal drift \
        x = 10 + t * 70 + jx;
        y = 12 + t * 64 + jy;
        break;
      case 6: // diagonal drift /
        x = 78 - t * 70 + jx;
        y = 12 + t * 64 + jy;
        break;
      case 7: // two pockets
        h = nextRand(h);
        if (index % 2 === 0) {
          x = 10 + randUnit(h) * 32;
          h = nextRand(h);
          y = 10 + randUnit(h) * 36;
        } else {
          x = 52 + randUnit(h) * 34;
          h = nextRand(h);
          y = 42 + randUnit(h) * 36;
        }
        break;
      case 8: // loose ring
        h = nextRand(h);
        var ang = (Math.PI * 2 * index) / Math.max(total, 1) + randUnit(h) * 0.55;
        h = nextRand(h);
        var rad = 22 + randUnit(h) * 16;
        x = 48 + Math.cos(ang) * rad * 1.15;
        y = 46 + Math.sin(ang) * rad;
        break;
      default: // open scatter
        h = nextRand(h);
        x = 8 + randUnit(h) * 80;
        h = nextRand(h);
        y = 10 + randUnit(h) * 72;
        break;
    }

    if (layout < 5 || layout > 6) {
      x += jx * 0.35;
      y += jy * 0.35;
    }
    x = Math.max(4, Math.min(92, x));
    y = Math.max(6, Math.min(88, y));
    return { x: x, y: y, h: h };
  }

  /**
   * Per-clip constellation of strokes.
   * Count ≈ fullness; arrangement/angles/weights are a stable fingerprint from seed.
   */
  function densityMarksHtml(seed, itemCount) {
    var count = densityMarkCount(itemCount);
    if (count <= 0) return '';

    var h = hashSeed(String(seed || 'clip'));
    // Mix the seed a few times so nearby ids don’t share a family.
    h = nextRand(h ^ (count * 2654435761));
    h = nextRand(h);

    var layout = h % 9;
    h = nextRand(h);
    var angleBias = randUnit(h) * 70 - 35;
    h = nextRand(h);
    var lengthScale = 0.75 + randUnit(h) * 0.7;
    h = nextRand(h);
    var vertChance = 0.08 + randUnit(h) * 0.42;
    h = nextRand(h);
    var weightChance = 0.12 + randUnit(h) * 0.35;
    h = nextRand(h);
    var opacityBase = 0.55 + randUnit(h) * 0.3;

    var marks = [];
    for (var i = 0; i < count; i++) {
      var point = densityLayoutPoint(layout, i, count, h);
      h = point.h;

      h = nextRand(h);
      var isVert = randUnit(h) < vertChance;
      h = nextRand(h);
      var len = (isVert ? 5 : 8) + randUnit(h) * (isVert ? 12 : 16);
      len = Math.max(4, Math.round(len * lengthScale));
      h = nextRand(h);
      var thick = randUnit(h) < weightChance ? 2.25 : 1.35;
      h = nextRand(h);
      var rot;
      if (isVert) {
        rot = 80 + randUnit(h) * 30 + angleBias * 0.15;
      } else {
        rot = angleBias + (randUnit(h) * 50 - 25);
      }
      h = nextRand(h);
      var opacity = Math.max(0.4, Math.min(0.92, opacityBase + (randUnit(h) * 0.22 - 0.1)));

      marks.push(
        '<span class="clips-density-mark' +
          (isVert ? ' is-vert' : '') +
          '" style="left:' +
          point.x.toFixed(1) +
          '%;top:' +
          point.y.toFixed(1) +
          '%;width:' +
          len +
          'px;height:' +
          thick +
          'px;opacity:' +
          opacity.toFixed(2) +
          ';transform:rotate(' +
          rot.toFixed(1) +
          'deg)"></span>'
      );
    }

    return (
      '<div class="clips-density" data-layout="' +
      layout +
      '" aria-hidden="true">' +
      marks.join('') +
      '</div>'
    );
  }

  /** Body under the title — media/text when useful, else a blank field for density marks. */
  function blockBodyHtml(block, playKind) {
    var kind = playKind || (block && block.kind) || '';
    var html = '';
    if (kind === 'image' || kind === 'video' || kind === 'folder') {
      html = blockPreview(block, kind);
    } else if (kind === 'text' || kind === 'link' || kind === 'file') {
      html = blockPreview(block, kind);
    } else if (kind === 'album' || kind === 'audio' || kind === 'tool') {
      html = blockPreview(block, kind);
    } else {
      html = '<div class="clips-block-media clips-block-media--blank" aria-hidden="true"></div>';
    }
    return html;
  }

  function boardBlockHtml(block) {
    var playKind = effectiveBlockKind(block) || block.kind;
    var itemCount = blockItemCount(block);
    var title =
      block.kind === 'audio' || playKind === 'audio'
        ? blockDisplayTitle(block)
        : block.title || defaultTitle(block);
    var songKey =
      playKind === 'audio' && groupKeyForBlock(block) ? groupKeyForBlock(block) : '';
    var showDensity = playKind !== 'video' && playKind !== 'image' && itemCount > 0;
    var isSelected = !!(selectMode && selectedBlockIds[block.id]);
    var selectMark =
      selectMode && playKind === 'video'
        ? '<span class="clips-block-select-mark" aria-hidden="true"></span>'
        : '';
    return (
      '<article class="clips-block clips-block--' +
      escapeHtml(playKind || block.kind) +
      (showDensity ? ' has-density' : '') +
      (isSelected ? ' is-selected' : '') +
      '" data-block-id="' +
      escapeHtml(block.id) +
      '" data-kind="' +
      escapeHtml(playKind || block.kind) +
      '"' +
      (block.kind === 'album' && block.groupId
        ? ' data-group-id="' + escapeHtml(block.groupId) + '"'
        : '') +
      (songKey ? ' data-song-key="' + escapeHtml(songKey) + '"' : '') +
      ' data-item-count="' +
      itemCount +
      '" tabindex="0">' +
      selectMark +
      blockActionsMenuHtml(block) +
      (showDensity ? densityMarksHtml(block.id || block.groupId || title, itemCount) : '') +
      blockBodyHtml(block, playKind) +
      '<h3 class="clips-block-title">' +
      escapeHtml(title) +
      '</h3>' +
      '</article>'
    );
  }

  function resolveAlbumCoverPreviews(board) {
    if (!board) return;
    var coverApi = window.BurnfolderCoverArt;
    if (!coverApi || typeof coverApi.resolveCoverPreviewUrl !== 'function') return;
    board.querySelectorAll('[data-album-cover]').forEach(function (node) {
      var groupId = node.getAttribute('data-group-id') || '';
      var block =
        groupId && store && state && store.findAlbumBlock
          ? store.findAlbumBlock(state, groupId)
          : null;
      var meta = albumCoverMeta(
        block || { groupId: groupId, coverArt: '', coverAssetId: '', title: '' }
      );
      if (!(meta.coverArt || meta.coverAssetId)) return;
      coverApi.resolveCoverPreviewUrl(meta).then(function (src) {
        if (!src || !node.isConnected) return;
        node.style.backgroundImage = "url('" + String(src).replace(/'/g, '%27') + "')";
        node.classList.remove('clips-block-media--empty');
        node.textContent = '';
      });
    });
  }

  function wireCollectionChrome() {
    var nameInput = el('clipsCollectionName');
    if (nameInput && nameInput.dataset.bound !== '1') {
      nameInput.dataset.bound = '1';
      var commitName = function () {
        if (!canWrite() || !openGroupId) return;
        var next = normalizeClipName(nameInput.value);
        nameInput.value = next;
        store.patchAlbumPresentation(openGroupId, { title: next }).then(function () {
          return refresh();
        });
      };
      nameInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          nameInput.blur();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          nameInput.value = openCollectionMeta().title || '';
          nameInput.blur();
        }
      });
      nameInput.addEventListener('blur', commitName);
    }

    var coverBtn = el('clipsCollectionCover');
    if (coverBtn && coverBtn.dataset.bound !== '1') {
      coverBtn.dataset.bound = '1';
      coverBtn.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (!canWrite()) {
          setStatus('read only');
          return;
        }
        ensureCoverFileInput().click();
      });
    }

    var clearBtn = el('clipsCollectionCoverClear');
    if (clearBtn && clearBtn.dataset.bound !== '1') {
      clearBtn.dataset.bound = '1';
      clearBtn.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (!canWrite() || !openGroupId) return;
        store
          .patchAlbumPresentation(openGroupId, {
            coverArt: '',
            coverAssetId: '',
            coverAlt: ''
          })
          .then(function () {
            setStatus('cover removed');
            return refresh();
          });
      });
    }

    var playBtn = el('clipsCollectionPlay');
    if (playBtn && playBtn.dataset.bound !== '1') {
      playBtn.dataset.bound = '1';
      playBtn.addEventListener('click', function (event) {
        event.preventDefault();
        var player = window.BurnfolderStreamPlayer;
        if (playBtn.classList.contains('is-playing') && player && player.togglePause) {
          player.togglePause();
          syncPlayingBlocks();
          if (playBtn.blur) playBtn.blur();
          return;
        }
        playCollectionFrom(0);
        if (playBtn.blur) playBtn.blur();
      });
    }
  }

  function ensureCoverFileInput() {
    if (coverFileInput) return coverFileInput;
    coverFileInput = document.createElement('input');
    coverFileInput.type = 'file';
    coverFileInput.accept = 'image/*';
    coverFileInput.hidden = true;
    document.body.appendChild(coverFileInput);
    coverFileInput.addEventListener('change', function () {
      var file = coverFileInput.files && coverFileInput.files[0];
      coverFileInput.value = '';
      if (!file || !openGroupId) return;
      var coverApi = window.BurnfolderCoverArt;
      var meta = openCollectionMeta();
      var label = meta.title || 'collection';
      if (!coverApi || !coverApi.registerCoverFromFile) {
        setStatus('image storage unavailable');
        return;
      }
      setStatus('saving cover…');
      coverApi
        .registerCoverFromFile(file, label, { download: false })
        .then(function (result) {
          return store.patchAlbumPresentation(openGroupId, {
            coverArt: result.coverArt || result.publicPath || '',
            coverAssetId: result.coverAssetId || result.id || '',
            coverAlt: result.coverAlt || label
          });
        })
        .then(function () {
          setStatus('cover set');
          return refresh();
        })
        .catch(function (err) {
          setStatus((err && err.message) || 'could not set cover');
        });
    });
    return coverFileInput;
  }

  function releaseClipKeyboardFocus() {
    var active = document.activeElement;
    if (
      active &&
      active !== document.body &&
      typeof active.blur === 'function' &&
      active.classList &&
      active.classList.contains('clips-block')
    ) {
      active.blur();
    }
  }

  function playCollectionFrom(index, startPlaybackId) {
    var groupRows = collectionSongRows();
    if (!groupRows.length) return;
    var player = window.BurnfolderStreamPlayer;
    var shell = window.BurnfolderStudioPlaybackShell;
    if (shell) {
      if (shell.ensureShell) shell.ensureShell();
      if (shell.mountBar) shell.mountBar();
    }
    if (!player || typeof player.playQueue !== 'function') {
      setStatus('playback unavailable');
      return;
    }
    // Same active track → pause/resume (Space / re-activate), not restart.
    if (
      startPlaybackId &&
      typeof player.isActivePlaybackId === 'function' &&
      player.isActivePlaybackId(startPlaybackId) &&
      typeof player.togglePause === 'function'
    ) {
      player.togglePause();
      syncPlayingBlocks();
      releaseClipKeyboardFocus();
      return;
    }
    var startIndexInGroup = typeof index === 'number' ? index : 0;
    if (startPlaybackId) {
      var groupById = groupRows.findIndex(function (row) {
        return row.playbackId === startPlaybackId;
      });
      if (groupById >= 0) startIndexInGroup = groupById;
    }
    var started = groupRows[startIndexInGroup] || groupRows[0];
    var queueRows = collectionQueueFromOpen();
    var tracks = queueRows.map(function (row) {
      return {
        title: row.title,
        displayTitle: row.title,
        playbackId: row.playbackId,
        kind: 'audio',
        passthrough: row.title
      };
    });
    var idx = 0;
    if (started && started.playbackId) {
      var inQueue = tracks.findIndex(function (t) {
        return t.playbackId === started.playbackId;
      });
      idx = inQueue >= 0 ? inQueue : 0;
    } else {
      idx = Math.min(startIndexInGroup, Math.max(0, tracks.length - 1));
    }
    var meta = openCollectionMeta();
    player.playQueue(tracks, idx, {
      coverArt: meta.coverArt || '',
      startPlaybackId: (started && started.playbackId) || startPlaybackId || ''
    });
    syncPlayingBlocks();
    releaseClipKeyboardFocus();
  }

  function fileIntoOpenCollection(block) {
    var shared = window.BurnfolderStreamShared;
    if (!shared || !openGroupId || !block || block.kind !== 'audio') {
      return Promise.resolve(false);
    }
    var added = shared.addToGroup(blockAsPlayItem(block), openGroupId);
    if (!added || !added.ok) return Promise.resolve(false);
    var name = openCollectionMeta().title || 'collection';
    return store.ensureAlbumBlock(openGroupId, name).then(function () {
      setStatus('filed in ' + name);
      return refresh();
    }).then(function () {
      return true;
    });
  }

  function unfileFromOpenCollection(playbackId, songKey) {
    var shared = window.BurnfolderStreamShared;
    if (!shared || (!playbackId && !songKey)) return Promise.resolve(false);
    var id = songKey || playbackId;
    if (shared.removeUniqueSong) {
      shared.removeUniqueSong(id, openGroupId);
    } else {
      shared.removeFromStack(playbackId);
    }
    setStatus('moved to unfiled');
    return refresh().then(function () {
      return true;
    });
  }

  /**
   * Arrange unique songs inside an open collection. Preserves stack membership
   * (version clusters move as one) and never A–Z sorts — photonegative keeps
   * curated order unless you drag it.
   */
  function reorderOpenCollection(fromId, ontoId, before) {
    var shared = window.BurnfolderStreamShared;
    if (!shared || !openGroupId || !fromId || !ontoId) return false;
    if (fromId === ontoId) return false;
    if (!shared.reorderUniqueSongs) return false;
    var result = shared.reorderUniqueSongs(
      fromId,
      ontoId,
      openGroupId,
      before !== false
    );
    return !!(result && result.ok);
  }

  function firstFolderImage(block) {
    var items = (block && block.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i] && items[i].kind === 'image' && items[i].vaultKey) return items[i];
    }
    return null;
  }

  function folderItemAsBlock(item) {
    if (!item) return null;
    return {
      id: item.id,
      kind: item.kind,
      title: item.title,
      playbackId: item.playbackId,
      vaultKey: item.vaultKey,
      filename: item.filename,
      contentType: item.contentType,
      size: item.size,
      passthrough: item.passthrough
    };
  }

  function folderSortControlsHtml(folder) {
    var sortBy = (folder && folder.sortBy) || 'name';
    var folderName = (folder && folder.title) || 'folder';
    return (
      '<div class="clips-folder-toolbar">' +
      '<button type="button" class="clips-folder-back" id="clipsFolderBack" aria-label="Back to clips">← clips</button>' +
      '<span class="clips-folder-title">' +
      escapeHtml(folderName) +
      '</span>' +
      '<label class="clips-folder-sort-label" for="clipsFolderSort">sort</label>' +
      '<select id="clipsFolderSort" class="clips-folder-sort">' +
      '<option value="name"' +
      (sortBy === 'name' ? ' selected' : '') +
      '>name</option>' +
      '<option value="newest"' +
      (sortBy === 'newest' ? ' selected' : '') +
      '>newest</option>' +
      '<option value="type"' +
      (sortBy === 'type' ? ' selected' : '') +
      '>type</option>' +
      '</select>' +
      '</div>'
    );
  }

  function folderItemTileHtml(item) {
    var asBlock = folderItemAsBlock(item);
    if (!asBlock) return '';
    var playKind = effectiveBlockKind(asBlock) || asBlock.kind;
    var title = asBlock.title || asBlock.filename || 'file';
    return (
      '<article class="clips-block clips-block--' +
      escapeHtml(playKind) +
      '" data-folder-item-id="' +
      escapeHtml(item.id) +
      '" data-kind="' +
      escapeHtml(playKind) +
      '" tabindex="0">' +
      blockActionsMenuHtml(asBlock, { folderItem: true }) +
      blockBodyHtml(asBlock, playKind) +
      '<h3 class="clips-block-title">' +
      escapeHtml(title) +
      '</h3>' +
      '</article>'
    );
  }

  function renderFolderBoard() {
    var board = el('clipsBoard');
    if (!board || !state) return;
    var folder = findBlock(openFolderId);
    if (!folder || folder.kind !== 'folder') {
      openFolderId = null;
      renderBoard();
      return;
    }
    syncPageChrome();
    var items = store.sortedFolderItems ? store.sortedFolderItems(folder) : folder.items || [];
    var html = folderSortControlsHtml(folder);
    if (!items.length) {
      html += '<p class="clips-folder-empty">empty folder</p>';
    } else {
      html += items.map(folderItemTileHtml).join('');
    }
    board.classList.remove('clips-board--collection');
    board.classList.add('clips-board--folder');
    board.innerHTML = html;
    wireFolderBoard(board);
    board.querySelectorAll('[data-vault-preview]').forEach(function (node) {
      var key = node.getAttribute('data-vault-preview');
      if (!key) return;
      fetchDownloadUrl(key, '', { inline: true })
        .then(function (url) {
          if (!url || !node.isConnected) return;
          node.style.backgroundImage = "url('" + url.replace(/'/g, '%27') + "')";
        })
        .catch(function () {});
    });
  }

  function wireFolderBoard(board) {
    var back = el('clipsFolderBack');
    if (back && back.dataset.bound !== '1') {
      back.dataset.bound = '1';
      back.addEventListener('click', function (event) {
        event.preventDefault();
        closeFolder();
      });
    }
    var sort = el('clipsFolderSort');
    if (sort && sort.dataset.bound !== '1') {
      sort.dataset.bound = '1';
      sort.addEventListener('change', function () {
        if (!canWrite() || !openFolderId) return;
        store.setFolderSort(openFolderId, sort.value).then(function () {
          return refresh();
        });
      });
    }
    var tap = window.BurnfolderTouchTap || window.BurnfolderStudioTap;
    board.querySelectorAll('.clips-block[data-folder-item-id]').forEach(function (node) {
      if (node.dataset.tapBound === '1') return;
      node.dataset.tapBound = '1';
      function onActivate() {
        var itemId = node.getAttribute('data-folder-item-id');
        var folder = findBlock(openFolderId);
        var item =
          store.findFolderItem && state
            ? store.findFolderItem(state, openFolderId, itemId)
            : null;
        if (!item && folder) {
          item = (folder.items || []).find(function (row) {
            return row && row.id === itemId;
          });
        }
        activateBlock(folderItemAsBlock(item));
      }
      if (tap && tap.bind) {
        tap.bind(node, onActivate, {
          shouldSkip: function (event) {
            return !!(
              event &&
              event.target &&
              event.target.closest(
                '[data-folder-item-remove], [data-download], [data-share], [data-share-once], [data-clip-more], .clips-block-menu'
              )
            );
          }
        });
      } else {
        node.addEventListener('click', function (event) {
          if (
            event.target.closest(
              '[data-folder-item-remove], [data-download], [data-share], [data-share-once], [data-clip-more], .clips-block-menu'
            )
          ) {
            return;
          }
          onActivate();
        });
      }
    });
  }

  function composerHtml() {
    return (
      '<article class="clips-block clips-block--composer" data-composer="1" tabindex="-1">' +
      '<label class="clips-composer-label" for="clipsComposerInput">new</label>' +
      '<textarea id="clipsComposerInput" class="clips-composer-input" rows="4" ' +
      'placeholder="write, paste a link, or add video" spellcheck="true"></textarea>' +
      '<div class="clips-composer-actions">' +
      '<button type="button" class="clips-composer-submit" id="clipsComposerSubmit" aria-label="Add note">add</button>' +
      '<button type="button" class="clips-composer-video" id="clipsComposerVideo" aria-label="Add video" title="add video">video</button>' +
      '<button type="button" class="clips-composer-files" id="clipsComposerFiles" aria-label="Add files" title="add files">+</button>' +
      '<button type="button" class="clips-composer-folder" id="clipsComposerFolder" aria-label="Add files from a folder" title="add from folder">folder</button>' +
      '</div>' +
      '</article>'
    );
  }


  function blockPreview(block, playKind) {
    var kind = playKind || (block && block.kind) || '';
    if (kind === 'image' && block.vaultKey) {
      return (
        '<div class="clips-block-media clips-block-media--image" data-vault-preview="' +
        escapeHtml(block.vaultKey) +
        '"></div>'
      );
    }
    if ((kind === 'video' || kind === 'audio') && block.playbackId) {
      if (kind === 'video') {
        return (
          '<div class="clips-block-media clips-block-media--video" style="background-image:url(\'' +
          escapeHtml(muxThumb(block.playbackId)) +
          '\')"></div>'
        );
      }
      return '<div class="clips-block-media clips-block-media--audio" aria-hidden="true">♪</div>';
    }
    if (kind === 'album') {
      var coverMeta = albumCoverMeta(block);
      if (coverMeta.coverArt || coverMeta.coverAssetId) {
        return (
          '<div class="clips-block-media clips-block-media--album" data-album-cover="1" data-group-id="' +
          escapeHtml(block.groupId || '') +
          '" aria-hidden="true"></div>'
        );
      }
      return '<div class="clips-block-media clips-block-media--album clips-block-media--empty">playlist</div>';
    }
    if (kind === 'folder') {
      var coverItem = firstFolderImage(block);
      if (coverItem && coverItem.vaultKey) {
        return (
          '<div class="clips-block-media clips-block-media--folder" data-vault-preview="' +
          escapeHtml(coverItem.vaultKey) +
          '"></div>'
        );
      }
      var count = (block.items && block.items.length) || 0;
      return (
        '<div class="clips-block-media clips-block-media--folder clips-block-media--empty">' +
        escapeHtml(count ? count + ' files' : 'folder') +
        '</div>'
      );
    }
    if (kind === 'tool') {
      return '<div class="clips-block-media clips-block-media--tool">' + escapeHtml(block.title || 'tool') + '</div>';
    }
    if (kind === 'link') {
      return (
        '<div class="clips-block-body clips-block-body--link">' +
        escapeHtml(block.href || block.title || 'link') +
        '</div>'
      );
    }
    if (kind === 'file') {
      return (
        '<div class="clips-block-body clips-block-body--file">' +
        escapeHtml(block.filename || block.title || 'file') +
        '</div>'
      );
    }
    return (
      '<div class="clips-block-body clips-block-body--text">' +
      escapeHtml(block.text || block.title || 'note') +
      '</div>'
    );
  }

  /** Playback IDs + song keys already filed into any collection (stream group). */
  function housedMembership() {
    var ids = new Set();
    var keys = new Set();
    var shared = window.BurnfolderStreamShared;
    if (!shared || typeof shared.loadGroups !== 'function') {
      return { ids: ids, keys: keys };
    }
    var api = versionsApi();
    (shared.loadGroups() || []).forEach(function (group) {
      (group.tracks || []).forEach(function (track) {
        if (!track) return;
        if (track.playbackId) ids.add(track.playbackId);
        var title = track.title || track.passthrough || '';
        if (api && api.getTrackGroupKey && title) {
          var key = api.getTrackGroupKey(title);
          if (key) keys.add(key);
        }
      });
    });
    return { ids: ids, keys: keys };
  }

  /** OS-folder rule: audio in a collection leaves the main board; blocks stay in store. */
  function isAudioHoused(block, membership) {
    if (!block || block.kind !== 'audio') return false;
    var mem = membership || housedMembership();
    if (block.playbackId && mem.ids.has(block.playbackId)) return true;
    var key = groupKeyForBlock(block);
    return !!(key && mem.keys.has(key));
  }

  function visibleBoardBlocks() {
    var blocks = (state && state.blocks) || [];
    var membership = housedMembership();
    return blocks.filter(function (block) {
      if (isAudioHoused(block, membership)) return false;
      if (boardKindFilter === 'video') {
        return effectiveBlockKind(block) === 'video';
      }
      return true;
    });
  }

  function filterBarHtml() {
    var count = selectedCount();
    var html =
      '<div class="clips-filter-bar" id="clipsFilterBar">' +
      '<button type="button" class="clips-filter-chip' +
      (boardKindFilter === 'all' ? ' is-active' : '') +
      '" data-filter="all">all</button>' +
      '<button type="button" class="clips-filter-chip' +
      (boardKindFilter === 'video' ? ' is-active' : '') +
      '" data-filter="video">video</button>' +
      '<button type="button" class="clips-filter-chip clips-filter-select' +
      (selectMode ? ' is-active' : '') +
      '" data-select-toggle="1">select</button>';
    if (selectMode && count > 0) {
      html +=
        '<button type="button" class="clips-batch-share" id="clipsBatchShare">share ' +
        count +
        '</button>' +
        '<button type="button" class="clips-batch-once" id="clipsBatchOnce">share once</button>' +
        '<button type="button" class="clips-batch-clear" id="clipsBatchClear">clear</button>';
    }
    html += '</div>';
    return html;
  }

  function renderBoard() {
    var board = el('clipsBoard');
    if (!board || !state) return;
    syncPageChrome();

    if (openFolderId) {
      renderFolderBoard();
      return;
    }

    if (openGroupId) {
      renderCollectionBoard();
      return;
    }

    board.classList.remove('clips-board--collection');
    board.classList.remove('clips-board--folder');
    var blocks = visibleBoardBlocks();
    var html = filterBarHtml() + composerHtml();
    html += blocks
      .map(function (block) {
        return boardBlockHtml(block);
      })
      .join('');
    board.innerHTML = html;

    board.querySelectorAll('[data-vault-preview]').forEach(function (node) {
      var key = node.getAttribute('data-vault-preview');
      if (!key) return;
      fetchDownloadUrl(key, '', { inline: true })
        .then(function (url) {
          if (!url || !node.isConnected) return;
          node.style.backgroundImage = "url('" + url.replace(/'/g, '%27') + "')";
        })
        .catch(function () {
          /* leave empty */
        });
    });

    wireComposerActions(board);
    wireBlockTaps(board);
    syncPlayingBlocks();
  }

  function openClipsFilePicker() {
    var fileInput = el('clipsFileInput');
    if (fileInput) fileInput.click();
  }

  function openClipsVideoPicker() {
    var videoInput = el('clipsVideoInput');
    if (videoInput) {
      videoInput.click();
      return;
    }
    openClipsFilePicker();
  }

  function openClipsFolderPicker() {
    var folderPickerInput = el('clipsFolderInput');
    if (folderPickerInput) folderPickerInput.click();
  }

  function wireComposerActions(board) {
    if (!board) return;
    var submit = board.querySelector('#clipsComposerSubmit');
    var video = board.querySelector('#clipsComposerVideo');
    var files = board.querySelector('#clipsComposerFiles');
    var folder = board.querySelector('#clipsComposerFolder');
    if (submit && submit.dataset.bound !== '1') {
      submit.dataset.bound = '1';
      submit.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        var submitInput = el('clipsComposerInput');
        commitComposerValue(submitInput && submitInput.value);
      });
    }
    if (video && video.dataset.bound !== '1') {
      video.dataset.bound = '1';
      video.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        openClipsVideoPicker();
      });
    }
    if (files && files.dataset.bound !== '1') {
      files.dataset.bound = '1';
      files.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        openClipsFilePicker();
      });
    }
    if (folder && folder.dataset.bound !== '1') {
      folder.dataset.bound = '1';
      folder.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        openClipsFolderPicker();
      });
    }
  }

  function wireBlockTaps(board) {
    var tap = window.BurnfolderTouchTap || window.BurnfolderStudioTap;
    board.querySelectorAll('.clips-block[data-block-id], .clips-block[data-playback-id]').forEach(function (node) {
      if (node.dataset.tapBound === '1') return;
      node.dataset.tapBound = '1';
      function onActivate(event) {
        if (node.dataset.studioJustDragged === '1') return;
        if (event) {
          if (event.metaKey || event.ctrlKey || event.shiftKey) {
            event.preventDefault();
            var menuBlock = findBlock(node.getAttribute('data-block-id'));
            if (menuBlock) showBlockMenu(menuBlock);
            return;
          }
        }
        var block = findBlock(node.getAttribute('data-block-id'));
        if (block) {
          activateBlock(block);
          if (node.blur) node.blur();
          return;
        }
        if (openGroupId && node.getAttribute('data-collection-track') === '1') {
          var trackPlaybackId = node.getAttribute('data-playback-id') || '';
          var trackBlock =
            (store && state && store.findBlockByPlaybackId
              ? store.findBlockByPlaybackId(state, trackPlaybackId)
              : null) || { kind: 'audio', playbackId: trackPlaybackId, title: node.textContent || '' };
          if (effectiveBlockKind(trackBlock) === 'video') {
            playMuxBlock(trackBlock);
          } else {
            playCollectionFrom(0, trackPlaybackId);
          }
          if (node.blur) node.blur();
        }
      }
      if (tap && typeof tap.bind === 'function') {
        tap.bind(node, onActivate, {
          shouldSkip: function (event) {
            return !!(
              (event &&
                event.target &&
                event.target.closest(
                  '.clips-block-edit, .clips-block-menu, .clips-block-more, .clips-block-menu-item, .clips-collection-name, .clips-collection-cover, .clips-collection-cover-clear, .clips-collection-play, .clips-composer-submit, .clips-composer-video, .clips-composer-files, .clips-composer-folder, .clips-filter-chip, .clips-batch-share, .clips-batch-once, .clips-batch-clear, #clipsFilterBar'
                )) ||
              node.dataset.studioJustDragged === '1'
            );
          }
        });
      } else {
        node.addEventListener('click', onActivate);
      }
      wireBlockPlaylistDrag(node);
    });
  }

  function blockAsPlayItem(block) {
    if (!block || !block.playbackId) return null;
    return {
      title: block.title || block.filename || 'track',
      playbackId: block.playbackId,
      kind: 'audio',
      passthrough: block.passthrough || block.filename || block.title || ''
    };
  }

  function playlistClipOnto(dragBlock, targetBlock) {
    var shared = window.BurnfolderStreamShared;
    if (!shared || !dragBlock || !targetBlock) return Promise.resolve(false);
    if (dragBlock.id === targetBlock.id) return Promise.resolve(false);

    if (dragBlock.kind === 'audio' && targetBlock.kind === 'audio') {
      if (!dragBlock.playbackId || !targetBlock.playbackId) return Promise.resolve(false);
      var result = shared.dropOntoSong(blockAsPlayItem(dragBlock), blockAsPlayItem(targetBlock));
      if (!result || !result.ok) return Promise.resolve(false);
      var group =
        (result.groups || []).find(function (g) {
          return (g.tracks || []).some(function (t) {
            return t.playbackId === targetBlock.playbackId;
          });
        }) || null;
      if (!group) return Promise.resolve(false);
      var meta = shared.loadStackMeta ? shared.loadStackMeta(group.id) : group.meta || {};
      if (!meta.title) {
        meta.title = targetBlock.title || dragBlock.title || 'playlist';
        if (shared.saveStackMeta) shared.saveStackMeta(meta, group.id);
      }
      return store.ensureAlbumBlock(group.id, meta.title).then(function () {
        setStatus('filed');
        return refresh();
      }).then(function () {
        return true;
      });
    }

    if (dragBlock.kind === 'audio' && targetBlock.kind === 'album' && targetBlock.groupId) {
      var added = shared.addToGroup(blockAsPlayItem(dragBlock), targetBlock.groupId);
      if (!added || !added.ok) return Promise.resolve(false);
      var folderName = targetBlock.title || 'collection';
      return store.ensureAlbumBlock(targetBlock.groupId, targetBlock.title).then(function () {
        setStatus('filed in ' + folderName);
        return refresh();
      }).then(function () {
        return true;
      });
    }

    return Promise.resolve(false);
  }

  function wireBlockPlaylistDrag(node) {
    var blockId = node.getAttribute('data-block-id');
    var block = findBlock(blockId);
    var isCollectionTrack = node.getAttribute('data-collection-track') === '1';
    var isUnfiled = node.getAttribute('data-unfiled') === '1';
    var playbackId = node.getAttribute('data-playback-id') || (block && block.playbackId) || '';
    var songKey = node.getAttribute('data-song-key') || '';
    if (!block && !isCollectionTrack) return;
    if (block && block.kind !== 'audio' && block.kind !== 'album' && !isCollectionTrack) return;
    if (node.dataset.dragBound === '1') return;
    node.dataset.dragBound = '1';

    var TOUCH_HOLD_MS = 400;
    var MOUSE_DRAG_PX = 8;
    var startX = 0;
    var startY = 0;
    var dragging = false;
    var pointerId = null;
    var ghost = null;
    var grabOffsetX = 0;
    var grabOffsetY = 0;
    var lastClientX = 0;
    var lastClientY = 0;
    var rafId = null;
    var dropTargetEl = null;
    var dropBefore = true;
    var captured = false;
    var holdTimer = null;
    var pointerType = 'mouse';
    var scrollRaf = null;

    function dndApi() {
      return window.BurnfolderStudioDnD || null;
    }

    function clearHoldState() {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      node.classList.remove('studio-dnd-hold-ready');
      document.body.classList.remove('studio-dnd-pending');
    }

    function setDropTarget(el, before) {
      var nextBefore = before !== false;
      if (dropTargetEl === el && dropBefore === nextBefore) return;
      if (dropTargetEl) {
        dropTargetEl.classList.remove('is-drop-target', 'is-drop-before', 'is-drop-after');
      }
      dropTargetEl = el || null;
      dropBefore = nextBefore;
      if (!dropTargetEl) return;
      dropTargetEl.classList.add('is-drop-target');
      if (
        dropTargetEl.classList.contains('clips-block') &&
        dropTargetEl.getAttribute('data-collection-track') === '1'
      ) {
        dropTargetEl.classList.add(dropBefore ? 'is-drop-before' : 'is-drop-after');
      }
    }

    function clearDropTargets() {
      setDropTarget(null);
      document
        .querySelectorAll(
          '.clips-block.is-drop-target, .clips-block.is-drop-before, .clips-block.is-drop-after, .clips-collection-drop.is-drop-target, .clips-unfiled-shelf.is-drop-target'
        )
        .forEach(function (el) {
          el.classList.remove('is-drop-target', 'is-drop-before', 'is-drop-after');
        });
    }

    function syncGhost() {
      rafId = null;
      if (!ghost) return;
      ghost.style.transform =
        'translate3d(' +
        (lastClientX - grabOffsetX) +
        'px, ' +
        (lastClientY - grabOffsetY) +
        'px, 0)';
    }

    function scheduleGhost() {
      if (rafId != null) return;
      rafId = requestAnimationFrame(syncGhost);
    }

    function hitAt(clientX, clientY) {
      var api = dndApi();
      if (api && typeof api.hitElementsFromPoint === 'function') {
        return api.hitElementsFromPoint(clientX, clientY, [ghost, node]);
      }
      var stack = document.elementsFromPoint
        ? document.elementsFromPoint(clientX, clientY)
        : [document.elementFromPoint(clientX, clientY)];
      for (var i = 0; i < stack.length; i++) {
        var el = stack[i];
        if (!el) continue;
        if (ghost && (el === ghost || (ghost.contains && ghost.contains(el)))) continue;
        if (el === node || (node.contains && node.contains(el))) continue;
        if (el.classList && el.classList.contains('clips-drag-ghost')) continue;
        return el;
      }
      return null;
    }

    function resolveDropTarget(clientX, clientY) {
      var hit = hitAt(clientX, clientY);
      if (!hit) return null;
      if (openGroupId) {
        var shelf = hit.closest('#clipsUnfiledShelf');
        var grid = hit.closest('#clipsCollectionGrid');
        var trackTarget = hit.closest('.clips-block[data-collection-track="1"]');
        if (isCollectionTrack && shelf) {
          return { el: shelf, before: true };
        }
        if (isUnfiled && trackTarget && trackTarget !== node) {
          var tRect = trackTarget.getBoundingClientRect();
          return {
            el: trackTarget,
            before: clientY < tRect.top + tRect.height / 2
          };
        }
        if (isUnfiled && grid) {
          return { el: grid, before: true };
        }
        if (isCollectionTrack && trackTarget && trackTarget !== node) {
          var rect = trackTarget.getBoundingClientRect();
          return {
            el: trackTarget,
            before: clientY < rect.top + rect.height / 2
          };
        }
        return null;
      }
      var target = hit.closest('.clips-block[data-block-id]');
      if (!target || target === node) return null;
      var tBlock = findBlock(target.getAttribute('data-block-id'));
      if (
        tBlock &&
        ((block && block.kind === 'audio' && tBlock.kind === 'audio') ||
          (block && block.kind === 'audio' && tBlock.kind === 'album'))
      ) {
        return { el: target, before: true };
      }
      return null;
    }

    function tickAutoScroll() {
      scrollRaf = null;
      if (!dragging) return;
      var api = dndApi();
      if (api && typeof api.autoScrollAtPoint === 'function') {
        api.autoScrollAtPoint(lastClientX, lastClientY);
      }
      var resolved = resolveDropTarget(lastClientX, lastClientY);
      setDropTarget(resolved && resolved.el, resolved && resolved.before);
      scrollRaf = requestAnimationFrame(tickAutoScroll);
    }

    function beginDrag(event) {
      dragging = true;
      clearHoldState();
      var rect = node.getBoundingClientRect();
      grabOffsetX = startX - rect.left;
      grabOffsetY = startY - rect.top;
      lastClientX = event.clientX != null ? event.clientX : lastClientX;
      lastClientY = event.clientY != null ? event.clientY : lastClientY;
      document.body.classList.add('clips-clip-dragging', 'studio-dnd-active');
      ghost = node.cloneNode(true);
      ghost.classList.add('clips-drag-ghost');
      ghost.removeAttribute('data-block-id');
      ghost.removeAttribute('data-playback-id');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.style.width = rect.width + 'px';
      ghost.style.height = rect.height + 'px';
      document.body.appendChild(ghost);
      syncGhost();
      node.classList.add('is-dragging');
      node.dataset.studioJustDragged = '1';
      if (pointerId != null && typeof node.setPointerCapture === 'function') {
        try {
          node.setPointerCapture(pointerId);
          captured = true;
        } catch (err) {
          captured = false;
        }
      }
      if (scrollRaf == null) scrollRaf = requestAnimationFrame(tickAutoScroll);
    }

    function cleanup() {
      clearHoldState();
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (scrollRaf != null) {
        cancelAnimationFrame(scrollRaf);
        scrollRaf = null;
      }
      if (captured && pointerId != null && typeof node.releasePointerCapture === 'function') {
        try {
          if (node.hasPointerCapture && node.hasPointerCapture(pointerId)) {
            node.releasePointerCapture(pointerId);
          }
        } catch (err) {
          /* ignore */
        }
      }
      captured = false;
      dragging = false;
      pointerId = null;
      clearDropTargets();
      document.body.classList.remove('clips-clip-dragging', 'studio-dnd-active');
      if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
      ghost = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    }

    function resolveLooseBlock() {
      var loose = findBlock(blockId);
      if (loose) return loose;
      if (!playbackId) return null;
      return {
        id: blockId || '',
        kind: 'audio',
        title: (node.querySelector('.clips-block-title') || {}).textContent || 'track',
        playbackId: playbackId,
        passthrough: songKey || ''
      };
    }

    function onMove(event) {
      if (pointerId != null && event.pointerId !== pointerId) return;
      lastClientX = event.clientX;
      lastClientY = event.clientY;
      if (!dragging) {
        var dx = lastClientX - startX;
        var dy = lastClientY - startY;
        var dist = Math.hypot(dx, dy);
        if (pointerType === 'touch') {
          // Finger moved before hold completed → treat as scroll, cancel drag arming.
          if (holdTimer && dist > 10) {
            clearHoldState();
            cleanup();
            return;
          }
          return;
        }
        if (dist < MOUSE_DRAG_PX) return;
        beginDrag(event);
      } else {
        scheduleGhost();
        var api = dndApi();
        if (api && typeof api.autoScrollAtPoint === 'function') {
          api.autoScrollAtPoint(lastClientX, lastClientY);
        }
      }
      var resolved = resolveDropTarget(lastClientX, lastClientY);
      setDropTarget(resolved && resolved.el, resolved && resolved.before);
      if (event.cancelable) event.preventDefault();
    }

    function onUp(event) {
      if (pointerId != null && event.pointerId !== pointerId) return;
      var wasDragging = dragging;
      var wasHold = pointerType === 'touch' && !wasDragging;
      var dropBlock =
        dropTargetEl && dropTargetEl.classList.contains('clips-block') ? dropTargetEl : null;
      var dropShelf =
        dropTargetEl && dropTargetEl.classList.contains('clips-unfiled-shelf')
          ? dropTargetEl
          : null;
      var dropGrid =
        dropTargetEl && dropTargetEl.classList.contains('clips-collection-drop')
          ? dropTargetEl
          : null;
      var insertBefore = dropBefore;
      node.classList.remove('is-dragging');
      cleanup();
      if (wasHold) {
        node.dataset.studioDragHold = '1';
        setTimeout(function () {
          delete node.dataset.studioDragHold;
        }, 120);
        return;
      }
      if (!wasDragging) return;
      setTimeout(function () {
        delete node.dataset.studioJustDragged;
      }, 180);

      if (openGroupId) {
        if (isCollectionTrack && dropShelf) {
          unfileFromOpenCollection(playbackId, songKey);
          return;
        }
        if (
          isUnfiled &&
          (dropGrid || (dropBlock && dropBlock.getAttribute('data-collection-track') === '1'))
        ) {
          var looseBlock = resolveLooseBlock();
          if (looseBlock) {
            fileIntoOpenCollection(looseBlock).then(function (ok) {
              if (!ok) return;
              if (
                dropBlock &&
                dropBlock.getAttribute('data-collection-track') === '1' &&
                typeof window.BurnfolderStreamShared !== 'undefined' &&
                window.BurnfolderStreamShared.reorderUniqueSongs
              ) {
                var ontoKey =
                  dropBlock.getAttribute('data-song-key') ||
                  dropBlock.getAttribute('data-playback-id') ||
                  '';
                var fromKey = songKey || playbackId;
                if (fromKey && ontoKey && fromKey !== ontoKey) {
                  window.BurnfolderStreamShared.reorderUniqueSongs(
                    fromKey,
                    ontoKey,
                    openGroupId,
                    insertBefore
                  );
                  refresh();
                }
              }
            });
          }
          return;
        }
        if (
          isCollectionTrack &&
          dropBlock &&
          dropBlock.getAttribute('data-collection-track') === '1' &&
          dropBlock !== node
        ) {
          var onto =
            dropBlock.getAttribute('data-song-key') ||
            dropBlock.getAttribute('data-playback-id') ||
            '';
          var from = songKey || playbackId;
          if (reorderOpenCollection(from, onto, insertBefore)) {
            setStatus('sorted');
            refresh();
          }
          return;
        }
        return;
      }

      if (!dropBlock) return;
      var targetBlock = findBlock(dropBlock.getAttribute('data-block-id'));
      var dragBlock = findBlock(blockId);
      playlistClipOnto(dragBlock, targetBlock);
    }

    node.addEventListener('pointerdown', function (event) {
      if (event.button != null && event.button !== 0) return;
      if (
        event.target &&
        event.target.closest(
          '.clips-block-edit, .clips-block-menu, .clips-block-more, .clips-block-menu-item, .clips-composer-video, .clips-composer-files, .clips-composer-folder, .clips-composer-submit, .clips-collection-name, .clips-collection-cover, .clips-collection-cover-clear, .clips-collection-play'
        )
      ) {
        return;
      }
      startX = event.clientX;
      startY = event.clientY;
      lastClientX = event.clientX;
      lastClientY = event.clientY;
      pointerId = event.pointerId;
      pointerType = event.pointerType || 'mouse';
      dragging = false;
      clearHoldState();
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);

      if (pointerType === 'touch') {
        document.body.classList.add('studio-dnd-pending');
        holdTimer = setTimeout(function () {
          holdTimer = null;
          if (dragging) return;
          node.classList.add('studio-dnd-hold-ready');
          if (navigator.vibrate) {
            try {
              navigator.vibrate(12);
            } catch (err) {
              /* ignore */
            }
          }
          beginDrag({ clientX: lastClientX, clientY: lastClientY });
        }, TOUCH_HOLD_MS);
      }
    });
  }

  function defaultTitle(block) {
    if (block.kind === 'tool' && block.toolId === 'word-pull') return 'word pull';
    if (block.kind === 'album') return block.title || 'playlist';
    if (block.kind === 'folder') return block.title || 'folder';
    if (block.kind === 'link') return 'link';
    if (block.kind === 'file') return block.filename || 'file';
    if (block.kind === 'text') return 'note';
    return block.kind;
  }

  function render() {
    renderBoard();
  }

  function spaGo(href) {
    if (typeof window.studioSpaNavigate === 'function') {
      window.studioSpaNavigate(href);
      return;
    }
    window.location.href = href;
  }

  function setVideoStageTitle(block) {
    var titleEl = el('clipsVideoStageTitle');
    if (!titleEl) return;
    titleEl.textContent = blockDisplayTitle(block) || 'video';
  }

  function requestVideoFullscreen() {
    var wrap = el('clipsVideoStageWrap');
    var stage = el('clipsVideoStage');
    var player =
      (stage && (stage.querySelector('mux-player') || stage.querySelector('video'))) || null;
    var target = wrap || player;
    if (!target) return;
    if (typeof target.requestFullscreen === 'function') {
      try {
        var result = target.requestFullscreen();
        if (result && typeof result.catch === 'function') result.catch(function () {});
      } catch (e) {}
      return;
    }
    if (typeof target.webkitRequestFullscreen === 'function') {
      try {
        target.webkitRequestFullscreen();
      } catch (e) {}
      return;
    }
    if (player && typeof player.webkitEnterFullscreen === 'function') {
      try {
        player.webkitEnterFullscreen();
      } catch (e) {}
    }
  }

  function exitVideoFullscreen() {
    var doc = document;
    if (!doc.fullscreenElement && !doc.webkitFullscreenElement) return;
    var exit = doc.exitFullscreen || doc.webkitExitFullscreen;
    if (typeof exit === 'function') {
      try {
        var result = exit.call(doc);
        if (result && typeof result.catch === 'function') result.catch(function () {});
      } catch (e) {}
    }
  }

  function closeVideoStage() {
    exitVideoFullscreen();
    var stage = el('clipsVideoStage');
    var wrap = el('clipsVideoStageWrap');
    var shared = window.BurnfolderStreamShared;
    if (shared && typeof shared.clearStreamVideo === 'function') {
      shared.clearStreamVideo(stage);
    } else if (stage) {
      stage.innerHTML = '';
      stage.hidden = true;
    }
    if (wrap) wrap.hidden = true;
    document.body.classList.remove('clips-video-open');
  }

  function playMuxBlock(block) {
    if (!block.playbackId) {
      setStatus('playback unavailable');
      return;
    }

    var player = window.BurnfolderStreamPlayer;
    var shell = window.BurnfolderStudioPlaybackShell;
    if (shell) {
      if (shell.ensureShell) shell.ensureShell();
      if (shell.mountBar) shell.mountBar();
    }

    var playKind = effectiveBlockKind(block) || block.kind;
    var isVideo = playKind === 'video';

    // Same clip already active → pause/resume. Different mix of same song → switch.
    if (player && !isVideo && typeof player.togglePause === 'function') {
      var sameClip =
        typeof player.isActivePlaybackId === 'function' && player.isActivePlaybackId(block.playbackId);
      if (sameClip) {
        player.togglePause();
        syncPlayingBlocks();
        releaseClipKeyboardFocus();
        return;
      }
    }

    var title = blockDisplayTitle(block);
    var item = {
      title: title,
      displayTitle: title,
      filename: block.filename || '',
      name: block.filename || title,
      passthrough: block.passthrough || block.filename || title,
      playbackId: block.playbackId,
      kind: isVideo ? 'video' : 'audio',
      hasVideoTrack: isVideo
    };

    if (isVideo) {
      // Leave playlist drill-in so the video stage isn't buried under collection chrome.
      if (openGroupId) {
        openGroupId = null;
        renderBoard();
      }
      var stage = el('clipsVideoStage');
      var wrap = el('clipsVideoStageWrap');
      var shared = window.BurnfolderStreamShared;
      if (stage && shared && typeof shared.mountStreamVideo === 'function') {
        setVideoStageTitle(block);
        if (wrap) wrap.hidden = false;
        document.body.classList.add('clips-video-open');
        shared.mountStreamVideo(item, stage, { autoplay: true });
        var scrollTarget = wrap || stage;
        if (typeof scrollTarget.scrollIntoView === 'function') {
          scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        syncPlayingBlocks();
        releaseClipKeyboardFocus();
        return;
      }
    }

    if (!player || typeof player.playItem !== 'function') {
      setStatus('playback unavailable');
      return;
    }

    markBlockPlaying(block.id, true);
    var started = false;
    try {
      started = player.playItem(item) !== false;
    } catch (err) {
      markBlockPlaying(block.id, false);
      setStatus((err && err.message) || 'could not start playback');
      return;
    }
    if (!started) {
      markBlockPlaying(block.id, false);
      setStatus('could not start playback — mux may still be processing');
      return;
    }

    var mux =
      (document.getElementById('studioGlobalPlayback') &&
        document.getElementById('studioGlobalPlayback').querySelector('#activeMuxPlayer')) ||
      document.getElementById('activeMuxPlayer');
    if (mux && typeof mux.play === 'function') {
      if ((mux.getAttribute('playback-id') || '') !== item.playbackId) {
        mux.setAttribute('playback-id', item.playbackId);
      }
      if (mux.paused) mux.play().catch(function () {});
    }
    syncPlayingBlocks();
    releaseClipKeyboardFocus();
  }

  function markBlockPlaying(blockId, on) {
    var board = el('clipsBoard');
    if (!board) return;
    board.querySelectorAll('.clips-block[data-block-id]').forEach(function (node) {
      var match = node.getAttribute('data-block-id') === blockId;
      node.classList.toggle('is-playing', !!(on && match));
      node.classList.toggle('is-active', match);
    });
  }

  function syncPlayingBlocks() {
    var player = window.BurnfolderStreamPlayer;
    var board = el('clipsBoard');
    if (!board) return;
    var activeId = '';
    var activeKey = '';
    var playing = false;
    if (player && typeof player.getActiveSong === 'function') {
      var song = player.getActiveSong();
      activeId = song && song.playbackId ? song.playbackId : '';
      if (song && versionsApi() && versionsApi().getTrackGroupKey) {
        activeKey = versionsApi().getTrackGroupKey(song.title || song.displayTitle || '');
      }
      playing =
        !!(activeId && player.isPlayingPlaybackId && player.isPlayingPlaybackId(activeId));
    }
    board.querySelectorAll('.clips-block[data-block-id], .clips-block[data-playback-id]').forEach(function (node) {
      var block = findBlock(node.getAttribute('data-block-id'));
      var blockKey = block
        ? groupKeyForBlock(block)
        : node.getAttribute('data-song-key') || '';
      var nodePlayback = node.getAttribute('data-playback-id') || (block && block.playbackId) || '';
      var match = !!(
        (activeId && nodePlayback && nodePlayback === activeId) ||
        (activeKey && blockKey && blockKey === activeKey) ||
        (block &&
          ((activeId && block.playbackId === activeId) ||
            (activeKey && groupKeyForBlock(block) && groupKeyForBlock(block) === activeKey)))
      );
      node.classList.toggle('is-active', match);
      node.classList.toggle('is-playing', !!(match && playing));
    });

    var playBtn = el('clipsCollectionPlay');
    if (playBtn && openGroupId) {
      var rows = collectionSongRows();
      var onCollection =
        activeId &&
        rows.some(function (row) {
          return row.playbackId === activeId || (activeKey && row.key === activeKey);
        });
      var collectionPlaying = !!(onCollection && playing);
      playBtn.textContent = collectionPlaying ? '❚❚' : '▶';
      playBtn.setAttribute('aria-label', collectionPlaying ? 'Pause' : 'Play');
      playBtn.classList.toggle('is-playing', collectionPlaying);
    }
  }

  function openAlbum(block) {
    if (!block.groupId) {
      setStatus('album missing project link');
      return;
    }
    openFolderId = null;
    openGroupId = block.groupId;
    render();
  }

  function openTool(block) {
    if (block.toolId === 'word-pull') {
      spaGo('/studio/word-pull.html');
      return;
    }
    setStatus('unknown tool');
  }

  function openLink(block) {
    var href = block.href;
    if (!href) return;
    if (!/^https?:\/\//i.test(href)) href = 'https://' + href;
    window.open(href, '_blank', 'noopener,noreferrer');
  }

  function downloadFile(block) {
    return downloadClip(block);
  }

  function closeLightbox() {
    var box = el('clipsLightbox');
    var img = el('clipsLightboxImg');
    if (img) {
      img.removeAttribute('src');
      img.alt = '';
    }
    if (box) box.hidden = true;
    document.body.classList.remove('clips-lightbox-open');
  }

  function openLightbox(block) {
    var box = el('clipsLightbox');
    var img = el('clipsLightboxImg');
    if (!box || !img || !block || !block.vaultKey) {
      setStatus('preview unavailable');
      return;
    }
    setStatus('opening…');
    fetchDownloadUrl(block.vaultKey, clipDownloadName(block), { inline: true })
      .then(function (url) {
        if (!url) throw new Error('no url');
        img.alt = block.title || block.filename || 'image';
        img.onload = function () {
          setStatus('');
        };
        img.onerror = function () {
          setStatus('could not open image');
          closeLightbox();
        };
        img.src = url;
        box.hidden = false;
        document.body.classList.add('clips-lightbox-open');
      })
      .catch(function (err) {
        setStatus((err && err.message) || 'could not open image');
      });
  }

  function viewFile(block) {
    if (!block || !block.vaultKey) {
      setStatus('file missing');
      return;
    }
    setStatus('opening…');
    fetchDownloadUrl(block.vaultKey, clipDownloadName(block), { inline: true })
      .then(function (url) {
        if (!url) throw new Error('no url');
        window.open(url, '_blank', 'noopener,noreferrer');
        setStatus('');
      })
      .catch(function (err) {
        setStatus((err && err.message) || 'could not open file');
      });
  }

  function viewClip(block) {
    if (!block) return;
    if (block.kind === 'image') {
      openLightbox(block);
      return;
    }
    if (block.kind === 'file') {
      var name = String(block.filename || block.title || '');
      if (IMAGE_RE.test(name) || (block.contentType || '').indexOf('image/') === 0) {
        openLightbox(block);
        return;
      }
      viewFile(block);
    }
  }

  function editTextBlock(block) {
    var board = el('clipsBoard');
    var node = board && board.querySelector('.clips-block[data-block-id="' + block.id + '"]');
    if (!node) return;
    if (node.classList.contains('is-editing')) return;
    node.classList.add('is-editing');
    var body = node.querySelector('.clips-block-body') || node;
    var area = document.createElement('textarea');
    area.className = 'clips-block-edit';
    area.value = block.text || block.title || '';
    area.setAttribute('aria-label', 'edit note');
    body.replaceWith(area);
    area.focus();
    area.select();

    function commit() {
      var next = String(area.value || '').trim();
      node.classList.remove('is-editing');
      if (!next || next === (block.text || '')) {
        refresh();
        return;
      }
      store
        .updateBlock(block.id, { title: next.slice(0, 48), text: next })
        .then(function () {
          return refresh();
        });
    }

    area.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        refresh();
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        commit();
      }
    });
    area.addEventListener('blur', commit);
  }

  function showBlockMenu(block) {
    removeClipBlock(block);
  }

  function removeClipBlock(block) {
    if (!block) return Promise.resolve();
    if (!canWrite()) {
      setStatus('read only');
      return Promise.resolve();
    }
    if (state) {
      state.blocks = (state.blocks || []).filter(function (b) {
        return b.id !== block.id;
      });
      if (openFolderId === block.id) openFolderId = null;
      render();
    }
    setStatus('removed');
    return store.removeBlock(block.id).catch(function (err) {
      setStatus((err && err.message) || 'remove failed');
      return refresh();
    });
  }

  function removeOpenFolderItem(itemId) {
    if (!canWrite() || !openFolderId || !itemId) {
      setStatus('read only');
      return Promise.resolve();
    }
    var folder = findBlock(openFolderId);
    if (folder && Array.isArray(folder.items)) {
      folder.items = folder.items.filter(function (item) {
        return item && item.id !== itemId;
      });
      render();
    }
    return store.removeFolderItem(openFolderId, itemId).catch(function (err) {
      setStatus((err && err.message) || 'remove failed');
      return refresh();
    });
  }

  function handleRemoveTarget(node) {
    if (!node) return Promise.resolve(false);
    if (openGroupId && node.getAttribute('data-collection-track') === '1') {
      var playbackId = node.getAttribute('data-playback-id') || '';
      if (!playbackId) return Promise.resolve(false);
      return unfileFromOpenCollection(playbackId).then(function () {
        return true;
      });
    }
    var block = findBlock(node.getAttribute('data-block-id'));
    if (!block) return Promise.resolve(false);
    return removeClipBlock(block).then(function () {
      return true;
    });
  }

  function activateBlock(block) {
    if (!block) return;
    var playKind = effectiveBlockKind(block) || block.kind;
    if (selectMode && playKind === 'video') {
      toggleBlockSelected(block.id);
      return;
    }
    switch (playKind) {
      case 'audio':
        if (openGroupId) {
          playCollectionFrom(0, block.playbackId);
        } else {
          playMuxBlock(block);
        }
        break;
      case 'video':
        playMuxBlock(block);
        break;
      case 'album':
        openAlbum(block);
        break;
      case 'folder':
        openFolder(block);
        break;
      case 'tool':
        openTool(block);
        break;
      case 'link':
        openLink(block);
        break;
      case 'file':
      case 'image':
        viewClip(block);
        break;
      case 'text':
        editTextBlock(block);
        break;
      default:
        break;
    }
  }

  function findBlock(id) {
    if (!state) return null;
    return (
      state.blocks.find(function (b) {
        return b.id === id;
      }) || null
    );
  }

  function addTextBlock() {
    if (!canWrite()) {
      setStatus('read only');
      return;
    }
    var text = window.prompt('write something');
    if (text == null || !String(text).trim()) return;
    var title = String(text).trim().slice(0, 48);
    store
      .addBlock({
        kind: 'text',
        title: title,
        text: String(text).trim()
      })
      .then(function () {
        return refresh();
      });
  }

  function addLinkBlock() {
    if (!canWrite()) {
      setStatus('read only');
      return;
    }
    var href = window.prompt('paste a link');
    if (href == null || !String(href).trim()) return;
    var title = window.prompt('title (optional)', href.replace(/^https?:\/\//i, '').slice(0, 48));
    store
      .addBlock({
        kind: 'link',
        title: (title && String(title).trim()) || 'link',
        href: String(href).trim()
      })
      .then(function () {
        return refresh();
      });
  }

  function maybeCompressVideo(file, kind) {
    if (kind !== 'video') return Promise.resolve(file);
    var compress = window.BurnfolderVideoCompress;
    if (!compress || typeof compress.compressIfNeeded !== 'function') {
      return Promise.resolve(file);
    }
    return compress.compressIfNeeded(file, {
      onProgress: function (pct) {
        var percent = Math.round((pct || 0) * 100);
        setStatus('compressing ' + percent + '%');
        updateUploadRow(file, {
          percent: percent,
          status: 'working',
          phase: 'compressing',
          message: 'compressing ' + percent + '%'
        });
      }
    });
  }

  function uploadMuxPayload(file, kind, opts) {
    var options = opts || {};
    var cloud = window.BurnfolderAssetCloud;
    if (!cloud || typeof cloud.addFiles !== 'function') {
      return Promise.reject(new Error('mux upload unavailable'));
    }
    if (!options.skipQueueRow) beginUploadRow(file);
    return maybeCompressVideo(file, kind).then(function (uploadFile) {
      return cloud
        .addFiles([uploadFile], {
          onProgress: function (_file, pct, phase) {
            var percent = Math.round(pct || 0);
            var label = phase || 'uploading';
            setStatus(label + ' ' + percent + '%');
            updateUploadRow(file, {
              percent: percent,
              status: 'working',
              phase: label,
              message: label + ' ' + percent + '%'
            });
          }
        })
        .then(function (assets) {
          var asset = assets && assets[0];
          var playbackId = asset && (asset.muxPlaybackId || asset.playbackId);
          if (!playbackId) {
            throw new Error(
              (assets && assets.length === 0
                ? 'mux upload failed'
                : 'mux upload failed — no playback id')
            );
          }
          finishUploadRow(file, true);
          return {
            kind: kind,
            title: asset.displayTitle || asset.name || file.name.replace(/\.[^.]+$/, ''),
            playbackId: playbackId,
            filename: file.name,
            passthrough: asset.muxPassthrough || file.name,
            contentType: file.type || '',
            size: file.size || 0
          };
        });
    })
      .catch(function (err) {
        finishUploadRow(file, false, (err && err.message) || 'failed');
        throw err;
      });
  }

  function uploadVaultPayload(file, kind, opts) {
    var options = opts || {};
    var vault = window.BurnfolderVaultUpload;
    if (!vault || typeof vault.uploadFile !== 'function') {
      return Promise.reject(new Error('vault upload unavailable — check R2 setup'));
    }
    if (!options.skipQueueRow) beginUploadRow(file);
    var vaultKind = kind === 'image' ? 'image' : 'clip';
    return vault
      .uploadFile(file, {
        kind: vaultKind,
        folderKey: 'board',
        onProgress: function (pct, phase) {
          var percent = Math.round(pct || 0);
          var label = phase || 'uploading';
          setStatus(label + ' ' + percent + '%');
          updateUploadRow(file, {
            percent: percent,
            status: 'working',
            phase: label,
            message: label + ' ' + percent + '%'
          });
        }
      })
      .then(function (result) {
        finishUploadRow(file, true);
        return {
          kind: kind,
          title: file.name.replace(/\.[^.]+$/, ''),
          vaultKey: result.vaultKey || '',
          filename: file.name,
          contentType: file.type || '',
          size: file.size || 0
        };
      })
      .catch(function (err) {
        finishUploadRow(file, false, (err && err.message) || 'failed');
        throw err;
      });
  }

  function rememberUploadedAsset(payload) {
    if (!payload || !payload.playbackId) return;
    var existing = libraryCache.find(function (row) {
      return row && row.playbackId === payload.playbackId;
    });
    if (existing) {
      existing.passthrough = payload.passthrough || existing.passthrough;
      existing.name = payload.filename || existing.name;
      existing.displayTitle = payload.title || existing.displayTitle;
      existing.kind = payload.kind || existing.kind;
    } else {
      libraryCache = [
        {
          playbackId: payload.playbackId,
          passthrough: payload.passthrough || payload.filename || '',
          name: payload.filename || payload.title || '',
          displayTitle: payload.title || '',
          kind: payload.kind || 'audio',
          createdAt: new Date().toISOString()
        }
      ].concat(libraryCache || []);
    }
    syncNowPlayingCatalog();
  }

  function upgradeCollectionsForUpload(payload) {
    var shared = window.BurnfolderStreamShared;
    if (!shared || typeof shared.upgradeTracksBySongKey !== 'function') return;
    var key =
      versionsApi() && versionsApi().getTrackGroupKey
        ? versionsApi().getTrackGroupKey(
            payload.passthrough || payload.filename || payload.title || ''
          )
        : '';
    if (!key) return;
    shared.upgradeTracksBySongKey(key, {
      playbackId: payload.playbackId,
      title: payload.title,
      passthrough: payload.passthrough,
      filename: payload.filename
    });
  }

  function playUploadedMix(payload) {
    if (!payload || !payload.playbackId || payload.kind === 'video') return;
    var player = window.BurnfolderStreamPlayer;
    if (!player || typeof player.playItem !== 'function') return;
    var activeSong = typeof player.getActiveSong === 'function' ? player.getActiveSong() : null;
    var activeKey = '';
    var uploadKey =
      versionsApi() && versionsApi().getTrackGroupKey
        ? versionsApi().getTrackGroupKey(
            payload.passthrough || payload.filename || payload.title || ''
          )
        : '';
    if (activeSong && versionsApi() && versionsApi().getTrackGroupKey) {
      activeKey = versionsApi().getTrackGroupKey(
        activeSong.title || activeSong.displayTitle || activeSong.passthrough || ''
      );
    }
    var sameStack = !!(uploadKey && activeKey && uploadKey === activeKey);
    var sameId =
      typeof player.isActivePlaybackId === 'function' &&
      player.isActivePlaybackId(payload.playbackId);
    if (!sameStack && !sameId) return;
    if (sameId) return;

    var title =
      (versionsApi() && versionsApi().stripTrailingDate
        ? versionsApi().stripTrailingDate(payload.title || payload.passthrough || '')
        : payload.title) || 'track';
    try {
      player.playItem({
        title: title,
        displayTitle: title,
        filename: payload.filename || '',
        name: payload.filename || title,
        passthrough: payload.passthrough || payload.filename || title,
        playbackId: payload.playbackId,
        kind: 'audio',
        hasVideoTrack: false
      });
    } catch (err) {
      /* keep current playback if swap fails */
    }
  }

  function openUploadedVideo(block) {
    if (!block || !block.playbackId) return;
    if (effectiveBlockKind(block) !== 'video' && block.kind !== 'video') return;
    // Leave folder/collection drill-in so the stage is visible on the board.
    if (openFolderId) closeFolder();
    else if (openGroupId) closeCollection();
    playMuxBlock(block);
  }

  function uploadMuxFile(file, kind, opts) {
    return uploadMuxPayload(file, kind, opts).then(function (payload) {
      rememberUploadedAsset(payload);
      upgradeCollectionsForUpload(payload);
      var mux = window.BurnfolderStudioMux;
      if (mux && typeof mux.invalidateMuxLibraryCache === 'function') {
        mux.invalidateMuxLibraryCache();
      }
      var save =
        kind === 'audio' && store && typeof store.upsertAudioUpload === 'function'
          ? store.upsertAudioUpload(payload)
          : store.addBlock(payload);
      return save.then(function (block) {
        playUploadedMix(payload);
        return block;
      });
    });
  }

  function uploadVaultFile(file, kind, opts) {
    setStatus('uploading ' + file.name + '…');
    return uploadVaultPayload(file, kind, opts).then(function (payload) {
      return store.addBlock(payload);
    });
  }

  function folderRootNameFromEntries(entries) {
    var first = entries && entries[0] && entries[0].relativePath;
    if (!first) return '';
    var top = String(first).replace(/\\/g, '/').split('/').filter(Boolean)[0];
    return normalizeClipName(top) || '';
  }

  function importFolderAsClip(fileEntries) {
    if (!canWrite()) {
      setStatus('read only');
      return Promise.resolve();
    }
    var entries = (fileEntries || [])
      .map(function (entry) {
        if (!entry) return null;
        if (entry.file) {
          return {
            file: entry.file,
            relativePath: entry.relativePath || entry.file.webkitRelativePath || entry.file.name
          };
        }
        return {
          file: entry,
          relativePath: entry.webkitRelativePath || entry.name
        };
      })
      .filter(function (entry) {
        return entry && entry.file;
      });
    if (!entries.length) {
      setStatus('folder is empty');
      return Promise.resolve();
    }

    var title = folderRootNameFromEntries(entries) || 'folder';
    var total = entries.length;
    var done = 0;
    var failed = 0;
    var folderBlockId = null;

    entries.forEach(function (entry) {
      beginUploadRow(entry.file);
    });

    return store
      .addBlock({
        kind: 'folder',
        title: title,
        items: [],
        sortBy: 'name'
      })
      .then(function (folder) {
        folderBlockId = folder && folder.id;
        if (!folderBlockId) throw new Error('could not create folder clip');
        // Stay on the main board — one folder clip, open on click.
        openFolderId = null;
        return refresh().then(function () {
          return runWithConcurrency(entries, UPLOAD_CONCURRENCY, function (entry) {
            done += 1;
            setStatus('uploading ' + done + '/' + total + ' — ' + entry.file.name + '…');
            var kind = classifyFile(entry.file);
            var upload = isMuxable(kind)
              ? uploadMuxPayload(entry.file, kind, { skipQueueRow: true })
              : uploadVaultPayload(entry.file, kind, { skipQueueRow: true });
            return upload.then(function (payload) {
              payload.relativePath = String(entry.relativePath || '')
                .replace(/\\/g, '/')
                .split('/')
                .slice(1)
                .join('/');
              return store.appendFolderItem(folderBlockId, payload);
            });
          }).then(function (results) {
            (results || []).forEach(function (result, index) {
              if (result && result.ok) return;
              failed += 1;
              var entry = entries[index];
              setStatus(
                'failed: ' +
                  ((entry && entry.file && entry.file.name) || 'file') +
                  ' — ' +
                  ((result && result.error && result.error.message) || 'error')
              );
            });
          });
        });
      })
      .catch(function (err) {
        if (!folderBlockId) {
          entries.forEach(function (entry) {
            finishUploadRow(entry.file, false, (err && err.message) || 'failed');
          });
        }
        throw err;
      })
      .then(function () {
        // Never drill into the new folder — leave it as a clip on the board.
        openFolderId = null;
        openGroupId = null;
        setStatus(
          failed
            ? 'folder added — ' + (total - failed) + '/' + total + ' (' + failed + ' failed)'
            : 'folder added — ' + total + ' file' + (total === 1 ? '' : 's')
        );
        return refresh();
      });
  }

  function handleFiles(fileList) {
    if (!canWrite()) {
      setStatus('read only');
      return;
    }
    var files = Array.from(fileList || []);
    if (!files.length) return;
    var total = files.length;
    var done = 0;
    var failed = 0;

    files.forEach(function (file) {
      beginUploadRow(file);
    });
    setStatus(total === 1 ? 'uploading 1 file…' : 'uploading ' + total + ' files…');

    runWithConcurrency(files, UPLOAD_CONCURRENCY, function (file) {
      done += 1;
      setStatus('uploading ' + done + '/' + total + ' — ' + file.name + '…');
      var kind = classifyFile(file);
      if (isMuxable(kind)) {
        return uploadMuxFile(file, kind, { skipQueueRow: true });
      }
      return uploadVaultFile(file, kind, { skipQueueRow: true });
    })
      .then(function (results) {
        var lastVideo = null;
        (results || []).forEach(function (result) {
          if (result && result.ok) {
            var block = result.value;
            if (block && block.kind === 'video' && block.playbackId) {
              lastVideo = block;
            }
            return;
          }
          failed += 1;
        });
        setStatus(
          failed
            ? 'added ' + (total - failed) + '/' + total + ' (' + failed + ' failed)'
            : total === 1
              ? 'added'
              : 'added ' + total
        );
        return refresh().then(function () {
          if (lastVideo) {
            // Prefer the board's live block (ids/titles may normalize on save).
            var live =
              (state &&
                state.blocks &&
                state.blocks.find(function (b) {
                  return b && b.playbackId === lastVideo.playbackId;
                })) ||
              lastVideo;
            lastUploadedVideoId = live.id || lastUploadedVideoId;
            haptic([12, 40, 12]);
            setStatus('ready — share', {
              sticky: true,
              action: {
                label: 'share',
                onClick: function () {
                  shareClip(live);
                }
              }
            });
            openUploadedVideo(live);
          }
        });
      })
      .catch(function (err) {
        setStatus((err && err.message) || 'upload failed');
      });
  }

  function handleFolderFileList(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    importFolderAsClip(files).catch(function (err) {
      setStatus((err && err.message) || 'folder upload failed');
    });
  }

  function looksLikeLocalFilePath(text) {
    var value = String(text || '').trim();
    if (!value) return false;
    if (/^https?:\/\//i.test(value)) return false;
    if (/^file:\/\//i.test(value)) return true;
    if (value.charAt(0) === '/') return true;
    if (/^[A-Za-z]:[\\/]/.test(value)) return true;
    return /\.(wav|mp3|flac|aiff|aif|m4a|ogg|aac|mp4|mov|m4v|webm|mkv|avi|png|jpe?g|gif|webp|pdf|zip)(\s|$)/i.test(
      value
    );
  }

  function clearComposerInput() {
    var input = el('clipsComposerInput');
    if (input) input.value = '';
  }

  /** Safari drops on textareas often leave dt.files empty unless dragover was prevented early. */
  function collectDroppedFiles(dt) {
    if (!dt) return [];
    if (dt.files && dt.files.length) {
      return Array.prototype.slice.call(dt.files);
    }
    if (!dt.items || !dt.items.length) return [];
    var files = [];
    Array.prototype.slice.call(dt.items).forEach(function (item) {
      if (!item || item.kind !== 'file') return;
      var file = typeof item.getAsFile === 'function' ? item.getAsFile() : null;
      if (file) files.push(file);
    });
    return files;
  }

  function handleDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    document.body.classList.remove('clips-drag-over');
    var dt = event.dataTransfer;
    if (!dt) return;

    var droppedFiles = collectDroppedFiles(dt);
    if (droppedFiles.length) {
      clearComposerInput();
      handleFiles(droppedFiles);
      return;
    }

    var folderEntries = collectDroppedFolderEntries(dt);
    if (folderEntries) {
      if (!canWrite()) {
        setStatus('read only');
        return;
      }
      clearComposerInput();
      setStatus('reading folder…');
      folderEntries
        .then(function (entries) {
          return importFolderAsClip(entries);
        })
        .catch(function (err) {
          setStatus((err && err.message) || 'folder upload failed');
        });
      return;
    }

    var uri = dt.getData('text/uri-list') || '';
    var plain = dt.getData('text/plain') || '';
    if (looksLikeLocalFilePath(uri) || looksLikeLocalFilePath(plain)) {
      setStatus('drop the file itself, not the path');
      clearComposerInput();
      return;
    }
    if (uri && /^https?:\/\//i.test(uri.trim()) && !(dt.files && dt.files.length)) {
      if (!canWrite()) return;
      var href = uri.trim().split(/\s+/)[0];
      clearComposerInput();
      store
        .addBlock({
          kind: 'link',
          title: href.replace(/^https?:\/\//i, '').slice(0, 48),
          href: href
        })
        .then(function () {
          return refresh();
        });
      return;
    }
    if (plain && /^https?:\/\//i.test(plain.trim()) && !(dt.files && dt.files.length)) {
      if (!canWrite()) return;
      var linkHref = plain.trim().split(/\s+/)[0];
      clearComposerInput();
      store
        .addBlock({
          kind: 'link',
          title: linkHref.replace(/^https?:\/\//i, '').slice(0, 48),
          href: linkHref
        })
        .then(function () {
          return refresh();
        });
      return;
    }
    if (plain && plain.trim() && !(dt.files && dt.files.length) && !/^https?:\/\//i.test(plain.trim())) {
      if (!canWrite()) return;
      var note = plain.trim();
      clearComposerInput();
      store
        .addBlock({
          kind: 'text',
          title: note.slice(0, 48),
          text: note
        })
        .then(function () {
          return refresh();
        });
      return;
    }
  }

  function readEntriesBatch(dirReader) {
    return new Promise(function (resolve, reject) {
      dirReader.readEntries(resolve, reject);
    });
  }

  function readAllDirectoryEntries(dirReader) {
    var all = [];
    function next() {
      return readEntriesBatch(dirReader).then(function (batch) {
        if (!batch || !batch.length) return all;
        all = all.concat(batch);
        return next();
      });
    }
    return next();
  }

  function fileFromEntry(entry) {
    return new Promise(function (resolve, reject) {
      entry.file(resolve, reject);
    });
  }

  /** Recursively walks a dropped FileSystemEntry, returning [{file, relativePath}]. */
  function walkFileSystemEntry(entry, basePath) {
    if (!entry) return Promise.resolve([]);
    if (entry.isFile) {
      return fileFromEntry(entry).then(function (file) {
        return [{ file: file, relativePath: basePath + entry.name }];
      });
    }
    if (entry.isDirectory) {
      var reader = entry.createReader();
      return readAllDirectoryEntries(reader).then(function (children) {
        var chain = Promise.resolve([]);
        children.forEach(function (child) {
          chain = chain.then(function (acc) {
            return walkFileSystemEntry(child, basePath + entry.name + '/').then(function (childEntries) {
              return acc.concat(childEntries);
            });
          });
        });
        return chain;
      });
    }
    return Promise.resolve([]);
  }

  /**
   * Detects a dropped folder via the DataTransferItem entries API and, if found,
   * returns a Promise resolving to a flat [{file, relativePath}] list. Returns null
   * when nothing dropped looks like a folder (or the browser lacks the API), so the
   * caller can fall back to the plain flat-file drop path untouched.
   */
  function collectDroppedFolderEntries(dt) {
    if (!dt || !dt.items || !dt.items.length) return null;
    var items = Array.prototype.slice.call(dt.items).filter(function (item) {
      return item.kind === 'file';
    });
    if (!items.length) return null;
    var getEntry = null;
    if (typeof items[0].webkitGetAsEntry === 'function') {
      getEntry = function (item) {
        return item.webkitGetAsEntry();
      };
    } else if (typeof items[0].getAsEntry === 'function') {
      getEntry = function (item) {
        return item.getAsEntry();
      };
    }
    if (!getEntry) return null;
    var entries = items.map(getEntry).filter(Boolean);
    if (!entries.length) return null;
    var hasDirectory = entries.some(function (entry) {
      return entry.isDirectory;
    });
    if (!hasDirectory) return null;

    var chain = Promise.resolve([]);
    entries.forEach(function (entry) {
      chain = chain.then(function (acc) {
        return walkFileSystemEntry(entry, '').then(function (list) {
          return acc.concat(list);
        });
      });
    });
    return chain;
  }

  function commitComposerValue(raw) {
    if (!canWrite()) {
      setStatus('read only');
      return Promise.resolve();
    }
    var value = String(raw || '').trim();
    if (!value) return Promise.resolve();
    var input = el('clipsComposerInput');
    if (/^https?:\/\//i.test(value) && value.indexOf('\n') < 0 && value.indexOf(' ') < 0) {
      return store
        .addBlock({
          kind: 'link',
          title: value.replace(/^https?:\/\//i, '').slice(0, 48),
          href: value
        })
        .then(function () {
          if (input) input.value = '';
          return refresh();
        });
    }
    return store
      .addBlock({
        kind: 'text',
        title: value.slice(0, 48),
        text: value
      })
      .then(function () {
        if (input) input.value = '';
        return refresh();
      });
  }

  function closeAllClipMenus(exceptMenu) {
    var root = el('clipsRoot') || document.body;
    root.querySelectorAll('.clips-block-menu.is-open').forEach(function (menu) {
      if (exceptMenu && menu === exceptMenu) return;
      menu.classList.remove('is-open');
      var btn = menu.querySelector('[data-clip-more]');
      var panel = menu.querySelector('.clips-block-menu-panel');
      if (btn) btn.setAttribute('aria-expanded', 'false');
      if (panel) panel.hidden = true;
    });
  }

  function toggleClipMenu(menu) {
    if (!menu) return;
    var willOpen = !menu.classList.contains('is-open');
    closeAllClipMenus(willOpen ? menu : null);
    var btn = menu.querySelector('[data-clip-more]');
    var panel = menu.querySelector('.clips-block-menu-panel');
    if (willOpen) {
      menu.classList.add('is-open');
      if (btn) btn.setAttribute('aria-expanded', 'true');
      if (panel) panel.hidden = false;
    } else {
      menu.classList.remove('is-open');
      if (btn) btn.setAttribute('aria-expanded', 'false');
      if (panel) panel.hidden = true;
    }
  }

  function bindOnce() {
    var root = el('clipsRoot') || document.body;
    // Soft-nav replaces #clipsRoot; rebind when the live root changes.
    if (bound && boundRoot === root) return;
    bound = true;
    boundRoot = root;

    root.addEventListener('click', function (event) {
      var moreBtn = event.target.closest('[data-clip-more]');
      if (moreBtn) {
        event.preventDefault();
        event.stopPropagation();
        toggleClipMenu(moreBtn.closest('.clips-block-menu'));
        return;
      }
      var downloadBtn = event.target.closest('[data-download]');
      if (downloadBtn) {
        event.preventDefault();
        event.stopPropagation();
        closeAllClipMenus();
        var dlBlockEl = downloadBtn.closest('.clips-block');
        if (!dlBlockEl) return;
        var folderItemId = dlBlockEl.getAttribute('data-folder-item-id');
        if (folderItemId) {
          var folder = findBlock(openFolderId);
          var item =
            store.findFolderItem && state
              ? store.findFolderItem(state, openFolderId, folderItemId)
              : null;
          if (!item && folder) {
            item = (folder.items || []).find(function (row) {
              return row && row.id === folderItemId;
            });
          }
          downloadClip(folderItemAsBlock(item));
          return;
        }
        downloadClip(findBlock(dlBlockEl.getAttribute('data-block-id')));
        return;
      }
      var shareOnceBtn = event.target.closest('[data-share-once]');
      if (shareOnceBtn) {
        event.preventDefault();
        event.stopPropagation();
        closeAllClipMenus();
        var shareOnceBlockEl = shareOnceBtn.closest('.clips-block');
        if (!shareOnceBlockEl) return;
        var shareOnceFolderItemId = shareOnceBlockEl.getAttribute('data-folder-item-id');
        if (shareOnceFolderItemId) {
          var shareOnceFolder = findBlock(openFolderId);
          var shareOnceItem =
            store.findFolderItem && state
              ? store.findFolderItem(state, openFolderId, shareOnceFolderItemId)
              : null;
          if (!shareOnceItem && shareOnceFolder) {
            shareOnceItem = (shareOnceFolder.items || []).find(function (row) {
              return row && row.id === shareOnceFolderItemId;
            });
          }
          shareClip(folderItemAsBlock(shareOnceItem), { oneTime: true });
          return;
        }
        shareClip(findBlock(shareOnceBlockEl.getAttribute('data-block-id')), { oneTime: true });
        return;
      }
      var shareBtn = event.target.closest('[data-share]');
      if (shareBtn) {
        event.preventDefault();
        event.stopPropagation();
        closeAllClipMenus();
        var shareBlockEl = shareBtn.closest('.clips-block');
        if (!shareBlockEl) return;
        var shareFolderItemId = shareBlockEl.getAttribute('data-folder-item-id');
        if (shareFolderItemId) {
          var shareFolder = findBlock(openFolderId);
          var shareItem =
            store.findFolderItem && state
              ? store.findFolderItem(state, openFolderId, shareFolderItemId)
              : null;
          if (!shareItem && shareFolder) {
            shareItem = (shareFolder.items || []).find(function (row) {
              return row && row.id === shareFolderItemId;
            });
          }
          shareClip(folderItemAsBlock(shareItem));
          return;
        }
        shareClip(findBlock(shareBlockEl.getAttribute('data-block-id')));
        return;
      }
      var filterBtn = event.target.closest('[data-filter]');
      if (filterBtn) {
        event.preventDefault();
        event.stopPropagation();
        boardKindFilter = filterBtn.getAttribute('data-filter') || 'all';
        renderBoard();
        return;
      }
      var selectToggle = event.target.closest('[data-select-toggle]');
      if (selectToggle) {
        event.preventDefault();
        event.stopPropagation();
        selectMode = !selectMode;
        if (!selectMode) clearSelection();
        renderBoard();
        return;
      }
      if (event.target.closest('#clipsBatchShare')) {
        event.preventDefault();
        event.stopPropagation();
        shareBlocks(selectedBlocks());
        return;
      }
      if (event.target.closest('#clipsBatchOnce')) {
        event.preventDefault();
        event.stopPropagation();
        shareBlocks(selectedBlocks(), { oneTime: true });
        return;
      }
      if (event.target.closest('#clipsBatchClear')) {
        event.preventDefault();
        event.stopPropagation();
        clearSelection();
        renderBoard();
        return;
      }
      var removeBtn = event.target.closest('[data-remove]');
      if (removeBtn) {
        event.preventDefault();
        event.stopPropagation();
        closeAllClipMenus();
        var removeBlockEl = removeBtn.closest('.clips-block');
        handleRemoveTarget(removeBlockEl);
        return;
      }
      var folderItemRemove = event.target.closest('[data-folder-item-remove]');
      if (folderItemRemove) {
        event.preventDefault();
        event.stopPropagation();
        closeAllClipMenus();
        var itemNode = folderItemRemove.closest('[data-folder-item-id]');
        var itemId = itemNode && itemNode.getAttribute('data-folder-item-id');
        if (!itemId) return;
        removeOpenFolderItem(itemId);
        return;
      }
      if (!event.target.closest('.clips-block-menu')) {
        closeAllClipMenus();
      }
      if (event.target.closest('#clipsComposerSubmit')) {
        event.preventDefault();
        event.stopPropagation();
        var submitInput = el('clipsComposerInput');
        commitComposerValue(submitInput && submitInput.value);
        return;
      }
      if (event.target.closest('#clipsComposerVideo')) {
        event.preventDefault();
        event.stopPropagation();
        openClipsVideoPicker();
        return;
      }
      if (event.target.closest('#clipsComposerFiles')) {
        event.preventDefault();
        event.stopPropagation();
        openClipsFilePicker();
        return;
      }
      if (event.target.closest('#clipsComposerFolder')) {
        event.preventDefault();
        event.stopPropagation();
        openClipsFolderPicker();
        return;
      }
      if (event.target.closest('[data-composer]')) {
        var composer = el('clipsComposerInput');
        if (
          composer &&
          event.target !== composer &&
          !event.target.closest(
            '#clipsComposerVideo, #clipsComposerFiles, #clipsComposerSubmit, #clipsComposerFolder, .clips-composer-actions'
          )
        ) {
          composer.focus();
        }
      }
    });

    var lightbox = el('clipsLightbox');
    if (lightbox && lightbox.dataset.bound !== '1') {
      lightbox.dataset.bound = '1';
      lightbox.addEventListener('click', function (event) {
        if (event.target === lightbox || event.target.closest('#clipsLightboxClose')) {
          event.preventDefault();
          closeLightbox();
        }
      });
    }

    root.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        var openMenu = root.querySelector('.clips-block-menu.is-open');
        if (openMenu) {
          event.preventDefault();
          closeAllClipMenus();
          return;
        }
        var box = el('clipsLightbox');
        if (box && !box.hidden) {
          event.preventDefault();
          closeLightbox();
          return;
        }
        var videoWrap = el('clipsVideoStageWrap');
        if (videoWrap && !videoWrap.hidden) {
          event.preventDefault();
          closeVideoStage();
          return;
        }
      }
      if (event.key === 'Escape' && (openFolderId || openGroupId)) {
        var tag = event.target && event.target.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
          event.preventDefault();
          if (openFolderId) closeFolder();
          else closeCollection();
          return;
        }
      }
      if (event.target && event.target.id === 'clipsComposerInput') {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          commitComposerValue(event.target.value);
        }
        return;
      }
      if (event.target && event.target.classList && event.target.classList.contains('clips-block-edit')) {
        return;
      }
      var blockEl = event.target.closest('.clips-block[data-block-id]');
      if (!blockEl) return;
      // Space is owned by studio-playback-shell (capture). Enter still activates.
      if (event.key === 'Enter') {
        var enterBlock = findBlock(blockEl.getAttribute('data-block-id'));
        if (!enterBlock) return;
        event.preventDefault();
        activateBlock(enterBlock);
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        showBlockMenu(findBlock(blockEl.getAttribute('data-block-id')));
      }
    });

    root.addEventListener('paste', function (event) {
      if (!event.target || event.target.id !== 'clipsComposerInput') return;
      var text = '';
      try {
        text = (event.clipboardData && event.clipboardData.getData('text/plain')) || '';
      } catch (e) {
        return;
      }
      var trimmed = String(text || '').trim();
      if (!/^https?:\/\//i.test(trimmed) || trimmed.indexOf('\n') >= 0) return;
      event.preventDefault();
      commitComposerValue(trimmed);
    });

    root.addEventListener('contextmenu', function (event) {
      var blockEl = event.target.closest('.clips-block[data-block-id]');
      if (!blockEl) return;
      event.preventDefault();
      showBlockMenu(findBlock(blockEl.getAttribute('data-block-id')));
    });

    var input = el('clipsFileInput');
    if (input && input.dataset.bound !== '1') {
      input.dataset.bound = '1';
      input.addEventListener('change', function () {
        handleFiles(input.files);
        input.value = '';
      });
    }

    var videoInput = el('clipsVideoInput');
    if (videoInput && videoInput.dataset.bound !== '1') {
      videoInput.dataset.bound = '1';
      videoInput.addEventListener('change', function () {
        handleFiles(videoInput.files);
        videoInput.value = '';
      });
    }

    var folderInput = el('clipsFolderInput');
    if (folderInput && folderInput.dataset.bound !== '1') {
      folderInput.dataset.bound = '1';
      folderInput.addEventListener('change', function () {
        handleFolderFileList(folderInput.files);
        folderInput.value = '';
      });
    }

    var videoClose = el('clipsVideoStageClose');
    if (videoClose && videoClose.dataset.bound !== '1') {
      videoClose.dataset.bound = '1';
      videoClose.addEventListener('click', function (event) {
        event.preventDefault();
        closeVideoStage();
      });
    }

    var videoFullscreen = el('clipsVideoStageFullscreen');
    if (videoFullscreen && videoFullscreen.dataset.bound !== '1') {
      videoFullscreen.dataset.bound = '1';
      videoFullscreen.addEventListener('click', function (event) {
        event.preventDefault();
        requestVideoFullscreen();
      });
    }

    root.addEventListener('dragenter', function (event) {
      if (!event.dataTransfer) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      document.body.classList.add('clips-drag-over');
    }, true);
    root.addEventListener('dragover', function (event) {
      if (!event.dataTransfer) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      document.body.classList.add('clips-drag-over');
    }, true);
    root.addEventListener('dragleave', function (event) {
      if (!root.contains(event.relatedTarget)) {
        document.body.classList.remove('clips-drag-over');
      }
    }, true);
    root.addEventListener('drop', function (event) {
      handleDrop(event);
    }, true);

    if (!windowEventsBound) {
      windowEventsBound = true;
      window.addEventListener('burnfolder-stream-playback', syncPlayingBlocks);
      window.addEventListener('burnfolder-stack-changed', function () {
        if (!store || !state) return;
        renderBoard();
      });
    }
  }

  function pruneLegacyFolders(next) {
    if (!next || !(next.folders || []).length) return Promise.resolve(next);
    next.folders = [];
    (next.blocks || []).forEach(function (block) {
      if (block) block.folderId = null;
    });
    return store.save(next);
  }

  function refresh() {
    return store.load().then(function (next) {
      return pruneLegacyFolders(next);
    }).then(function (next) {
      state = next;
      render();
      return state;
    });
  }

  function paintBootShell() {
    var board = el('clipsBoard');
    if (!board) return;
    if (state) {
      render();
      return;
    }
    if (board.querySelector('[data-composer], .clips-composer, .clips-block')) return;
    board.innerHTML = composerHtml();
    wireComposerActions(board);
  }

  function importMuxLibrary(initId) {
    var mux = window.BurnfolderStudioMux;
    if (!mux || typeof mux.listMuxLibrary !== 'function') {
      syncNowPlayingCatalog();
      return Promise.resolve(null);
    }
    return mux
      .listMuxLibrary({ force: true })
      .then(function (assets) {
        if (initId !== initGeneration) return null;
        libraryCache = assets || [];
        syncNowPlayingCatalog();
        return store.importAudioLibrary(libraryCache);
      })
      .then(function () {
        if (initId !== initGeneration) return null;
        return refresh();
      })
      .catch(function () {
        if (initId !== initGeneration) return null;
        syncNowPlayingCatalog();
        return null;
      });
  }

  function init() {
    store = window.BurnfolderClipsStore;
    if (!store) {
      setStatus('clips store missing');
      return;
    }

    var initId = (initGeneration += 1);
    markNav();

    // Soft-nav leaves drill-in flags / upload hosts pointing at detached DOM.
    openGroupId = null;
    openFolderId = null;
    uploadQueue = null;
    document.body.classList.remove(
      'clips-folder-open',
      'clips-collection-open',
      'clips-lightbox-open'
    );

    bindOnce();
    paintBootShell();
    setStatus('loading…', { sticky: true });

    // Paint from the clips store first. Mux library import can be slow or hang
    // on a cold network; blocking first paint on it left a blank board under
    // the constellation menu until the user re-clicked clips.
    store
      .seedFromStudio()
      .then(function () {
        if (initId !== initGeneration) return null;
        syncNowPlayingCatalog();
        return refresh();
      })
      .then(function () {
        if (initId !== initGeneration) return null;
        setStatus('');
        return importMuxLibrary(initId);
      })
      .catch(function (err) {
        if (initId !== initGeneration) return;
        setStatus((err && err.message) || 'failed to load clips');
      });
  }

  window.studioInitClipsPage = init;
  window.studioFlushClipsSave = function () {
    if (!store || !state) return Promise.resolve();
    return store.save(state);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      if (document.body && document.body.classList.contains('studio-clips-page')) init();
    });
  } else if (document.body && document.body.classList.contains('studio-clips-page')) {
    init();
  }
})();
