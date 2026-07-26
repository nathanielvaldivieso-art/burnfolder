/**
 * Clips board state — typed blocks synced via BurnfolderCloudState.
 *
 * Block kinds: text | link | image | audio | video | file | album | tool | folder
 * Storage: Mux playbackId for streamable A/V; R2 vaultKey for files/images;
 * album.groupId links to stream groups; folder.items nests uploaded files;
 * tool.toolId e.g. word-pull.
 */
(function () {
  'use strict';

  var CLOUD_KEY = 'clips';
  var LOCAL_KEY = 'burnfolderStudioClips';
  var SEED_FLAG = 'burnfolderStudioClipsSeeded';

  var BLOCK_KINDS = {
    text: 1,
    link: 1,
    image: 1,
    audio: 1,
    video: 1,
    file: 1,
    album: 1,
    tool: 1,
    folder: 1
  };

  var FOLDER_SORTS = { name: 1, newest: 1, type: 1 };

  function makeId(prefix) {
    return (
      String(prefix || 'c') +
      '_' +
      Date.now().toString(36) +
      '_' +
      Math.random().toString(36).slice(2, 8)
    );
  }

  function emptyState() {
    return {
      folders: [],
      blocks: [],
      updatedAt: new Date().toISOString()
    };
  }

  function normalizeFolder(item) {
    if (!item || typeof item !== 'object') return null;
    var id = String(item.id || '').trim();
    if (!id) return null;
    return {
      id: id,
      title: String(item.title || 'folder').trim() || 'folder',
      order: typeof item.order === 'number' ? item.order : 0,
      createdAt: item.createdAt || new Date().toISOString()
    };
  }

  function normalizeFolderItem(item) {
    if (!item || typeof item !== 'object') return null;
    var kind = String(item.kind || 'file').trim().toLowerCase();
    if (!BLOCK_KINDS[kind] || kind === 'folder' || kind === 'album' || kind === 'tool') {
      kind = 'file';
    }
    return {
      id: String(item.id || '').trim() || makeId('item'),
      kind: kind,
      title: String(item.title || '').trim(),
      playbackId: String(item.playbackId || '').trim(),
      vaultKey: String(item.vaultKey || '').trim(),
      filename: String(item.filename || '').trim(),
      relativePath: String(item.relativePath || '').trim(),
      contentType: String(item.contentType || '').trim(),
      size: typeof item.size === 'number' ? item.size : Number(item.size) || 0,
      passthrough: String(item.passthrough || '').trim(),
      createdAt: item.createdAt || new Date().toISOString()
    };
  }

  function normalizeBlock(item) {
    if (!item || typeof item !== 'object') return null;
    var kind = String(item.kind || 'text').trim().toLowerCase();
    if (!BLOCK_KINDS[kind]) kind = 'text';
    var id = String(item.id || '').trim() || makeId('block');
    var folderId = item.folderId == null || item.folderId === '' ? null : String(item.folderId);
    var sortBy = String(item.sortBy || 'name').trim().toLowerCase();
    if (!FOLDER_SORTS[sortBy]) sortBy = 'name';
    var items = Array.isArray(item.items)
      ? item.items.map(normalizeFolderItem).filter(Boolean)
      : [];
    return {
      id: id,
      kind: kind,
      folderId: folderId,
      title: String(item.title || '').trim(),
      text: String(item.text || '').trim(),
      href: String(item.href || '').trim(),
      playbackId: String(item.playbackId || '').trim(),
      vaultKey: String(item.vaultKey || '').trim(),
      filename: String(item.filename || '').trim(),
      relativePath: String(item.relativePath || '').trim(),
      contentType: String(item.contentType || '').trim(),
      size: typeof item.size === 'number' ? item.size : Number(item.size) || 0,
      groupId: String(item.groupId || '').trim(),
      toolId: String(item.toolId || '').trim(),
      coverArt: String(item.coverArt || '').trim(),
      coverAssetId: String(item.coverAssetId || '').trim(),
      passthrough: String(item.passthrough || '').trim(),
      items: kind === 'folder' ? items : [],
      sortBy: kind === 'folder' ? sortBy : 'name',
      order: typeof item.order === 'number' ? item.order : 0,
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || item.createdAt || new Date().toISOString()
    };
  }

  function normalizeState(raw) {
    var base = emptyState();
    if (!raw || typeof raw !== 'object') return base;
    var folders = Array.isArray(raw.folders)
      ? raw.folders.map(normalizeFolder).filter(Boolean)
      : [];
    var blocks = Array.isArray(raw.blocks)
      ? raw.blocks.map(normalizeBlock).filter(Boolean)
      : [];
    folders.sort(function (a, b) {
      return a.order - b.order || a.title.localeCompare(b.title);
    });
    blocks.sort(function (a, b) {
      return a.order - b.order || String(b.createdAt).localeCompare(String(a.createdAt));
    });
    return {
      folders: folders,
      blocks: blocks,
      updatedAt: raw.updatedAt || base.updatedAt
    };
  }

  function readLocal() {
    try {
      var raw = localStorage.getItem(LOCAL_KEY);
      if (!raw) return emptyState();
      return normalizeState(JSON.parse(raw));
    } catch (e) {
      return emptyState();
    }
  }

  function writeLocal(state) {
    var next = normalizeState(state);
    next.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
    } catch (e) {
      /* quota */
    }
    return next;
  }

  function cloud() {
    return window.BurnfolderCloudState || null;
  }

  function pushCloud(state) {
    var c = cloud();
    if (!c || typeof c.put !== 'function') return Promise.resolve(state);
    return c.put(CLOUD_KEY, state, 400).then(function () {
      return state;
    });
  }

  /** Apply a mutation to localStorage immediately; cloud sync runs in the background. */
  function mutateLocal(mutator) {
    var state = readLocal();
    var result = typeof mutator === 'function' ? mutator(state) : undefined;
    var next = writeLocal(state);
    pushCloud(next).catch(function () {
      /* local is source of truth until next successful sync */
    });
    return Promise.resolve(result === undefined ? next : result);
  }

  function load() {
    var local = readLocal();
    var c = cloud();
    if (!c || !c.get) return Promise.resolve(local);
    return c
      .get(CLOUD_KEY)
      .then(function (remote) {
        if (remote == null) {
          if (local.blocks.length || local.folders.length) {
            return pushCloud(local).then(function () {
              return local;
            });
          }
          return local;
        }
        var next = normalizeState(remote);
        writeLocal(next);
        return next;
      })
      .catch(function () {
        return local;
      });
  }

  function save(state) {
    var next = writeLocal(state);
    return pushCloud(next).then(function () {
      return next;
    });
  }

  function nextOrder(items) {
    var max = -1;
    (items || []).forEach(function (item) {
      if (item && typeof item.order === 'number' && item.order > max) max = item.order;
    });
    return max + 1;
  }

  function addFolder(title) {
    return load().then(function (state) {
      var folder = normalizeFolder({
        id: makeId('folder'),
        title: title || 'folder',
        order: nextOrder(state.folders),
        createdAt: new Date().toISOString()
      });
      state.folders.push(folder);
      return save(state).then(function () {
        return folder;
      });
    });
  }

  function findFolderByTitle(state, title) {
    var t = String(title || '').trim().toLowerCase();
    if (!t || !state) return null;
    return (
      (state.folders || []).find(function (f) {
        return String(f.title || '').trim().toLowerCase() === t;
      }) || null
    );
  }

  /** Reuses a folder with a matching title (case-insensitive) or creates a new one. */
  function ensureFolder(title) {
    return load().then(function (state) {
      var existing = findFolderByTitle(state, title);
      if (existing) return existing;
      return addFolder(title);
    });
  }

  function renameFolder(folderId, title) {
    return load().then(function (state) {
      var folder = state.folders.find(function (f) {
        return f.id === folderId;
      });
      if (!folder) return null;
      folder.title = String(title || '').trim() || folder.title;
      return save(state).then(function () {
        return folder;
      });
    });
  }

  function removeFolder(folderId) {
    return load().then(function (state) {
      state.folders = state.folders.filter(function (f) {
        return f.id !== folderId;
      });
      state.blocks.forEach(function (b) {
        if (b.folderId === folderId) b.folderId = null;
      });
      return save(state);
    });
  }

  function addBlock(partial) {
    return load().then(function (state) {
      var block = normalizeBlock(
        Object.assign({}, partial, {
          id: partial && partial.id ? partial.id : makeId('block'),
          order: partial && typeof partial.order === 'number' ? partial.order : nextOrder(state.blocks),
          createdAt: (partial && partial.createdAt) || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
      );
      if (!block) return null;
      state.blocks.unshift(block);
      return save(state).then(function () {
        return block;
      });
    });
  }

  function updateBlock(blockId, patch) {
    return load().then(function (state) {
      var block = state.blocks.find(function (b) {
        return b.id === blockId;
      });
      if (!block) return null;
      Object.keys(patch || {}).forEach(function (key) {
        if (key === 'id') return;
        block[key] = patch[key];
      });
      block.updatedAt = new Date().toISOString();
      block = normalizeBlock(block);
      state.blocks = state.blocks.map(function (b) {
        return b.id === blockId ? block : b;
      });
      return save(state).then(function () {
        return block;
      });
    });
  }

  function removeBlock(blockId) {
    return mutateLocal(function (state) {
      state.blocks = state.blocks.filter(function (b) {
        return b.id !== blockId;
      });
    });
  }

  function moveBlock(blockId, folderId) {
    return updateBlock(blockId, {
      folderId: folderId == null || folderId === '' ? null : String(folderId)
    });
  }

  function findBlockByPlaybackId(state, playbackId) {
    var id = String(playbackId || '').trim();
    if (!id) return null;
    return (
      state.blocks.find(function (b) {
        return b.playbackId === id;
      }) || null
    );
  }

  function versionsApi() {
    return window.BurnfolderSongVersions || null;
  }

  function blockLabel(block) {
    if (!block) return '';
    return String(block.title || block.passthrough || block.filename || '').trim();
  }

  function groupKeyForTitle(title) {
    var api = versionsApi();
    if (!api || !api.getTrackGroupKey) return String(title || '').toLowerCase().trim();
    return api.getTrackGroupKey(title);
  }

  function groupKeyForBlock(block) {
    if (!block || block.kind !== 'audio') return '';
    var key = groupKeyForTitle(blockLabel(block));
    return key || String(block.playbackId || '').trim();
  }

  function baseTitleForLabel(title) {
    var api = versionsApi();
    var raw = String(title || '').trim();
    if (!raw) return '';
    if (!api || !api.stripTrailingDate) return raw;
    return api.stripTrailingDate(raw) || raw;
  }

  function songLikeFromBlock(block) {
    return {
      title: blockLabel(block),
      playbackId: block && block.playbackId,
      createdAt: block && block.createdAt
    };
  }

  function songLikeFromAsset(asset, title) {
    return {
      title: title,
      playbackId: asset && asset.playbackId,
      createdAt: asset && (asset.createdAt || asset.created_at)
    };
  }

  function isNewerSong(candidate, current) {
    var api = versionsApi();
    if (!api || !api.parseTrackDateValue) {
      return String((candidate && candidate.createdAt) || '') > String((current && current.createdAt) || '');
    }
    var a = api.parseTrackDateValue(candidate);
    var b = api.parseTrackDateValue(current);
    if (a !== b) return a > b;
    return String((candidate && candidate.createdAt) || '') > String((current && current.createdAt) || '');
  }

  function findAudioBlockByGroupKey(state, groupKey) {
    var key = String(groupKey || '').trim();
    if (!key) return null;
    return (
      state.blocks.find(function (b) {
        return b.kind === 'audio' && groupKeyForBlock(b) === key;
      }) || null
    );
  }

  /**
   * Collapse dated mix versions into one audio block per song identity.
   * Keeps the newest playbackId, renames to base title, drops sibling version tiles.
   */
  function collapseAudioVersionStacks(state) {
    if (!state || !Array.isArray(state.blocks)) return false;
    var changed = false;
    var byKey = new Map();

    state.blocks.forEach(function (block) {
      if (!block || block.kind !== 'audio' || !block.playbackId) return;
      var key = groupKeyForBlock(block);
      if (!key) return;
      var existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, block);
        return;
      }
      if (isNewerSong(songLikeFromBlock(block), songLikeFromBlock(existing))) {
        byKey.set(key, block);
      }
    });

    byKey.forEach(function (winner) {
      var base = baseTitleForLabel(blockLabel(winner));
      if (base && winner.title !== base) {
        winner.title = base;
        winner.updatedAt = new Date().toISOString();
        changed = true;
      }
    });

    var nextBlocks = state.blocks.filter(function (block) {
      if (!block || block.kind !== 'audio' || !block.playbackId) return true;
      var key = groupKeyForBlock(block);
      if (!key) return true;
      var winner = byKey.get(key);
      if (!winner) return true;
      if (block.id === winner.id) return true;
      changed = true;
      return false;
    });

    if (nextBlocks.length !== state.blocks.length) {
      state.blocks = nextBlocks;
      changed = true;
    }
    return changed;
  }

  function findAlbumBlock(state, groupId) {
    var id = String(groupId || '').trim();
    if (!id) return null;
    return (
      state.blocks.find(function (b) {
        return b.kind === 'album' && b.groupId === id;
      }) || null
    );
  }

  function findToolBlock(state, toolId) {
    var id = String(toolId || '').trim();
    if (!id) return null;
    return (
      state.blocks.find(function (b) {
        return b.kind === 'tool' && b.toolId === id;
      }) || null
    );
  }

  /**
   * Seed word-pull + album blocks + one audio clip per song (version stack).
   * Multiple dated mixes of the same song share one board icon; albums stay collections.
   * Board visibility is membership-filtered in clips-page (housed audio stays in store
   * but leaves the main grid until unfiled — OS-folder behavior).
   */
  function seedFromStudio(options) {
    var force = !!(options && options.force);
    return load().then(function (state) {
      var changed = false;
      if (collapseAudioVersionStacks(state)) changed = true;

      var groupsApi = window.BurnfolderStreamShared;
      var groups = groupsApi && groupsApi.loadGroups ? groupsApi.loadGroups() : [];

      groups.forEach(function (group) {
        if (!group || !group.id) return;
        var meta = group.meta || {};
        var albumTitle = String(meta.title || '').trim() || 'playlist';
        var existingAlbum = findAlbumBlock(state, group.id);
        if (!existingAlbum) {
          state.blocks.push(
            normalizeBlock({
              id: makeId('block'),
              kind: 'album',
              title: albumTitle,
              groupId: group.id,
              coverArt: meta.coverArt || '',
              coverAssetId: meta.coverAssetId || '',
              order: nextOrder(state.blocks),
              createdAt: new Date().toISOString()
            })
          );
          changed = true;
        } else {
          var albumPatched = false;
          if (
            meta.title &&
            existingAlbum.title !== meta.title &&
            (existingAlbum.title === 'album' ||
              existingAlbum.title === 'playlist' ||
              !existingAlbum.title)
          ) {
            existingAlbum.title = meta.title;
            albumPatched = true;
          }
          if (meta.coverArt && existingAlbum.coverArt !== meta.coverArt) {
            existingAlbum.coverArt = meta.coverArt;
            albumPatched = true;
          }
          if (meta.coverAssetId && existingAlbum.coverAssetId !== meta.coverAssetId) {
            existingAlbum.coverAssetId = meta.coverAssetId;
            albumPatched = true;
          }
          if (albumPatched) changed = true;
        }

        (group.tracks || []).forEach(function (track) {
          if (!track || !track.playbackId) return;
          if (findBlockByPlaybackId(state, track.playbackId)) return;
          var trackTitle = String(track.title || 'track').trim() || 'track';
          var key = groupKeyForTitle(trackTitle);
          var existingSong = key ? findAudioBlockByGroupKey(state, key) : null;
          if (existingSong) {
            if (isNewerSong(songLikeFromAsset(track, trackTitle), songLikeFromBlock(existingSong))) {
              existingSong.playbackId = track.playbackId;
              existingSong.title = baseTitleForLabel(trackTitle) || existingSong.title;
              existingSong.passthrough = track.passthrough || existingSong.passthrough;
              existingSong.updatedAt = new Date().toISOString();
              changed = true;
            }
            return;
          }
          state.blocks.push(
            normalizeBlock({
              id: makeId('block'),
              kind: 'audio',
              title: baseTitleForLabel(trackTitle) || trackTitle,
              playbackId: track.playbackId,
              order: nextOrder(state.blocks),
              createdAt: new Date().toISOString()
            })
          );
          changed = true;
        });
      });

      if (!findToolBlock(state, 'word-pull')) {
        state.blocks.push(
          normalizeBlock({
            id: makeId('block'),
            kind: 'tool',
            title: 'word pull',
            toolId: 'word-pull',
            text: 'conveyor belts of words — compose and log sentences',
            order: nextOrder(state.blocks),
            createdAt: new Date().toISOString()
          })
        );
        changed = true;
      }

      try {
        if (!force && localStorage.getItem(SEED_FLAG) === '1' && !changed) {
          return state;
        }
        localStorage.setItem(SEED_FLAG, '1');
      } catch (e) {
        /* noop */
      }

      if (!changed) return state;
      return save(state);
    });
  }

  /** Update collection name/cover on stream meta + matching album block. */
  function patchAlbumPresentation(groupId, patch) {
    var id = String(groupId || '').trim();
    if (!id) return Promise.resolve(null);
    var groupsApi = window.BurnfolderStreamShared;
    if (!groupsApi || !groupsApi.loadStackMeta || !groupsApi.saveStackMeta) {
      return Promise.resolve(null);
    }
    return load().then(function (state) {
      var meta = groupsApi.loadStackMeta(id) || {};
      var existing = findAlbumBlock(state, id);
      var changedMeta = false;
      var changedBlock = false;

      if (patch && patch.title != null) {
        var nextTitle = String(patch.title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        if (meta.title !== nextTitle) {
          meta.title = nextTitle;
          changedMeta = true;
        }
        if (existing && existing.title !== nextTitle) {
          existing.title = nextTitle || existing.title;
          existing.updatedAt = new Date().toISOString();
          changedBlock = true;
        }
      }

      if (patch && Object.prototype.hasOwnProperty.call(patch, 'coverArt')) {
        var coverArt = String(patch.coverArt || '').trim();
        var coverAssetId = String(patch.coverAssetId || '').trim();
        var coverAlt = String(patch.coverAlt || meta.title || '').trim();
        if (meta.coverArt !== coverArt || meta.coverAssetId !== coverAssetId) {
          meta.coverArt = coverArt;
          meta.coverAssetId = coverAssetId;
          meta.coverAlt = coverAlt;
          changedMeta = true;
        }
        if (
          existing &&
          (existing.coverArt !== coverArt || existing.coverAssetId !== coverAssetId)
        ) {
          existing.coverArt = coverArt;
          existing.coverAssetId = coverAssetId;
          existing.updatedAt = new Date().toISOString();
          changedBlock = true;
        }
      }

      if (changedMeta) groupsApi.saveStackMeta(meta, id);

      if (!existing) {
        return ensureAlbumBlock(id, meta.title || 'collection').then(function (block) {
          return block;
        });
      }
      if (!changedBlock) return existing;
      return save(state).then(function () {
        return existing;
      });
    });
  }

  /** Ensure an album block exists for a music group; update title/cover from meta. */
  function ensureAlbumBlock(groupId, fallbackTitle) {
    return load().then(function (state) {
      var groupsApi = window.BurnfolderStreamShared;
      var group =
        groupsApi && groupsApi.findGroupById ? groupsApi.findGroupById(groupId) : null;
      if (!group) return null;
      var meta = (groupsApi.loadStackMeta && groupsApi.loadStackMeta(groupId)) || group.meta || {};
      var title =
        String(meta.title || '').trim() ||
        String(fallbackTitle || '').trim() ||
        'playlist';
      var existing = findAlbumBlock(state, groupId);
      if (existing) {
        var patched = false;
        if (title && existing.title !== title) {
          if (
            !existing.title ||
            existing.title === 'album' ||
            existing.title === 'playlist' ||
            existing.title === 'untitled'
          ) {
            existing.title = title;
            patched = true;
          }
        }
        if (meta.coverArt && existing.coverArt !== meta.coverArt) {
          existing.coverArt = meta.coverArt;
          patched = true;
        }
        if (meta.coverAssetId && existing.coverAssetId !== meta.coverAssetId) {
          existing.coverAssetId = meta.coverAssetId;
          patched = true;
        }
        if (!patched) return existing;
        return save(state).then(function () {
          return existing;
        });
      }
      return addBlock({
        kind: 'album',
        title: title,
        groupId: groupId,
        coverArt: meta.coverArt || '',
        coverAssetId: meta.coverAssetId || ''
      });
    });
  }

  /** Import mux library audio as one clip per song (stack versions; upgrade to newest). */
  function importAudioLibrary(assets) {
    return load().then(function (state) {
      var changed = false;
      if (collapseAudioVersionStacks(state)) changed = true;

      (assets || []).forEach(function (asset) {
        if (!asset || !asset.playbackId) return;
        var kind = String(asset.kind || '').toLowerCase();
        if (kind === 'video' || asset.isVideo) return;
        if (findBlockByPlaybackId(state, asset.playbackId)) return;

        var rawTitle =
          asset.displayTitle ||
          asset.title ||
          asset.passthrough ||
          asset.name ||
          'track';
        var title = String(rawTitle).replace(/\.[^.]+$/, '').trim() || 'track';
        var key = groupKeyForTitle(title);
        var existing = key ? findAudioBlockByGroupKey(state, key) : null;
        if (existing) {
          if (isNewerSong(songLikeFromAsset(asset, title), songLikeFromBlock(existing))) {
            existing.playbackId = asset.playbackId;
            existing.title = baseTitleForLabel(title) || existing.title;
            existing.filename = asset.name || asset.passthrough || existing.filename;
            existing.passthrough = asset.passthrough || existing.passthrough;
            existing.updatedAt = new Date().toISOString();
            changed = true;
          } else {
            var base = baseTitleForLabel(existing.title || title);
            if (base && existing.title !== base) {
              existing.title = base;
              existing.updatedAt = new Date().toISOString();
              changed = true;
            }
          }
          return;
        }

        state.blocks.push(
          normalizeBlock({
            id: makeId('block'),
            kind: 'audio',
            title: baseTitleForLabel(title) || title,
            playbackId: asset.playbackId,
            filename: asset.name || asset.passthrough || '',
            passthrough: asset.passthrough || '',
            order: nextOrder(state.blocks),
            createdAt: new Date().toISOString()
          })
        );
        changed = true;
      });

      if (collapseAudioVersionStacks(state)) changed = true;
      if (!changed) return state;
      return save(state);
    });
  }

  function blocksInFolder(state, folderId) {
    var blocks = (state && state.blocks) || [];
    if (folderId === 'all' || folderId == null || folderId === '') return blocks.slice();
    return blocks.filter(function (b) {
      return b.folderId === folderId;
    });
  }

  function appendFolderItem(folderBlockId, item) {
    return load().then(function (state) {
      var block = state.blocks.find(function (b) {
        return b.id === folderBlockId && b.kind === 'folder';
      });
      if (!block) return null;
      var next = normalizeFolderItem(item);
      if (!next) return null;
      block.items = (block.items || []).concat([next]);
      block.updatedAt = new Date().toISOString();
      block = normalizeBlock(block);
      state.blocks = state.blocks.map(function (b) {
        return b.id === folderBlockId ? block : b;
      });
      return save(state).then(function () {
        return block;
      });
    });
  }

  function setFolderSort(folderBlockId, sortBy) {
    var next = String(sortBy || 'name').trim().toLowerCase();
    if (!FOLDER_SORTS[next]) next = 'name';
    return updateBlock(folderBlockId, { sortBy: next });
  }

  function removeFolderItem(folderBlockId, itemId) {
    return mutateLocal(function (state) {
      var block = state.blocks.find(function (b) {
        return b.id === folderBlockId && b.kind === 'folder';
      });
      if (!block) return null;
      block.items = (block.items || []).filter(function (item) {
        return item && item.id !== itemId;
      });
      block.updatedAt = new Date().toISOString();
      block = normalizeBlock(block);
      state.blocks = state.blocks.map(function (b) {
        return b.id === folderBlockId ? block : b;
      });
      return block;
    });
  }

  function sortedFolderItems(block) {
    if (!block || block.kind !== 'folder') return [];
    var items = (block.items || []).slice();
    var sortBy = block.sortBy || 'name';
    items.sort(function (a, b) {
      if (sortBy === 'newest') {
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      }
      if (sortBy === 'type') {
        var ka = String(a.kind || '') + ' ' + String(a.filename || a.title || '');
        var kb = String(b.kind || '') + ' ' + String(b.filename || b.title || '');
        return ka.localeCompare(kb, undefined, { sensitivity: 'base' });
      }
      var na = String(a.title || a.filename || '').toLowerCase();
      var nb = String(b.title || b.filename || '').toLowerCase();
      return na.localeCompare(nb, undefined, { sensitivity: 'base', numeric: true });
    });
    return items;
  }

  function findFolderItem(state, folderBlockId, itemId) {
    var block =
      (state &&
        state.blocks.find(function (b) {
          return b.id === folderBlockId && b.kind === 'folder';
        })) ||
      null;
    if (!block) return null;
    return (
      (block.items || []).find(function (item) {
        return item && item.id === itemId;
      }) || null
    );
  }

  window.BurnfolderClipsStore = {
    CLOUD_KEY: CLOUD_KEY,
    BLOCK_KINDS: BLOCK_KINDS,
    makeId: makeId,
    emptyState: emptyState,
    normalizeState: normalizeState,
    load: load,
    save: save,
    addFolder: addFolder,
    findFolderByTitle: findFolderByTitle,
    ensureFolder: ensureFolder,
    renameFolder: renameFolder,
    removeFolder: removeFolder,
    addBlock: addBlock,
    updateBlock: updateBlock,
    removeBlock: removeBlock,
    moveBlock: moveBlock,
    appendFolderItem: appendFolderItem,
    setFolderSort: setFolderSort,
    removeFolderItem: removeFolderItem,
    sortedFolderItems: sortedFolderItems,
    findFolderItem: findFolderItem,
    seedFromStudio: seedFromStudio,
    ensureAlbumBlock: ensureAlbumBlock,
    patchAlbumPresentation: patchAlbumPresentation,
    importAudioLibrary: importAudioLibrary,
    collapseAudioVersionStacks: collapseAudioVersionStacks,
    blocksInFolder: blocksInFolder,
    findBlockByPlaybackId: findBlockByPlaybackId,
    findAudioBlockByGroupKey: findAudioBlockByGroupKey,
    groupKeyForBlock: groupKeyForBlock,
    baseTitleForLabel: baseTitleForLabel,
    findAlbumBlock: findAlbumBlock,
    findToolBlock: findToolBlock
  };

})();
