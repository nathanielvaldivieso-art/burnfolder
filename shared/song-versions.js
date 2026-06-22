/**
 * Shared song grouping / version sorting for burnfolder.com and studio stream.
 * Groups tracks by worded base title (date stripped), sorts by embedded date.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.BurnfolderSongVersions = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const globalRef =
    typeof globalThis !== 'undefined'
      ? globalThis
      : typeof window !== 'undefined'
        ? window
        : this;

  const TRACK_DATE_SUFFIX_RE =
    /\s*(?:\(|\s)(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:\)|\s|$)/i;

  function normalizeYearPart(yearPart) {
    const y = String(yearPart || '').trim();
    if (!y) return '';
    if (y.length >= 4) return y.slice(-2);
    return y;
  }

  /** Site-style title: keep full dated name, 4-digit mux years → 2-digit. */
  function normalizeTrackTitle(title) {
    let t = String(title || '').trim();
    if (!t) return '';

    // Drop a trailing media file extension from raw upload filenames so
    // "FIRE ESCAPE 4.26.26.wav" displays + groups as "FIRE ESCAPE 4.26.26".
    t = t
      .replace(
        /\.(wav|mp3|m4a|aac|aiff|aif|flac|ogg|oga|opus|wma|caf|alac|mov|mp4|m4v|webm|mkv|avi|wmv)$/i,
        ''
      )
      .trim();
    if (!t) return '';

    let versionSuffix = '';
    const versionMatch = t.match(/(\s+v\d+|v\d+)\s*$/i);
    if (versionMatch) {
      versionSuffix = versionMatch[0];
      t = t.slice(0, versionMatch.index).trimEnd();
    }

    t = t.replace(TRACK_DATE_SUFFIX_RE, function (match, month, day, year) {
      const open = match.indexOf('(') >= 0 ? '(' : ' ';
      const yy = normalizeYearPart(year);
      return open + month + '.' + day + '.' + yy + (open === '(' ? ')' : '');
    });

    const merged = (t + versionSuffix).replace(/\s+/g, ' ').trim();
    return merged;
  }

  function extractDateFromText(text) {
    const match = String(text || '').match(TRACK_DATE_SUFFIX_RE);
    if (!match) return null;
    return match[1] + '.' + match[2] + '.' + normalizeYearPart(match[3]);
  }

  function getTrackDateLabel(song) {
    const fromTitle = extractDateFromText(song && song.title);
    if (fromTitle) return fromTitle;
    if (song && /^\d+\.\d+\.\d+$/.test(song.page || '')) return song.page;
    if (song && song.createdAt) {
      const d = new Date(song.createdAt);
      if (!Number.isNaN(d.getTime())) {
        const m = d.getMonth() + 1;
        const day = d.getDate();
        const y = String(d.getFullYear()).slice(-2);
        return m + '.' + day + '.' + y;
      }
    }
    return '';
  }

  function parseTrackDateValue(song) {
    const label = getTrackDateLabel(song);
    if (!label) return -Infinity;

    const parts = label.split('.').map(Number);
    const monthRaw = parts[0];
    const dayRaw = parts[1];
    const yearRaw = parts[2];
    if (![monthRaw, dayRaw, yearRaw].every(Number.isFinite)) return -Infinity;

    const year = 2000 + yearRaw;
    return new Date(year, monthRaw - 1, dayRaw).getTime();
  }

  function stripTrailingDate(title) {
    const t = normalizeTrackTitle(title);
    let out = String(t || '');
    // Strip mux-style version tags + trailing dates.
    // Date separators may be . - _ or / (e.g. 4.26.26, 4-26-26, 4_26_26, 4/26).
    for (let i = 0; i < 4; i++) {
      const next = out
        .replace(/\s*v\d+\s*$/i, '')
        .replace(/\s*\(\d{1,2}[._/-]\d{1,2}[._/-]\d{2,4}\)\s*$/i, '')
        .replace(/\s+\d{1,2}[._/-]\d{1,2}[._/-]\d{2,4}\s*$/i, '')
        .replace(/\s*\([^)]*$/i, '')
        .replace(/\s*\(\d{1,2}[._/-]\d{1,2}(?:[._/-]\d{0,4})?\)?\s*$/i, '')
        .replace(/\s+\d{1,2}[._/-]\d{1,2}(?:[._/-]\d{0,4})?\s*$/i, '');
      if (next === out) break;
      out = next;
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  /**
   * One UI row per song name. Picks newest version from catalog among allowed playback ids.
   */
  function dedupeToOneRowPerSong(catalog, items, options) {
    const opts = options || {};
    const songFromItem = opts.songFromItem;
    const findItemByPlaybackId = opts.findItemByPlaybackId;
    const listSortMode = opts.listSortMode || 'az';

    const allowed = new Set();
    const itemByPlayback = new Map();
    (items || []).forEach(function (item) {
      if (!item || !item.playbackId) return;
      allowed.add(item.playbackId);
      itemByPlayback.set(item.playbackId, item);
    });

    if (!allowed.size) return [];

    const groupKeys = new Set();
    (catalog || []).forEach(function (song) {
      if (!song || !song.playbackId || !allowed.has(song.playbackId)) return;
      groupKeys.add(getTrackGroupKey(song.title));
    });
    (items || []).forEach(function (item) {
      if (!songFromItem) return;
      const song = songFromItem(item);
      if (song && song.title) groupKeys.add(getTrackGroupKey(song.title));
    });

    const rows = [];
    groupKeys.forEach(function (key) {
      if (!key) return;

      let versions = collectVersionsByGroupKey(catalog, key).filter(function (song) {
        return allowed.has(song.playbackId);
      });

      if (!versions.length && songFromItem) {
        const fallback = [];
        itemByPlayback.forEach(function (item) {
          const song = songFromItem(item);
          if (getTrackGroupKey(song.title) === key) fallback.push(song);
        });
        versions = fallback;
      }

      const newest = pickNewestSong(versions);
      if (!newest) return;

      const winner = findItemByPlaybackId
        ? findItemByPlaybackId(newest.playbackId)
        : itemByPlayback.get(newest.playbackId);
      if (!winner) return;

      rows.push({
        item: winner,
        song: newest,
        groupKey: key,
        displayTitle: titleFromCatalog(catalog, newest, newest.title),
        versionCount: versions.length
      });
    });

    rows.sort(function (a, b) {
      if (listSortMode === 'az') {
        return a.displayTitle.localeCompare(b.displayTitle, undefined, { sensitivity: 'base' });
      }
      const aDate = parseTrackDateValue(a.song);
      const bDate = parseTrackDateValue(b.song);
      if (aDate === bDate) {
        return a.displayTitle.localeCompare(b.displayTitle, undefined, { sensitivity: 'base' });
      }
      return listSortMode === 'oldest' ? aDate - bDate : bDate - aDate;
    });

    return rows;
  }

  function getTrackGroupKey(title) {
    // Normalize for grouping: drop date/version, lowercase, and fold all
    // punctuation/whitespace so "FIRE ESCAPE", "fire-escape", "fire  escape"
    // all collapse to the same song.
    return stripTrailingDate(title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function getSongHubHref(song, basePath) {
    if (!song || !song.title) return (basePath || '') + 'song.html';
    const prefix = basePath || '';
    return prefix + 'song.html?song=' + encodeURIComponent(getTrackGroupKey(song.title));
  }

  function getStreamSongHref(song, playbackId) {
    const key = song && song.title ? getTrackGroupKey(song.title) : '';
    if (key) return 'stream-song.html?song=' + encodeURIComponent(key);
    const id = playbackId || (song && song.playbackId) || '';
    return id ? 'stream-song.html?p=' + encodeURIComponent(id) : 'stream-song.html';
  }

  function compareSongsBySortMode(a, b, sortMode) {
    if (sortMode === 'az') {
      const base = stripTrailingDate(a.title).localeCompare(stripTrailingDate(b.title), undefined, {
        sensitivity: 'base'
      });
      if (base) return base;
      return String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
    }

    const aDate = parseTrackDateValue(a);
    const bDate = parseTrackDateValue(b);
    if (aDate === bDate) {
      return String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
    }
    return sortMode === 'oldest' ? aDate - bDate : bDate - aDate;
  }

  function getSiteCatalog(windowRef) {
    const win = windowRef || (typeof window !== 'undefined' ? window : null);
    if (!win || !Array.isArray(win.allSongs)) return [];
    return win.allSongs.slice();
  }

  function isGenericMuxTitle(title) {
    const mux = globalRef.BurnfolderMuxDisplayName;
    if (mux && mux.isGenericMuxLabel) return mux.isGenericMuxLabel(title);
    const t = String(title || '').trim();
    return !t || /^untitled/i.test(t);
  }

  /** Display title: mux upload name wins; site catalog is fallback. */
  function titleFromCatalog(catalog, songOrPlaybackId, muxFallback) {
    const id =
      songOrPlaybackId && typeof songOrPlaybackId === 'object'
        ? songOrPlaybackId.playbackId
        : String(songOrPlaybackId || '').trim();
    const muxLabel = normalizeTrackTitle(String(muxFallback || '').trim());
    const hit = (catalog || []).find(function (row) {
      return row && row.playbackId === id;
    });

    if (hit && hit.muxTitle && !isGenericMuxTitle(hit.muxTitle)) {
      return normalizeTrackTitle(hit.muxTitle);
    }
    if (muxLabel && !isGenericMuxTitle(muxLabel)) return muxLabel;
    if (hit && hit.title) return normalizeTrackTitle(hit.title);

    const fb =
      songOrPlaybackId && typeof songOrPlaybackId === 'object'
        ? songOrPlaybackId.title
        : muxFallback;
    return normalizeTrackTitle(fb || '');
  }

  function libraryItemToSong(item, title) {
    const label = normalizeTrackTitle(
      title || item.siteTitle || item.displayTitle || item.passthrough || 'untitled'
    );
    return {
      title: label,
      playbackId: item.playbackId,
      page: item.page || '',
      muxAssetId: item.muxAssetId || null,
      createdAt: item.createdAt || null,
      kind: item.kind || null,
      hasVideoTrack: item.hasVideoTrack
    };
  }

  /** Site catalog + mux rows; mux upload title is canonical display when present. */
  function mergeSongCatalog(siteSongs, muxItems, titleForItem) {
    const byId = new Map();
    const labelFn =
      titleForItem ||
      function (item) {
        const mux = globalRef.BurnfolderMuxDisplayName;
        if (mux && mux.preferredDisplayTitle) {
          return mux.preferredDisplayTitle(item);
        }
        return item.muxCanonicalTitle || item.passthrough || item.displayTitle || 'untitled';
      };

    (siteSongs || []).forEach(function (song) {
      if (!song || !song.playbackId) return;
      const title = normalizeTrackTitle(song.title);
      byId.set(
        song.playbackId,
        Object.assign({}, song, {
          title: title,
          siteTitle: title
        })
      );
    });

    (muxItems || []).forEach(function (item) {
      if (!item || !item.playbackId) return;
      const muxTitle = normalizeTrackTitle(labelFn(item));
      const existing = byId.get(item.playbackId);
      const displayTitle =
        muxTitle && !isGenericMuxTitle(muxTitle)
          ? muxTitle
          : existing
            ? existing.title
            : muxTitle;

      if (existing) {
        byId.set(
          item.playbackId,
          Object.assign({}, existing, {
            title: displayTitle,
            muxTitle: muxTitle,
            siteTitle: existing.siteTitle || existing.title,
            muxAssetId: item.muxAssetId || existing.muxAssetId,
            createdAt: item.createdAt || existing.createdAt,
            kind: item.kind != null ? item.kind : existing.kind,
            hasVideoTrack:
              item.hasVideoTrack != null ? item.hasVideoTrack : existing.hasVideoTrack
          })
        );
        return;
      }

      byId.set(
        item.playbackId,
        Object.assign(libraryItemToSong(item, displayTitle), {
          muxTitle: muxTitle,
          siteTitle: item.siteTitle || null
        })
      );
    });

    return Array.from(byId.values());
  }

  function collectVersionsByGroupKey(catalog, groupKey) {
    const key = String(groupKey || '').toLowerCase().trim();
    if (!key) return [];

    const byPlayback = new Map();
    (catalog || []).forEach(function (song) {
      if (!song || !song.playbackId || !song.title) return;
      if (getTrackGroupKey(song.title) !== key) return;
      byPlayback.set(song.playbackId, song);
    });

    return Array.from(byPlayback.values());
  }

  function sortVersions(versions, sortMode) {
    return (versions || []).slice().sort(function (a, b) {
      return compareSongsBySortMode(a, b, sortMode || 'newest');
    });
  }

  function getBaseTitle(versions) {
    if (!versions || !versions.length) return 'Song';
    return stripTrailingDate(versions[0].title) || versions[0].title || 'Song';
  }

  function getVersionsForReference(catalog, ref, sortMode) {
    if (!ref) return [];
    let groupKey = '';
    if (typeof ref === 'string') {
      groupKey = ref.toLowerCase().trim();
    } else if (ref.title) {
      groupKey = getTrackGroupKey(ref.title);
    } else if (ref.playbackId) {
      const match = (catalog || []).find(function (s) {
        return s.playbackId === ref.playbackId;
      });
      if (match && match.title) groupKey = getTrackGroupKey(match.title);
    }
    if (!groupKey) return [];
    return sortVersions(collectVersionsByGroupKey(catalog, groupKey), sortMode);
  }

  function resolvePlaybackInCatalog(catalog, playbackId) {
    if (!playbackId) return null;
    return (
      (catalog || []).find(function (s) {
        return s.playbackId === playbackId;
      }) || null
    );
  }

  function pickNewestSong(songs) {
    const sorted = sortVersions(songs, 'newest');
    return sorted.length ? sorted[0] : null;
  }

  /**
   * Collapse dated versions to one row per song name (newest wins).
   * listSortMode: 'az' (default, like music catalog) or 'newest' / 'oldest' by canonical date.
   */
  function dedupeLibraryItemsToNewest(items, titleForItem, listSortMode) {
    const labelFn =
      titleForItem ||
      function (item) {
        return item.siteTitle || item.displayTitle || item.passthrough || 'untitled';
      };
    const groups = new Map();

    (items || []).forEach(function (item) {
      if (!item || !item.playbackId) return;
      const song = libraryItemToSong(item, labelFn(item));
      const key = getTrackGroupKey(song.title);
      if (!key) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ item: item, song: song });
    });

    const rows = [];
    groups.forEach(function (entries, key) {
      const songs = entries.map(function (entry) {
        return entry.song;
      });
      const newest = pickNewestSong(songs);
      if (!newest) return;
      const winner = entries.find(function (entry) {
        return entry.song.playbackId === newest.playbackId;
      });
      if (!winner) return;
      rows.push({
        item: winner.item,
        song: newest,
        baseTitle: stripTrailingDate(newest.title),
        groupKey: key,
        versionCount: entries.length
      });
    });

    const mode = listSortMode || 'az';
    rows.sort(function (a, b) {
      if (mode === 'az') {
        return a.baseTitle.localeCompare(b.baseTitle, undefined, { sensitivity: 'base' });
      }
      const aDate = parseTrackDateValue(a.song);
      const bDate = parseTrackDateValue(b.song);
      if (aDate === bDate) {
        return a.baseTitle.localeCompare(b.baseTitle, undefined, { sensitivity: 'base' });
      }
      return mode === 'oldest' ? aDate - bDate : bDate - aDate;
    });

    return rows;
  }

  function resolveNewestSongInCatalog(catalog, ref, titleForItem) {
    const labelFn =
      titleForItem ||
      function (item) {
        return (
          (item && (item.title || item.siteTitle || item.displayTitle || item.passthrough)) ||
          'untitled'
        );
      };

    let seed = null;
    if (typeof ref === 'string') {
      seed = resolvePlaybackInCatalog(catalog, ref);
      if (!seed) {
        return pickNewestSong(collectVersionsByGroupKey(catalog, ref));
      }
    } else if (ref && ref.playbackId) {
      seed =
        resolvePlaybackInCatalog(catalog, ref.playbackId) ||
        libraryItemToSong(ref, labelFn(ref));
    } else if (ref && ref.title) {
      seed = ref;
    }

    if (!seed) return null;
    const versions = getVersionsForReference(catalog, seed, 'newest');
    return pickNewestSong(versions) || seed;
  }

  function displayTitleForSong(song) {
    if (!song) return '';
    return normalizeTrackTitle(song.title) || '';
  }

  function displayTitleForSongInCatalog(catalog, song) {
    if (!song) return '';
    return titleFromCatalog(catalog, song, song.title);
  }

  /** Per song-name selection; click title to cycle versions (newest-first order). */
  function createVersionCycle(catalog) {
    const selectedByGroup = new Map();

    function versionsForSong(song) {
      return getVersionsForReference(catalog, song, 'newest');
    }

    function groupKeyFor(song) {
      const versions = versionsForSong(song);
      if (!versions.length) return getTrackGroupKey(song && song.title);
      return getTrackGroupKey(versions[0].title);
    }

    function getSelected(song) {
      const versions = versionsForSong(song);
      if (!versions.length) return song;

      const explicitId = song && song.playbackId ? String(song.playbackId).trim() : '';
      if (explicitId) {
        const pinned = versions.find(function (v) {
          return v.playbackId === explicitId;
        });
        if (pinned) return pinned;
        if (song.title) return song;
      }

      const key = groupKeyFor(song);
      const id = selectedByGroup.get(key);
      if (!id) return versions[0];
      return versions.find(function (v) {
        return v.playbackId === id;
      }) || versions[0];
    }

    function cycle(song) {
      const versions = versionsForSong(song);
      if (versions.length <= 1) return getSelected(song);
      const key = groupKeyFor(song);
      const current = getSelected(song);
      const idx = versions.findIndex(function (v) {
        return v.playbackId === current.playbackId;
      });
      const next = versions[(idx + 1) % versions.length];
      selectedByGroup.set(key, next.playbackId);
      return next;
    }

    function labelFor(song) {
      const selected = getSelected(song);
      return displayTitleForSongInCatalog(catalog, selected);
    }

    function hasMultiple(song) {
      return versionsForSong(song).length > 1;
    }

    return {
      getSelected: getSelected,
      cycle: cycle,
      labelFor: labelFor,
      hasMultiple: hasMultiple,
      versionsFor: versionsForSong
    };
  }

  /**
   * Group library rows by song name. Groups and singles sort A–Z by base title;
   * multiple versions within a group sort by embedded date (newest first by default).
   */
  function organizeLibraryItemsBySong(items, options) {
    const opts = options || {};
    const labelFn =
      opts.labelForItem ||
      function (item) {
        return item.displayTitle || item.passthrough || 'untitled';
      };
    const versionSort = opts.versionSort || 'newest';

    const groups = new Map();
    const noKey = [];

    (items || []).forEach(function (item) {
      if (!item) return;
      const song = libraryItemToSong(item, labelFn(item));
      const key = getTrackGroupKey(song.title);
      if (!key) {
        noKey.push(item);
        return;
      }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ item: item, song: song });
    });

    const rows = [];

    noKey.forEach(function (item) {
      rows.push({
        type: 'single',
        baseTitle: labelFn(item),
        items: [item]
      });
    });

    groups.forEach(function (entries) {
      entries.sort(function (a, b) {
        return compareSongsBySortMode(a.song, b.song, versionSort);
      });
      const baseTitle = stripTrailingDate(entries[0].song.title) || labelFn(entries[0].item);
      if (entries.length === 1) {
        rows.push({ type: 'single', baseTitle: baseTitle, items: [entries[0].item] });
        return;
      }
      rows.push({
        type: 'group',
        baseTitle: baseTitle,
        items: entries.map(function (entry) {
          return entry.item;
        })
      });
    });

    rows.sort(function (a, b) {
      return a.baseTitle.localeCompare(b.baseTitle, undefined, { sensitivity: 'base' });
    });

    return rows;
  }

  function fillVersionTracklist(container, versions, options) {
    const opts = options || {};
    if (!container) return;

    container.innerHTML = '';
    const list = document.createElement('ol');
    list.className = 'music-tracklist';

    (versions || []).forEach(function (song, index) {
      if (!song || !song.playbackId) return;

      const item = document.createElement('li');
      item.className = 'music-tracklist-item';

      const num = document.createElement('span');
      num.className = 'music-track-num';
      num.textContent = String(index + 1);

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'music-track-row';
      row.dataset.playbackId = song.playbackId;
      const label = opts.displayTitle != null ? opts.displayTitle : song.title;
      row.setAttribute('aria-label', 'Play ' + label);

      if (opts.activePlaybackId && opts.activePlaybackId === song.playbackId) {
        row.classList.add('is-active');
      }

      const name = document.createElement('span');
      name.className = 'music-track-title';
      name.textContent = label;

      const dur = document.createElement('span');
      dur.className = 'music-track-duration';
      dur.textContent = opts.durationFor && opts.durationFor[song.playbackId]
        ? opts.durationFor[song.playbackId]
        : '--:--';

      row.appendChild(name);
      row.appendChild(dur);
      row.addEventListener('click', function () {
        if (typeof opts.onSelect === 'function') opts.onSelect(song);
      });

      item.appendChild(num);
      item.appendChild(row);
      list.appendChild(item);
    });

    container.appendChild(list);
  }

  return {
    extractDateFromText: extractDateFromText,
    getTrackDateLabel: getTrackDateLabel,
    parseTrackDateValue: parseTrackDateValue,
    normalizeTrackTitle: normalizeTrackTitle,
    isGenericMuxTitle: isGenericMuxTitle,
    titleFromCatalog: titleFromCatalog,
    stripTrailingDate: stripTrailingDate,
    getTrackGroupKey: getTrackGroupKey,
    getSongHubHref: getSongHubHref,
    getStreamSongHref: getStreamSongHref,
    compareSongsBySortMode: compareSongsBySortMode,
    getSiteCatalog: getSiteCatalog,
    libraryItemToSong: libraryItemToSong,
    mergeSongCatalog: mergeSongCatalog,
    collectVersionsByGroupKey: collectVersionsByGroupKey,
    sortVersions: sortVersions,
    getBaseTitle: getBaseTitle,
    getVersionsForReference: getVersionsForReference,
    resolvePlaybackInCatalog: resolvePlaybackInCatalog,
    pickNewestSong: pickNewestSong,
    dedupeLibraryItemsToNewest: dedupeLibraryItemsToNewest,
    dedupeToOneRowPerSong: dedupeToOneRowPerSong,
    organizeLibraryItemsBySong: organizeLibraryItemsBySong,
    resolveNewestSongInCatalog: resolveNewestSongInCatalog,
    displayTitleForSong: displayTitleForSong,
    displayTitleForSongInCatalog: displayTitleForSongInCatalog,
    createVersionCycle: createVersionCycle,
    fillVersionTracklist: fillVersionTracklist
  };
});
