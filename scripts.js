// --- Spotify-like Streaming Service Audio Logic ---
// Load allSongs from songs.js (must be included in HTML before scripts.js)
let allSongs = window.allSongs || [];

// Determine which songs to show on this page
const pathParts = window.location.pathname.split('/');
const fileName = pathParts[pathParts.length - 1].replace('.html', '') || 'index';
const noAudioChromePages = new Set(['index', 'shop', 'cart', 'checkout', 'cancel', 'success']);
window.currentSongs = noAudioChromePages.has(fileName) ? [] : allSongs;

// Dated entry pages: pull directly from the keyed catalog — no string matching needed
if (fileName.match(/^\d+\.\d+\.\d+$/) && window.songsByPage) {
  window.currentSongs = window.songsByPage[fileName] || [];
}

const audioList = document.getElementById('audioList');
const progressEl = document.getElementById('progress');
const bottomBar = document.getElementById('bottomBar');
const progressBarArea = document.getElementById('progressBarArea');
const bottomPlayBtn = document.getElementById('bottomPlayPause');
const songTitleEl = document.getElementById('songTitle');
const closeBtn = document.getElementById('closeBtn');
const loadingSpinner = document.getElementById('loadingSpinner');
const activeMuxPlayer = document.getElementById('activeMuxPlayer');

function isCoarsePointer() {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  );
}

// Never move focus to the fixed bottom bar on touch: iOS scrolls the page to a
// focused fixed element even with preventScroll, which reads as the page "jumping"
// when you tap a song. Space-to-toggle works via the document keydown handler, so
// keyboard users lose nothing. Only fine-pointer (desktop) gets a focus ring.
function focusPlayControl() {
  if (!bottomPlayBtn || typeof bottomPlayBtn.focus !== 'function') return;
  if (isCoarsePointer()) return;
  try {
    bottomPlayBtn.focus({ preventScroll: true });
  } catch (_) {
    /* ignore */
  }
}
// Single shared now-playing bar instance (shared/now-playing-bar.js). Owns play button,
// title menu/version picker, progress + drag/hover seek, spinner. See COPILOT.md.
let nowPlayingBar = null;
let siteMuxPlayback = null;
let stripeClient = null;
let checkoutElements = null;
let checkoutCard = null;
let checkoutPaymentRequest = null;
let checkoutPaymentRequestButton = null;
let checkoutMode = 'cart';
let checkoutTipAmount = 1;

function formatTipAmount(amount) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) return '1';
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2).replace(/\.00$/, '');
}

function parseCustomTipAmount(rawValue) {
  const normalized = String(rawValue || '').replace(/[^0-9.]/g, '');
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  const rounded = Math.round(amount * 100) / 100;
  if (rounded < 1 || rounded > 500) return null;
  return rounded;
}

// Progress hover-time + seek logic now lives in shared/now-playing-bar.js (single source).

function ensureStripeClient() {
  const pk = window.STRIPE_PUBLISHABLE_KEY;
  if (window.Stripe && pk && !stripeClient) {
    stripeClient = window.Stripe(pk);
  }
}

function loadStripeScript() {
  return new Promise((resolve, reject) => {
    if (window.Stripe) {
      ensureStripeClient();
      resolve();
      return;
    }

    let script = document.querySelector('script[data-stripe-js="true"]');
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://js.stripe.com/v3/';
      script.async = true;
      script.dataset.stripeJs = 'true';
      document.head.appendChild(script);
    }

    script.addEventListener('load', () => {
      ensureStripeClient();
      resolve();
    }, { once: true });

    script.addEventListener('error', () => {
      reject(new Error('Failed to load Stripe.'));
    }, { once: true });
  });
}

function createTipUI() {
  if (!bottomPlayBtn) return;
  if (document.getElementById('tipToggleBtn')) return;

  const controls = document.querySelector('.bottom-bar-controls');
  if (!controls) return;

  const wrap = document.createElement('div');
  wrap.className = 'bottom-tip-wrap';

  const tipBtn = document.createElement('button');
  tipBtn.type = 'button';
  tipBtn.className = 'icon-btn now-playing-tip-btn';
  tipBtn.id = 'tipToggleBtn';
  tipBtn.setAttribute('aria-expanded', 'false');
  tipBtn.textContent = 'Tip';

  const menu = document.createElement('div');
  menu.className = 'tip-options';
  menu.id = 'tipOptions';

  [1, 3].forEach(amount => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'icon-btn tip-option-btn';
    option.textContent = `$${amount}`;
    option.addEventListener('click', () => {
      const customPanel = document.getElementById('tipCustomPanel');
      if (customPanel) customPanel.classList.remove('open');
      menu.classList.remove('open');
      tipBtn.setAttribute('aria-expanded', 'false');
      openCheckoutPopup('tip', amount);
    });
    menu.appendChild(option);
  });

  const customBtn = document.createElement('button');
  customBtn.type = 'button';
  customBtn.className = 'icon-btn tip-option-btn';
  customBtn.id = 'tipCustomToggle';
  customBtn.textContent = '+';

  const customPanel = document.createElement('div');
  customPanel.className = 'tip-custom-panel';
  customPanel.id = 'tipCustomPanel';
  customPanel.innerHTML = `
    <label class="tip-custom-label" for="tipCustomAmount">Custom $</label>
    <div class="tip-custom-row">
      <input id="tipCustomAmount" class="tip-custom-input" type="number" inputmode="decimal" min="1" max="500" step="0.01" placeholder="5" aria-label="Custom tip amount">
      <button type="button" class="icon-btn tip-custom-go" id="tipCustomGo">Go</button>
    </div>
  `;

  const closeCustomPanel = () => {
    customPanel.classList.remove('open');
  };

  const submitCustomAmount = () => {
    const input = customPanel.querySelector('#tipCustomAmount');
    if (!input) return;
    const parsed = parseCustomTipAmount(input.value);

    if (!parsed) {
      input.focus();
      input.select();
      return;
    }

    input.value = '';
    closeCustomPanel();
    menu.classList.remove('open');
    tipBtn.setAttribute('aria-expanded', 'false');
    openCheckoutPopup('tip', parsed);
  };

  customBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = !customPanel.classList.contains('open');
    customPanel.classList.toggle('open', opening);
    if (opening) {
      const input = customPanel.querySelector('#tipCustomAmount');
      if (input) {
        input.value = '';
        input.focus();
      }
    }
  });

  customPanel.querySelector('#tipCustomGo').addEventListener('click', submitCustomAmount);
  customPanel.querySelector('#tipCustomAmount').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitCustomAmount();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeCustomPanel();
    }
  });

  menu.appendChild(customBtn);
  menu.appendChild(customPanel);

  tipBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = menu.classList.toggle('open');
    tipBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });

  wrap.appendChild(tipBtn);
  wrap.appendChild(menu);
  // progress-bar-area is a sibling of .bottom-bar-controls (not nested) since 20260708a.
  controls.appendChild(wrap);

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) {
      closeCustomPanel();
      menu.classList.remove('open');
      tipBtn.setAttribute('aria-expanded', 'false');
    }
  });
}

function songVersionsApi() {
  return typeof window !== 'undefined' ? window.BurnfolderSongVersions : null;
}

function extractDateFromText(text) {
  const sv = songVersionsApi();
  if (sv) return sv.extractDateFromText(text);
  const match = String(text || '').match(/(?:\(|\s)(\d{1,2}\.\d{1,2}\.\d{2})(?:\)|\s|$)/);
  return match ? match[1] : null;
}

function getTrackDateLabel(song) {
  const sv = songVersionsApi();
  if (sv) return sv.getTrackDateLabel(song);
  const fromTitle = extractDateFromText(song && song.title);
  if (fromTitle) return fromTitle;
  if (song && /^\d+\.\d+\.\d+$/.test(song.page || '')) return song.page;
  return '';
}

function parseTrackDateValue(song) {
  const sv = songVersionsApi();
  if (sv) return sv.parseTrackDateValue(song);
  const label = getTrackDateLabel(song);
  if (!label) return -Infinity;
  const [monthRaw, dayRaw, yearRaw] = label.split('.').map(Number);
  if (![monthRaw, dayRaw, yearRaw].every(Number.isFinite)) return -Infinity;
  const year = 2000 + yearRaw;
  return new Date(year, monthRaw - 1, dayRaw).getTime();
}

function stripTrailingDate(title) {
  const sv = songVersionsApi();
  if (sv) return sv.stripTrailingDate(title);
  return String(title || '')
    .replace(/\s+v\d+\s*$/i, '')
    .replace(/\s*\(\d{1,2}\.\d{1,2}\.\d{2}\)\s*$/i, '')
    .replace(/\s+\d{1,2}\.\d{1,2}\.\d{2}\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Singles keep the dated title; album track rows drop the trailing date. */
function getTracklistDisplayTitle(song, options = {}) {
  if (!song || !song.title) return '';
  const inAlbum = options.inAlbum === true || !!song.album;
  return inAlbum ? stripTrailingDate(song.title) : song.title;
}

window.getTracklistDisplayTitle = getTracklistDisplayTitle;

function getTrackGroupKey(title) {
  const sv = songVersionsApi();
  if (sv) return sv.getTrackGroupKey(title);
  return stripTrailingDate(title).toLowerCase();
}

function getSongHubHref(song) {
  const ctx = window.BurnfolderPlaybackContext;
  if (ctx && ctx.songHubHref) return ctx.songHubHref(song);
  const sv = songVersionsApi();
  if (sv) return sv.getSongHubHref(song);
  if (!song || !song.title) return 'song.html';
  return `song.html?song=${encodeURIComponent(getTrackGroupKey(song.title))}`;
}

function compareSongsBySortMode(a, b, sortMode) {
  const sv = songVersionsApi();
  if (sv) return sv.compareSongsBySortMode(a, b, sortMode);
  if (sortMode === 'az') {
    const base = stripTrailingDate(a.title).localeCompare(stripTrailingDate(b.title), undefined, {
      sensitivity: 'base',
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

function getAlbumPlaybackIdsFromEntries() {
  const ids = new Set();
  const byDate = window.entryDataByDate;
  if (!byDate || typeof byDate !== 'object') return ids;

  Object.values(byDate).forEach((entry) => {
    const blocks = entry && Array.isArray(entry.blocks) ? entry.blocks : [];
    blocks.forEach((block) => {
      if (!block || block.type !== 'album' || !Array.isArray(block.tracks)) return;
      block.tracks.forEach((track) => {
        if (track && track.playbackId) ids.add(track.playbackId);
      });
    });
  });
  return ids;
}

function resolveSongFromCatalog(playbackId, title) {
  const all = Array.isArray(window.allSongs) ? window.allSongs : [];
  const match = all.find((song) => song && song.playbackId === playbackId);
  if (match) return match;
  if (!playbackId) return null;
  return { title: title || 'Track', playbackId, page: '' };
}

/** Music page album slots: newest catalog version per song name; entry pages keep frozen album data. */
function resolveNewestVersionForAlbumSlot(track, albumTitle, entryDate, albumCoverArt) {
  if (!track || !track.playbackId) return null;

  const allSongs = Array.isArray(window.allSongs) ? window.allSongs : [];
  const groupKey = getTrackGroupKey(track.title);
  const candidates = allSongs.filter(
    (song) => song && song.playbackId && getTrackGroupKey(song.title) === groupKey
  );

  if (!candidates.length) {
    const fallback = resolveSongFromCatalog(track.playbackId, track.title);
    if (!fallback) return null;
    return {
      ...fallback,
      page: entryDate,
      album: albumTitle || undefined,
      coverArt: fallback.coverArt || albumCoverArt || ''
    };
  }

  const newest = [...candidates].sort((a, b) => compareSongsBySortMode(a, b, 'newest'))[0];
  return {
    ...newest,
    page: newest.page || entryDate,
    album: albumTitle || undefined,
    coverArt: newest.coverArt || albumCoverArt || ''
  };
}

function buildMusicFamilies(sortMode) {
  const albumPlaybackIds = getAlbumPlaybackIdsFromEntries();
  const allSongs = Array.isArray(window.allSongs) ? window.allSongs : [];
  const families = new Map();

  allSongs.forEach((song) => {
    if (!song || !song.playbackId) return;
    if (albumPlaybackIds.has(song.playbackId)) return;
    if (song.album) return;

    const key = getTrackGroupKey(song.title);
    if (!families.has(key)) families.set(key, []);
    const list = families.get(key);
    if (!list.some((item) => item.playbackId === song.playbackId)) list.push(song);
  });

  return Array.from(families.entries())
    .map(([key, versions]) => {
      const sorted = [...versions].sort((a, b) => compareSongsBySortMode(a, b, sortMode));
      const canonical = sorted[0];
      return {
        key,
        baseTitle: stripTrailingDate(canonical.title),
        versions: sorted,
        canonical,
        versionCount: sorted.length,
        sortDate: parseTrackDateValue(canonical),
      };
    })
    .sort((a, b) => {
      if (sortMode === 'az') {
        return a.baseTitle.localeCompare(b.baseTitle, undefined, { sensitivity: 'base' });
      }
      if (a.sortDate === b.sortDate) {
        return a.baseTitle.localeCompare(b.baseTitle, undefined, { sensitivity: 'base' });
      }
      return sortMode === 'oldest' ? a.sortDate - b.sortDate : b.sortDate - a.sortDate;
    });
}

function buildMusicAlbums(sortMode) {
  const byDate = window.entryDataByDate;
  if (!byDate || typeof byDate !== 'object') return [];

  const albums = [];
  const order = Array.isArray(window.entryOrder) ? window.entryOrder : Object.keys(byDate);

  order.forEach((dateKey) => {
    const entry = byDate[dateKey];
    if (!entry || !Array.isArray(entry.blocks)) return;

    entry.blocks.forEach((block) => {
      if (!block || block.type !== 'album') return;
      const tracks = (block.tracks || [])
        .map((track) => resolveSongFromCatalog(track.playbackId, track.title))
        .filter(Boolean);

      albums.push({
        title: block.title || 'Album',
        coverArt: block.coverArt || '',
        coverAlt: block.coverAlt || block.title || 'Album cover',
        entryDate: dateKey,
        tracks: tracks.map(function (track) {
          return Object.assign({}, track, {
            coverArt: track.coverArt || block.coverArt || ''
          });
        }),
        sortDate: parseTrackDateValue({ page: dateKey, title: dateKey }),
      });
    });
  });

  return albums.sort((a, b) => {
    if (sortMode === 'az') {
      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    }
    if (a.sortDate === b.sortDate) {
      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    }
    return sortMode === 'oldest' ? a.sortDate - b.sortDate : b.sortDate - a.sortDate;
  });
}

function preloadSongDuration(titleSpan, playbackId) {
  const durSpan = titleSpan.querySelector('.song-duration');
  if (!durSpan || !playbackId) return;

  const tmp = document.createElement('mux-player');
  tmp.setAttribute('playback-id', playbackId);
  tmp.style.display = 'none';
  tmp.muted = true;
  document.body.appendChild(tmp);
  tmp.addEventListener(
    'loadedmetadata',
    () => {
      const d = tmp.duration;
      if (d && !isNaN(d)) {
        const m = Math.floor(d / 60);
        const s = Math.floor(d % 60);
        durSpan.textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
      }
      tmp.remove();
    },
    { once: true }
  );
}

function getFeaturedMusicRelease() {
  const byDate = window.entryDataByDate;
  if (!byDate || typeof byDate !== 'object') return null;

  const featured = window.musicFeaturedRelease || {};
  const order = Array.isArray(window.entryOrder) ? window.entryOrder : Object.keys(byDate);
  const dates =
    featured.entryDate && byDate[featured.entryDate] ? [featured.entryDate] : order;

  for (const dateKey of dates) {
    const entry = byDate[dateKey];
    if (!entry || !Array.isArray(entry.blocks)) continue;

    for (const block of entry.blocks) {
      if (!block || block.type !== 'album') continue;
      if (featured.albumTitle && block.title !== featured.albumTitle) continue;

      const useLatestVersions = featured.useLatestVersions !== false;
      const tracks = (block.tracks || [])
        .map((track) => {
          if (useLatestVersions) {
            return resolveNewestVersionForAlbumSlot(track, block.title || '', dateKey, block.coverArt || '');
          }
          const song = resolveSongFromCatalog(track.playbackId, track.title);
          if (!song) return null;
          return { ...song, page: dateKey, album: block.title || undefined };
        })
        .filter(Boolean);

      return {
        title: block.title || 'Album',
        coverArt: block.coverArt || '',
        coverAlt: block.coverAlt || block.title || 'Album cover',
        entryDate: dateKey,
        tracks: tracks.map(function (track) {
          return Object.assign({}, track, {
            coverArt: track.coverArt || block.coverArt || ''
          });
        }),
      };
    }
  }

  return null;
}

function playReleaseQueue(tracks, startIndex = 0) {
  const queue = (tracks || []).filter((track) => track && track.playbackId);
  if (!queue.length) return;

  window.currentSongs = queue.slice();
  activeQueue = queue.slice();
  activeQueueIdx = startIndex;
  activeSongOverride = queue[startIndex];
  activeIdx = startIndex;
  startPlayback(queue[startIndex], activeQueue, startIndex);
  syncTracklistPlayback();
}

function preloadTrackDuration(durEl, playbackId, knownSeconds) {
  const pf = window.BurnfolderPlaybackPrefetch;
  if (pf) {
    pf.requestDuration(durEl, playbackId, knownSeconds);
    return;
  }
  if (!durEl || !playbackId) return;
  durEl.textContent = '--:--';
}

let siteVersionCycle = null;

function getSiteVersionCycle() {
  const sv = songVersionsApi();
  if (!sv) return null;
  if (!siteVersionCycle) {
    siteVersionCycle = sv.createVersionCycle(
      Array.isArray(window.allSongs) ? window.allSongs : []
    );
  }
  return siteVersionCycle;
}

function buildTracklistItem(song, trackNum, onPlay, displayTitle, options) {
  const opts = options || {};
  const freezePlayback = opts.freezePlayback === true;
  const item = document.createElement('li');
  item.className = 'music-tracklist-item';

  const cycle = freezePlayback ? null : getSiteVersionCycle();
  const selected = cycle ? cycle.getSelected(song) : song;
  const canCycle = !freezePlayback && cycle ? cycle.hasMultiple(song) : false;

  const num = document.createElement('span');
  num.className = 'music-track-num';
  num.textContent = String(trackNum);

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'music-track-row';

  const name = document.createElement('span');
  name.className = 'music-track-title' + (canCycle ? ' is-version-cycle' : '');

  const dur = document.createElement('span');
  dur.className = 'music-track-duration';
  dur.textContent = '--:--';

  function syncRow() {
    const current = freezePlayback ? song : cycle ? cycle.getSelected(song) : song;
    const label = freezePlayback
      ? displayTitle != null
        ? songVersionsApi()
          ? songVersionsApi().normalizeTrackTitle(displayTitle)
          : displayTitle
        : songVersionsApi()
          ? songVersionsApi().normalizeTrackTitle(song.title)
          : song.title
      : cycle
        ? cycle.labelFor(song)
        : displayTitle != null
          ? songVersionsApi()
            ? songVersionsApi().normalizeTrackTitle(displayTitle)
            : displayTitle
          : songVersionsApi()
            ? songVersionsApi().normalizeTrackTitle(song.title)
            : song.title;
    row.dataset.playbackId = current.playbackId;
    row.setAttribute('aria-label', 'Play ' + label);
    name.textContent = label;
    if (!dur.dataset.loaded) {
      preloadTrackDuration(dur, current.playbackId);
      dur.dataset.loaded = '1';
    }
  }

  syncRow();

  const pf = window.BurnfolderPlaybackPrefetch;
  if (pf) {
    pf.attachRow(row, function () {
      const current = freezePlayback ? song : cycle ? cycle.getSelected(song) : song;
      return current && current.playbackId;
    });
  }

  function activateTrackRow(e) {
    if (e.target.closest('.is-version-cycle')) return;
    const toPlay = cycle ? cycle.getSelected(song) : song;
    if (typeof onPlay === 'function') onPlay(toPlay, song);
  }

  const rowTap = window.BurnfolderTouchTap || window.BurnfolderStudioTap;
  // The version-cycle title is its own tap target inside the row; let it own
  // taps so the row's play handler does not swallow the cycle gesture on touch.
  const skipCycleTaps = function (e) {
    return !!(e.target && e.target.closest && e.target.closest('.is-version-cycle'));
  };
  if (rowTap && rowTap.bind) {
    rowTap.bind(row, activateTrackRow, { shouldSkip: skipCycleTaps });
  } else {
    row.addEventListener('click', activateTrackRow);
  }

  if (canCycle) {
    name.setAttribute('role', 'button');
    name.setAttribute('tabindex', '0');
    name.setAttribute('aria-label', 'Toggle version');
    const onCycle = (e) => {
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      cycle.cycle(song);
      delete dur.dataset.loaded;
      dur.textContent = '--:--';
      syncRow();
      playTrackBySong(cycle.getSelected(song));
      if (typeof syncTracklistPlayback === 'function') syncTracklistPlayback();
    };
    if (rowTap && rowTap.bind) {
      rowTap.bind(name, onCycle);
    } else {
      name.addEventListener('click', onCycle);
    }
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') onCycle(e);
    });
  }

  row.appendChild(name);
  row.appendChild(dur);

  item.appendChild(num);
  item.appendChild(row);
  return item;
}

function fillTracklistContainer(container, entries, options) {
  if (!container) return;
  container.innerHTML = '';

  const list = document.createElement('ol');
  list.className = 'music-tracklist';

  (entries || []).forEach((entry, index) => {
    if (!entry || !entry.song) return;
    list.appendChild(
      buildTracklistItem(entry.song, index + 1, entry.onPlay, entry.displayTitle, options)
    );
  });

  container.appendChild(list);

  const pf = window.BurnfolderPlaybackPrefetch;
  if (pf && entries && entries.length) {
    pf.prefetchList(
      entries.map(function (entry) {
        return entry && entry.song && entry.song.playbackId;
      }),
      6
    );
  }
}

window.buildTracklistItem = buildTracklistItem;
window.playTrackBySong = playTrackBySong;
window.fillTracklistContainer = fillTracklistContainer;

function syncTracklistPlayback() {
  const activeSong = getActiveSong();
  document.querySelectorAll('.music-track-row').forEach((row) => {
    const isActive = !!(activeSong && row.dataset.playbackId === activeSong.playbackId);
    const playing = isActive && activeMuxPlayer && !activeMuxPlayer.paused;
    row.classList.toggle('is-active', isActive);
    row.classList.toggle('is-playing', playing);
  });

  const playBtn = document.getElementById('musicPortfolioPlay');
  if (playBtn && activeSong) {
    const portfolio = document.getElementById('musicPortfolio');
    if (portfolio && portfolio.contains(playBtn)) {
      const onThisRelease = Array.from(portfolio.querySelectorAll('.music-track-row')).some(
        (row) => row.dataset.playbackId === activeSong.playbackId
      );
      if (onThisRelease) {
        const playing = !activeMuxPlayer.paused;
        playBtn.classList.toggle('is-playing', playing);
        playBtn.setAttribute('aria-label', playing ? 'Pause album' : 'Play album');
      }
    }
  }

  syncSongHubPlayButton();
  syncAlbumHubPlayButton();
}

function syncSongHubPlayButton() {
  const hubPlayBtn = document.getElementById('songHubPlay');
  if (!hubPlayBtn) return;

  const hubRoot = document.getElementById('songHubPage') || document.getElementById('songMain');
  if (!hubRoot) return;

  const rows = hubRoot.querySelectorAll('.music-track-row');
  if (!rows.length) {
    hubPlayBtn.hidden = true;
    return;
  }

  hubPlayBtn.hidden = false;
  const activeSong = getActiveSong();
  const onThisSong =
    activeSong &&
    Array.from(rows).some((row) => row.dataset.playbackId === activeSong.playbackId);
  const playing = !!(onThisSong && activeMuxPlayer && !activeMuxPlayer.paused);
  hubPlayBtn.classList.toggle('is-playing', playing);
  hubPlayBtn.setAttribute('aria-label', playing ? 'Pause song' : 'Play song');
}

function playSongHubQueue(sorted, song, hubRoot, page, renderApi) {
  if (!sorted || !sorted.length || !song || !song.playbackId) return;

  if (renderApi && page && hubRoot) {
    renderApi.selectVersion(hubRoot, page, song.playbackId);
  }

  window.currentSongs = sorted.slice();

  const idx = sorted.findIndex((item) => item.playbackId === song.playbackId);
  const active = getActiveSong();
  const onHub = active && sorted.some((item) => item.playbackId === active.playbackId);

  if (onHub && active.playbackId === song.playbackId) {
    if (activeMuxPlayer && !activeMuxPlayer.paused) {
      togglePlayPause();
    } else if (activeMuxPlayer) {
      activeMuxPlayer.play().catch(() => {});
      updateUI();
    }
    syncTracklistPlayback();
    return;
  }

  startPlayback(song, sorted, idx >= 0 ? idx : 0);
}

window.syncTracklistPlayback = syncTracklistPlayback;

function renderMusicPage() {
  if (!document.body.classList.contains('page-music')) return;

  const root = document.getElementById('musicPortfolio');
  if (!root) return;

  const release = getFeaturedMusicRelease();
  root.innerHTML = '';

  if (!release || !release.tracks.length) {
    root.innerHTML = '<p class="music-portfolio-empty">No release yet.</p>';
    return;
  }

  window.currentSongs = release.tracks.slice();
  document.title = `${release.title} — burnfolder.com`;

  const article = document.createElement('article');
  article.className = 'music-release';

  const hero = document.createElement('div');
  hero.className = 'music-release-hero';

  if (release.coverArt) {
    const cover = document.createElement('img');
    cover.className = 'music-release-cover';
    cover.src = release.coverArt;
    cover.alt = release.coverAlt;
    hero.appendChild(cover);
  }

  const meta = document.createElement('div');
  meta.className = 'music-release-meta';

  const type = document.createElement('p');
  type.className = 'music-release-type';
  type.textContent = 'Album';

  const title = document.createElement('h1');
  title.className = 'music-release-title';
  title.textContent = release.title;

  const artist = document.createElement('p');
  artist.className = 'music-release-artist';
  artist.textContent = 'burnfolder';

  const actions = document.createElement('div');
  actions.className = 'music-release-actions';

  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'music-release-play';
  playBtn.id = 'musicPortfolioPlay';
  playBtn.setAttribute('aria-label', 'Play album');
  playBtn.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><polygon points="8,5 20,12 8,19" fill="currentColor"/></svg>';

  playBtn.addEventListener('click', () => {
    const activeSong = getActiveSong();
    const onRelease =
      activeSong && release.tracks.some((t) => t.playbackId === activeSong.playbackId);
    if (onRelease && !activeMuxPlayer.paused) {
      activeMuxPlayer.pause();
      updateUI();
      syncTracklistPlayback();
      return;
    }
    if (onRelease && activeMuxPlayer.paused) {
      activeMuxPlayer.play();
      updateUI();
      syncTracklistPlayback();
      return;
    }
    playReleaseQueue(release.tracks, 0);
  });

  actions.appendChild(playBtn);
  meta.appendChild(type);
  meta.appendChild(title);
  meta.appendChild(artist);
  meta.appendChild(actions);
  hero.appendChild(meta);
  article.appendChild(hero);

  const tracklistHost = document.createElement('div');
  fillTracklistContainer(
    tracklistHost,
    release.tracks.map((song, index) => ({
      song,
      displayTitle: getTracklistDisplayTitle(song, { inAlbum: true }),
      onPlay: (toPlay) => playTrackBySong(toPlay || song),
    }))
  );
  article.appendChild(tracklistHost.firstChild);

  const entryLink = document.createElement('a');
  entryLink.className = 'music-release-journal';
  entryLink.href = `${release.entryDate}.html`;
  entryLink.textContent = release.entryDate;
  article.appendChild(entryLink);

  const albumLink = document.createElement('a');
  albumLink.className = 'music-release-journal music-release-album';
  albumLink.href = 'album.html?album=photonegative';
  albumLink.textContent = 'album hub';
  article.appendChild(albumLink);

  root.appendChild(article);
  syncTracklistPlayback();

  const legacyList = document.getElementById('audioList');
  if (legacyList) legacyList.innerHTML = '';
}

window.renderMusicPage = renderMusicPage;

/** Journal entry page for this recording (`M.DD.YY.html`), if applicable. */
function getEntryPageHref(song) {
  const ctx = window.BurnfolderPlaybackContext;
  if (ctx && ctx.entryHref) return ctx.entryHref(song);
  if (!song) return '';
  let p = song.page != null ? String(song.page).trim() : '';
  if (!p || !/^\d+\.\d+\.\d+$/.test(p)) {
    const pathParts = window.location.pathname.split('/');
    const fn = pathParts[pathParts.length - 1].replace('.html', '');
    if (/^\d+\.\d+\.\d+$/.test(fn)) p = fn;
  }
  if (!/^\d+\.\d+\.\d+$/.test(p)) return '';
  return `${p}.html`;
}

function playTrackBySong(song) {
  if (!song || !song.playbackId) return;

  const queue = Array.isArray(window.currentSongs) ? window.currentSongs : [];
  let idx = queue.findIndex((item) => item.playbackId === song.playbackId);
  if (idx === -1) {
    const key = getTrackGroupKey(song.title);
    if (key) {
      idx = queue.findIndex((item) => getTrackGroupKey(item.title) === key);
    }
  }
  if (idx !== -1) {
    // Play the tapped version but keep the full page queue for album advance.
    startPlayback(song, queue, idx);
    syncSongHubVersionSelection(song);
    return;
  }

  startPlayback(song, [song], 0);
  syncSongHubVersionSelection(song);
}

let songHubContext = null;

function syncSongHubVersionSelection(song) {
  if (!song || !song.playbackId || !songHubContext) return;
  const songKey = getTrackGroupKey(song.title);
  if (!songKey || songKey !== songHubContext.groupKey) return;
  const renderApi = window.BurnfolderSongPageRender;
  if (!renderApi || !songHubContext.hubRoot || !songHubContext.page) return;
  renderApi.selectVersion(songHubContext.hubRoot, songHubContext.page, song.playbackId);
}

function renderSongHubPage() {
  const hubRoot = document.getElementById('songHubPage');
  if (!hubRoot) return;

  const titleEl = document.getElementById('songHubTitle');
  const subtitleEl = document.getElementById('songHubSubtitle');
  const versionsEl = document.getElementById('songHubVersions');
  const sortEl = document.getElementById('songHubSort');

  if (!titleEl || !subtitleEl || !versionsEl || !sortEl) return;

  const params = new URLSearchParams(window.location.search);
  const requestedSongKey = (params.get('song') || '').toLowerCase().trim();
  const activeSong = getActiveSong();
  const fallbackKey = activeSong ? getTrackGroupKey(activeSong.title) : '';
  const targetKey = requestedSongKey || fallbackKey;

  const allSongs = Array.isArray(window.allSongs) ? window.allSongs : [];
  const sv = songVersionsApi();
  const catalog = sv
    ? sv.mergeSongCatalog(allSongs, [])
    : allSongs;
  const matchingVersions = sv
    ? sv.collectVersionsByGroupKey(catalog, targetKey)
    : allSongs.filter((song) => getTrackGroupKey(song.title) === targetKey);

  if (!matchingVersions.length) {
    titleEl.textContent = 'Song';
    subtitleEl.textContent = 'No versions found yet.';
    versionsEl.innerHTML = '<p class="song-hub-empty">Versions will appear here as they are added.</p>';
    if (window.BurnfolderSongPageRender) {
      window.BurnfolderSongPageRender.apply(hubRoot, { page: null });
    }
    return;
  }

  const baseTitle = sv ? sv.getBaseTitle(matchingVersions) : stripTrailingDate(matchingVersions[0].title);
  titleEl.textContent = baseTitle;
  subtitleEl.textContent = `${matchingVersions.length} version${matchingVersions.length === 1 ? '' : 's'}`;

  const store = window.BurnfolderSongPageStore;
  const renderApi = window.BurnfolderSongPageRender;

  let page = (window.burnfolderSongPages || {})[targetKey] || null;
  if (store && store.normalizePage && page) {
    page = store.normalizePage(targetKey, page);
  } else if (store && store.getPublishedPage) {
    page = store.getPublishedPage(targetKey) || page;
  }

  songHubContext = { groupKey: targetKey, page, hubRoot };

  const renderSongHubContent = () => {
    const sortMode = sortEl.value || 'newest';
    const sorted = sv
      ? sv.sortVersions(matchingVersions, sortMode)
      : [...matchingVersions].sort((a, b) => compareSongsBySortMode(a, b, sortMode));

    fillTracklistContainer(
      versionsEl,
      sorted.map((song) => ({
        song,
        displayTitle: song.title,
        onPlay: () => {
          playSongHubQueue(sorted, song, hubRoot, page, renderApi);
        },
      })),
      { freezePlayback: true }
    );
    syncTracklistPlayback();

    const hubPlayBtn = document.getElementById('songHubPlay');
    if (hubPlayBtn && !hubPlayBtn.dataset.bound) {
      hubPlayBtn.dataset.bound = '1';
      hubPlayBtn.addEventListener('click', () => {
        const startSong = sorted[0];
        if (!startSong) return;
        const active = getActiveSong();
        const onHub = active && sorted.some((item) => item.playbackId === active.playbackId);
        if (onHub) {
          if (activeMuxPlayer && !activeMuxPlayer.paused) {
            togglePlayPause();
          } else if (activeMuxPlayer) {
            activeMuxPlayer.play().catch(() => {});
            updateUI();
          }
          return;
        }
        playSongHubQueue(sorted, startSong, hubRoot, page, renderApi);
      });
    }
    syncSongHubPlayButton();

    if (renderApi) {
      const active = getActiveSong();
      const activeOnHub =
        active && sorted.some((item) => item.playbackId === active.playbackId);
      renderApi.apply(hubRoot, {
        page: page,
        baseTitle: baseTitle,
        library: [],
        shared: window.BurnfolderStreamShared || null,
        catalogVersions: sorted,
        activePlaybackId: activeOnHub ? active.playbackId : '',
        onVersionSelect: (playbackId) => {
          const active = getActiveSong();
          if (active && active.playbackId === playbackId) return;
          const target = sorted.find((item) => item.playbackId === playbackId);
          if (target) playSongHubQueue(sorted, target, hubRoot, page, renderApi);
        },
      });
    }
  };

  sortEl.onchange = renderSongHubContent;
  renderSongHubContent();
}

window.renderSongHubPage = renderSongHubPage;

function playAlbumHubQueue(sorted, song) {
  if (!sorted || !sorted.length || !song || !song.playbackId) return;

  const idx = sorted.findIndex((item) => item.playbackId === song.playbackId);
  const active = getActiveSong();
  const onAlbum = active && sorted.some((item) => item.playbackId === active.playbackId);

  if (onAlbum && active.playbackId === song.playbackId) {
    if (activeMuxPlayer && !activeMuxPlayer.paused) {
      togglePlayPause();
    } else if (activeMuxPlayer) {
      activeMuxPlayer.play().catch(() => {});
      updateUI();
    }
    return;
  }

  startPlayback(song, sorted, idx >= 0 ? idx : 0);
}

function syncAlbumHubPlayButton() {
  const hubPlayBtn = document.getElementById('albumHubPlay');
  if (!hubPlayBtn) return;

  const hubRoot = document.getElementById('albumHubPage');
  if (!hubRoot) return;

  const rows = hubRoot.querySelectorAll('.music-track-row');
  if (!rows.length) {
    hubPlayBtn.hidden = true;
    return;
  }

  hubPlayBtn.hidden = false;
  const activeSong = getActiveSong();
  const onThisAlbum =
    activeSong &&
    Array.from(rows).some((row) => row.dataset.playbackId === activeSong.playbackId);
  const playing = !!(onThisAlbum && activeMuxPlayer && !activeMuxPlayer.paused);
  hubPlayBtn.classList.toggle('is-playing', playing);
  hubPlayBtn.setAttribute('aria-label', playing ? 'Pause album' : 'Play album');
}

function renderAlbumHubLinks(rootEl, links) {
  const panel = rootEl.querySelector('[data-album-panel="links"]');
  const mount = rootEl.querySelector('[data-album-field="links"]');
  if (!mount) return;

  mount.innerHTML = '';
  const rows = Array.isArray(links) ? links.filter((link) => link && link.label) : [];
  if (!rows.length) {
    if (panel) {
      panel.hidden = true;
      panel.classList.add('is-empty');
    }
    return;
  }

  rows.forEach((link) => {
    const href = String(link.href || '').trim();
    const pending = !!link.pending || !href;
    if (pending) {
      const span = document.createElement('span');
      span.className = 'album-hub-link album-hub-link--pending';
      span.textContent = link.label;
      mount.appendChild(span);
      return;
    }
    const a = document.createElement('a');
    a.className = 'album-hub-link';
    a.href = href;
    a.textContent = link.label;
    mount.appendChild(a);
  });

  if (panel) {
    panel.hidden = false;
    panel.classList.remove('is-empty');
  }
}

function renderAlbumHubCredits(rootEl, credits) {
  const panel = rootEl.querySelector('[data-album-panel="credits"]');
  const mount = rootEl.querySelector('[data-album-field="credits"]');
  const renderApi = window.BurnfolderAlbumPageRender;
  const text = String(credits || '').trim();
  if (!mount) return;

  if (!text) {
    if (panel) {
      panel.hidden = true;
      panel.classList.add('is-empty');
    }
    mount.innerHTML = '';
    return;
  }

  mount.innerHTML = renderApi && renderApi.textToHtml ? renderApi.textToHtml(text) : text;
  if (panel) {
    panel.hidden = false;
    panel.classList.remove('is-empty');
  }
}

function renderAlbumHubDarkroom(rootEl, published, tracks, catalog, sv, onPlayVersion) {
  const panel = rootEl.querySelector('[data-album-panel="darkroom"]');
  const introEl = rootEl.querySelector('[data-album-field="darkroom-intro"]');
  const tracksEl = rootEl.querySelector('[data-album-field="darkroom-tracks"]');
  const journalEl = rootEl.querySelector('[data-album-field="darkroom-journal"]');
  const renderApi = window.BurnfolderAlbumPageRender;
  if (!panel || !tracksEl) return;

  const intro = String((published && published.darkroomIntro) || '').trim();
  if (introEl) {
    introEl.innerHTML = renderApi && renderApi.textToHtml ? renderApi.textToHtml(intro) : intro;
    introEl.hidden = !intro;
  }

  tracksEl.innerHTML = '';
  const rows = Array.isArray(tracks) ? tracks : [];
  let hasVersions = false;

  rows.forEach((track) => {
    const groupKey =
      (track && track.groupKey) ||
      (sv && track.title ? sv.getTrackGroupKey(track.title) : '');
    const versions =
      sv && groupKey ? sv.collectVersionsByGroupKey(catalog, groupKey) : [];
    if (versions.length < 2) return;
    hasVersions = true;

    const block = document.createElement('article');
    block.className = 'album-darkroom-track';

    const head = document.createElement('h3');
    head.className = 'album-darkroom-track-title';
    head.textContent = track.title || 'untitled';
    block.appendChild(head);

    const picker = document.createElement('div');
    picker.className = 'song-hub-version-picker album-darkroom-picker';
    picker.setAttribute('role', 'tablist');
    picker.setAttribute('aria-label', (track.title || 'track') + ' versions');

    versions.forEach((song) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'song-hub-version-chip';
      chip.dataset.playbackId = song.playbackId;
      chip.setAttribute('role', 'tab');
      const isReleaseCut = song.playbackId === track.playbackId;
      chip.classList.toggle('is-active', isReleaseCut);
      chip.setAttribute('aria-selected', isReleaseCut ? 'true' : 'false');

      const label = document.createElement('span');
      label.className = 'song-hub-version-chip-label';
      label.textContent = sv && sv.getTrackDateLabel ? sv.getTrackDateLabel(song) || song.title : song.title;
      chip.appendChild(label);

      chip.addEventListener('click', () => {
        picker.querySelectorAll('.song-hub-version-chip').forEach((node) => {
          const active = node.dataset.playbackId === song.playbackId;
          node.classList.toggle('is-active', active);
          node.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        if (typeof onPlayVersion === 'function') onPlayVersion(song);
      });

      picker.appendChild(chip);
    });

    block.appendChild(picker);

    if (sv) {
      const songHref = sv.getSongHubHref({ title: track.title }, '');
      const songPages = window.burnfolderSongPages || {};
      const pageKey = sv.getTrackGroupKey(track.title);
      if (songPages[pageKey]) {
        const songLink = document.createElement('a');
        songLink.className = 'album-darkroom-song-link icon-btn';
        songLink.href = songHref;
        songLink.textContent = 'song page';
        block.appendChild(songLink);
      }
    }

    tracksEl.appendChild(block);
  });

  if (journalEl) {
    journalEl.innerHTML = '';
    const arc = Array.isArray(published && published.journalArc) ? published.journalArc : [];
    arc.forEach((date, index) => {
      const label = String(date || '').trim();
      if (!label) return;
      if (index > 0) {
        const sep = document.createElement('span');
        sep.className = 'album-darkroom-journal-sep';
        sep.textContent = '·';
        sep.setAttribute('aria-hidden', 'true');
        journalEl.appendChild(sep);
      }
      const link = document.createElement('a');
      link.className = 'album-darkroom-journal-link';
      link.href = label + '.html';
      link.textContent = label;
      journalEl.appendChild(link);
    });
    journalEl.hidden = !arc.length;
  }

  if (!hasVersions && !intro && !(published && published.journalArc && published.journalArc.length)) {
    panel.hidden = true;
    panel.classList.add('is-empty');
    return;
  }

  panel.hidden = false;
  panel.classList.remove('is-empty');
}

function renderAlbumHubPage() {
  const hubRoot = document.getElementById('albumHubPage');
  if (!hubRoot) return;

  const renderApi = window.BurnfolderAlbumPageRender;
  if (!renderApi) return;

  const params = new URLSearchParams(window.location.search);
  const albumId = (params.get('album') || '').trim();
  const published = (window.burnfolderAlbumPages || {})[albumId];

  const titleEl = hubRoot.querySelector('[data-album-field="title"]');
  const subtitleEl = hubRoot.querySelector('[data-album-field="subtitle"]');

  if (!albumId || !published) {
    if (titleEl) titleEl.textContent = 'Album';
    if (subtitleEl) subtitleEl.textContent = 'Album not found.';
    return;
  }

  const allSongs = Array.isArray(window.allSongs) ? window.allSongs : [];
  const sv = songVersionsApi();
  const catalog = sv ? sv.mergeSongCatalog(allSongs, []) : allSongs;
  const songPages = window.burnfolderSongPages || {};

  const tracks = (published.tracks || [])
    .map((ref) => {
      const hit = allSongs.find((song) => song.playbackId === ref.playbackId);
      if (hit) {
        return {
          ...hit,
          title: String(ref.title || '').trim() || hit.title
        };
      }
      return { title: ref.title || 'untitled', playbackId: ref.playbackId };
    })
    .filter((track) => track.playbackId);

  renderApi.apply(hubRoot, {
    albumPage: published,
    meta: {
      title: published.title || 'Album',
      coverArt: published.coverArt || '',
      tagline: published.subtitle || ''
    },
    tracks,
    songPages,
    songCatalog: catalog,
    versionsApi: sv,
    itemLabel: (item) => item.title || 'untitled',
    showSongLinks: true,
    songPageUrl: (item) => {
      if (!sv) return 'song.html';
      const song = sv.resolvePlaybackInCatalog(catalog, item.playbackId);
      return song ? sv.getSongHubHref(song, '') : 'song.html';
    },
    onTrackSelect: (row) => {
      const idx = tracks.findIndex((track) => track.playbackId === row.playbackId);
      playAlbumHubQueue(tracks, tracks[idx >= 0 ? idx : 0]);
    },
    onRendered: (rows) => {
      const tagline = String(published.subtitle || '').trim();
      const subtitleEl = hubRoot.querySelector('[data-album-field="subtitle"]');
      const metaEl = hubRoot.querySelector('[data-album-field="track-meta"]');

      if (tagline && subtitleEl) {
        subtitleEl.textContent = tagline;
      }

      if (metaEl && renderApi.compileTrackRows) {
        const summaryRows = renderApi.compileTrackRows({
          tracks,
          songPages,
          songCatalog: catalog,
          versionsApi: sv,
          itemLabel: (item) => item.title || 'untitled'
        });
        const shared = window.BurnfolderStreamShared;
        const items = summaryRows.map((row) => ({
          playbackId: row.playbackId,
          duration: row.item && row.item.duration
        }));
        let metaText = '';
        if (shared && shared.sumTrackDurations && shared.albumTrackCountMeta) {
          const sum = shared.sumTrackDurations(items);
          metaText = shared.albumTrackCountMeta(items.length, sum.complete ? sum.total : 0);
        } else if (items.length) {
          metaText = items.length + ' track' + (items.length === 1 ? '' : 's');
        }
        if (metaText) {
          metaEl.textContent = metaText;
          metaEl.hidden = false;
        } else {
          metaEl.hidden = true;
        }
      }
    }
  });

  renderAlbumHubLinks(hubRoot, published.links);
  renderAlbumHubCredits(hubRoot, published.credits);
  renderAlbumHubDarkroom(hubRoot, published, tracks, catalog, sv, (song) => {
    playTrackBySong(song);
  });

  if (published.title) {
    document.title = `${published.title} — burnfolder.com`;
  }

  const hubPlayBtn = document.getElementById('albumHubPlay');
  if (hubPlayBtn && !hubPlayBtn.dataset.bound) {
    hubPlayBtn.dataset.bound = '1';
    hubPlayBtn.addEventListener('click', () => {
      const startSong = tracks[0];
      if (!startSong) return;
      const active = getActiveSong();
      const onAlbum = active && tracks.some((item) => item.playbackId === active.playbackId);
      if (onAlbum) {
        if (activeMuxPlayer && !activeMuxPlayer.paused) {
          togglePlayPause();
        } else if (activeMuxPlayer) {
          activeMuxPlayer.play().catch(() => {});
          updateUI();
        }
        return;
      }
      playAlbumHubQueue(tracks, startSong);
    });
  }

  syncAlbumHubPlayButton();
}

window.renderAlbumHubPage = renderAlbumHubPage;

function createCheckoutPopup() {
  if (document.getElementById('purchaseOverlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'purchaseOverlay';
  overlay.className = 'checkout-popup-overlay';
  overlay.innerHTML = `
    <div class="checkout-popup" role="dialog" aria-modal="true" aria-labelledby="purchaseTitle">
      <div class="checkout-popup-header">
        <p class="checkout-popup-eyebrow" id="purchaseTitle">Checkout</p>
        <button type="button" class="icon-btn checkout-close-btn" id="purchaseClose">Close</button>
      </div>
      <div class="checkout-popup-body">
        <div id="purchaseSummary" class="checkout-summary"></div>
        <form id="purchaseForm" class="checkout-form minimal-checkout" autocomplete="on">
          <div id="purchaseShippingFields">
            <label class="checkout-label">Name
              <input class="checkout-input" type="text" name="name" required>
            </label>
            <label class="checkout-label">Email
              <input class="checkout-input" type="email" name="email" required>
            </label>
            <label class="checkout-label">Street Address
              <input class="checkout-input" type="text" name="address_line1" required>
            </label>
            <label class="checkout-label">Apt / Suite (optional)
              <input class="checkout-input" type="text" name="address_line2">
            </label>
            <div style="display:flex;gap:12px;">
              <label class="checkout-label" style="flex:1;">City
                <input class="checkout-input" type="text" name="city" required>
              </label>
              <label class="checkout-label" style="flex:1;">State
                <input class="checkout-input" type="text" name="state" required maxlength="2" placeholder="NY">
              </label>
            </div>
            <label class="checkout-label">ZIP
              <input class="checkout-input" type="text" name="zip" required maxlength="10" placeholder="10001">
            </label>
          </div>
          <div id="purchaseWalletWrap" class="checkout-wallet-wrap" style="display:none;">
            <div id="purchaseApplePayElement" class="checkout-wallet-button"></div>
            <div class="checkout-wallet-divider">or pay with card</div>
          </div>
          <div id="purchaseHostedWalletWrap" class="checkout-wallet-wrap" style="display:none;">
            <button type="button" class="icon-btn checkout-hosted-wallet-btn" id="purchaseHostedWalletBtn">Continue to secure wallet checkout</button>
            <div class="checkout-wallet-divider">opens secure Stripe checkout</div>
          </div>
          <div id="purchaseWalletHint" class="checkout-wallet-hint" style="display:none;"></div>
          <div id="purchaseCardElement" class="checkout-input" style="padding:16px 0 8px 0;"></div>
          <div id="purchaseCardErrors" style="color:#c00;font-size:0.95em;margin-top:4px;"></div>
          <button type="submit" class="icon-btn" id="purchasePayBtn">Pay</button>
          <div id="purchaseStatus" class="checkout-popup-status"></div>
        </form>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeCheckoutPopup();
  });
  document.getElementById('purchaseClose').addEventListener('click', closeCheckoutPopup);
  document.getElementById('purchaseForm').addEventListener('submit', handlePopupCheckoutSubmit);
  document.getElementById('purchaseHostedWalletBtn').addEventListener('click', startHostedWalletCheckout);
}

function getCartItems() {
  try {
    return JSON.parse(localStorage.getItem('cart') || '[]');
  } catch {
    return [];
  }
}

function updateCartFloat() {
  const float = document.getElementById('cartFloat');
  if (!float) return;
  const hasItems = getCartItems().length > 0;
  float.classList.toggle('site-cart-btn--hidden', !hasItems);
  float.setAttribute('aria-hidden', hasItems ? 'false' : 'true');
}

window.updateCartFloat = updateCartFloat;

function addTinCanToCart() {
  const cart = getCartItems();
  if (cart.some((item) => item.id === 'seltzer-can')) {
    alert('already in cart.');
    return;
  }
  cart.push({
    id: 'seltzer-can',
    name: 'tin can',
    price: 1,
    qty: 1,
    image: 'IMAGES/tin-can.png',
    requiresShipping: 'true',
  });
  localStorage.setItem('cart', JSON.stringify(cart));
  updateCartFloat();
  if (typeof openCheckoutPopup === 'function') {
    openCheckoutPopup('cart');
  }
}

window.addTinCanToCart = addTinCanToCart;

function removeCartItemAt(rawIndex) {
  const idx = Math.floor(Number(rawIndex));
  const cart = getCartItems();
  if (!Number.isFinite(idx) || idx < 0 || idx >= cart.length) return;
  cart.splice(idx, 1);
  localStorage.setItem('cart', JSON.stringify(cart));
  updateCartFloat();
  window.dispatchEvent(new CustomEvent('burnfolder-cart-changed'));

  const overlay = document.getElementById('purchaseOverlay');
  const popupOpen = overlay && overlay.classList.contains('open') && checkoutMode === 'cart';
  if (popupOpen) {
    if (cart.length === 0) {
      closeCheckoutPopup();
    } else {
      renderCheckoutSummary();
    }
  }
}

window.removeCartItemAt = removeCartItemAt;

function renderCheckoutSummary() {
  const summary = document.getElementById('purchaseSummary');
  const shippingFields = document.getElementById('purchaseShippingFields');

  if (!summary || !shippingFields) return;

  if (checkoutMode === 'tip') {
    summary.innerHTML = `
      <p class="checkout-popup-title">Support Burnfolder</p>
      <p class="checkout-popup-line">Tip amount: $${formatTipAmount(checkoutTipAmount)}</p>
    `;
    shippingFields.style.display = 'none';
  } else {
    const cart = getCartItems();
    const total = cart.reduce((acc, item) => acc + (item.price * item.qty), 0);

    summary.innerHTML = '';
    if (cart.length === 0) {
      summary.innerHTML = '<p class="checkout-popup-line">Your cart is empty.</p>';
    } else {
      const title = document.createElement('p');
      title.className = 'checkout-popup-title';
      title.textContent = 'Your Cart';
      summary.appendChild(title);

      cart.forEach((item, i) => {
        const row = document.createElement('div');
        row.className = 'checkout-popup-line checkout-popup-cart-row';

        const info = document.createElement('span');
        info.className = 'checkout-popup-cart-info';
        info.textContent = `${item.name} x${item.qty} - $${item.price * item.qty}`;

        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'icon-btn checkout-cart-remove';
        rm.textContent = 'remove';
        rm.setAttribute('aria-label', `remove ${item.name} from cart`);
        rm.addEventListener('click', () => removeCartItemAt(i));

        row.appendChild(info);
        row.appendChild(rm);
        summary.appendChild(row);
      });

      const tot = document.createElement('div');
      tot.className = 'checkout-popup-total';
      tot.textContent = `Total: $${total}`;
      summary.appendChild(tot);
    }

    shippingFields.style.display = 'block';
  }
}

function getCheckoutAmountCents() {
  if (checkoutMode === 'tip') {
    return Math.max(0, Number(checkoutTipAmount) * 100);
  }

  const cart = getCartItems();
  const total = cart.reduce((acc, item) => acc + (Number(item.price) * Number(item.qty)), 0);
  return Math.max(0, Math.round(total * 100));
}

function resetCheckoutWalletButton() {
  if (checkoutPaymentRequestButton) {
    try {
      checkoutPaymentRequestButton.unmount();
    } catch {
      // no-op
    }
  }

  checkoutPaymentRequestButton = null;
  checkoutPaymentRequest = null;

  const walletContainer = document.getElementById('purchaseApplePayElement');
  if (walletContainer) walletContainer.innerHTML = '';
}

function setHostedWalletVisibility(visible) {
  const hostedWrap = document.getElementById('purchaseHostedWalletWrap');
  if (hostedWrap) hostedWrap.style.display = visible ? 'block' : 'none';
}

function setWalletHint(message) {
  const hint = document.getElementById('purchaseWalletHint');
  if (!hint) return;

  const text = String(message || '').trim();
  hint.textContent = text;
  hint.style.display = text ? 'block' : 'none';
}

async function startHostedWalletCheckout() {
  const status = document.getElementById('purchaseStatus');
  const errors = document.getElementById('purchaseCardErrors');
  const hostedBtn = document.getElementById('purchaseHostedWalletBtn');

  if (errors) errors.textContent = '';
  if (status) status.textContent = 'Redirecting to secure checkout...';
  if (hostedBtn) hostedBtn.disabled = true;

  try {
    let endpoint = '';
    let payload = {};

    if (checkoutMode === 'tip') {
      endpoint = '/.netlify/functions/create-tip-checkout-session';
      payload = { amount: checkoutTipAmount };
    } else {
      const cart = getCartItems();
      if (cart.length === 0) throw new Error('Your cart is empty.');
      endpoint = '/.netlify/functions/create-checkout-session';
      payload = { cart };
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok || (!data.id && !data.url)) {
      throw new Error(data.error || 'Could not start secure checkout.');
    }

    if (data.url && /^https:\/\//i.test(data.url)) {
      window.location.href = data.url;
      return;
    }

    throw new Error('Secure checkout URL unavailable. Please try again.');
  } catch (err) {
    if (status) status.textContent = '';
    if (errors) errors.textContent = err.message || 'Wallet checkout unavailable.';
    if (hostedBtn) hostedBtn.disabled = false;
  }
}

function getShippingFromWalletEvent(ev) {
  const shippingAddress = ev.shippingAddress || {};
  const line1 = Array.isArray(shippingAddress.addressLine) ? (shippingAddress.addressLine[0] || '') : '';
  const line2 = Array.isArray(shippingAddress.addressLine) ? (shippingAddress.addressLine[1] || '') : '';

  return {
    name: ev.payerName || '',
    email: ev.payerEmail || '',
    address_line1: line1,
    address_line2: line2,
    city: shippingAddress.city || shippingAddress.locality || '',
    state: (shippingAddress.region || '').toUpperCase(),
    zip: shippingAddress.postalCode || ''
  };
}

async function mountCheckoutWalletButton() {
  const walletWrap = document.getElementById('purchaseWalletWrap');
  const walletContainer = document.getElementById('purchaseApplePayElement');
  const status = document.getElementById('purchaseStatus');
  const errors = document.getElementById('purchaseCardErrors');

  if (!walletWrap || !walletContainer) return;

  walletWrap.style.display = 'none';
  setHostedWalletVisibility(false);
  setWalletHint('');
  resetCheckoutWalletButton();

  try {
    await loadStripeScript();
  } catch {
    setHostedWalletVisibility(true);
    setWalletHint('Quick wallet is unavailable in this browser context. Use secure wallet checkout.');
    return;
  }

  if (!stripeClient) {
    setHostedWalletVisibility(true);
    setWalletHint('Quick wallet is unavailable in this browser context. Use secure wallet checkout.');
    return;
  }

  const amount = getCheckoutAmountCents();
  if (!amount) return;

  checkoutPaymentRequest = stripeClient.paymentRequest({
    country: 'US',
    currency: 'usd',
    total: {
      label: checkoutMode === 'tip' ? 'Burnfolder Tip' : 'Burnfolder Order',
      amount
    },
    requestPayerName: true,
    requestPayerEmail: true,
    requestShipping: checkoutMode === 'cart'
  });

  const canMakePayment = await checkoutPaymentRequest.canMakePayment();
  if (!canMakePayment) {
    setHostedWalletVisibility(true);
    setWalletHint('Apple Pay / Google Pay is not available in this browser. Use secure wallet checkout.');
    return;
  }

  setWalletHint('');

  try {
    const walletElements = stripeClient.elements();
    checkoutPaymentRequestButton = walletElements.create('paymentRequestButton', {
      paymentRequest: checkoutPaymentRequest,
      style: {
        paymentRequestButton: {
          type: 'buy',
          theme: 'dark',
          height: '40px'
        }
      }
    });

    checkoutPaymentRequestButton.mount('#purchaseApplePayElement');
    walletWrap.style.display = 'block';
  } catch {
    setHostedWalletVisibility(true);
    setWalletHint('Quick wallet could not initialize here. Use secure wallet checkout.');
    if (status) status.textContent = 'Quick wallet unavailable in this checkout context.';
    return;
  }

  checkoutPaymentRequest.on('paymentmethod', async (ev) => {
    if (errors) errors.textContent = '';
    if (status) status.textContent = 'Processing wallet payment...';

    try {
      let clientSecret = '';
      let confirmOpts = {
        payment_method: ev.paymentMethod.id
      };

      if (checkoutMode === 'tip') {
        const res = await fetch('/.netlify/functions/create-tip-payment-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: checkoutTipAmount, email: ev.payerEmail || '' })
        });
        const data = await res.json();
        if (!res.ok || !data.clientSecret) {
          ev.complete('fail');
          throw new Error(data.error || 'Could not create tip payment intent.');
        }

        clientSecret = data.clientSecret;
        confirmOpts = {
          payment_method: ev.paymentMethod.id,
          receipt_email: ev.payerEmail || undefined
        };
      } else {
        const cart = getCartItems();
        if (cart.length === 0) {
          ev.complete('fail');
          throw new Error('Your cart is empty.');
        }

        const shipping = getShippingFromWalletEvent(ev);
        const res = await fetch('/.netlify/functions/create-payment-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cart, shipping })
        });
        const data = await res.json();
        if (!res.ok || !data.clientSecret) {
          ev.complete('fail');
          throw new Error(data.error || 'Could not create payment intent.');
        }

        clientSecret = data.clientSecret;
        confirmOpts = {
          payment_method: ev.paymentMethod.id,
          shipping: {
            name: shipping.name,
            address: {
              line1: shipping.address_line1,
              line2: shipping.address_line2,
              city: shipping.city,
              state: shipping.state,
              postal_code: shipping.zip,
              country: 'US'
            }
          },
          receipt_email: shipping.email || undefined
        };
      }

      const initial = await stripeClient.confirmCardPayment(clientSecret, confirmOpts, { handleActions: false });
      if (initial.error) {
        ev.complete('fail');
        throw new Error(initial.error.message || 'Wallet payment failed.');
      }

      ev.complete('success');

      if (initial.paymentIntent && initial.paymentIntent.status === 'requires_action') {
        const followUp = await stripeClient.confirmCardPayment(clientSecret);
        if (followUp.error) {
          throw new Error(followUp.error.message || 'Payment authentication failed.');
        }
      }

      if (checkoutMode === 'cart') {
        localStorage.removeItem('cart');
        updateCartFloat();
        if (status) status.textContent = 'Payment successful. Your order is confirmed.';
      } else {
        if (status) status.textContent = 'Payment successful. Thank you for supporting burnfolder.';
      }

      setTimeout(() => {
        closeCheckoutPopup();
      }, 1200);
    } catch (err) {
      try {
        ev.complete('fail');
      } catch {
        // no-op
      }
      if (errors) errors.textContent = err.message || 'Wallet payment failed.';
      if (status) status.textContent = '';
    }
  });
}

async function ensureCheckoutCardMounted() {
  await loadStripeScript();
  if (!stripeClient) throw new Error('Stripe unavailable.');

  if (!checkoutElements) {
    checkoutElements = stripeClient.elements();
  }

  if (!checkoutCard) {
    checkoutCard = checkoutElements.create('card', {
      style: {
        base: {
          fontFamily: 'monospace',
          fontSize: '1em',
          color: '#000',
          '::placeholder': { color: '#888' },
          iconColor: '#000'
        },
        invalid: { color: '#c00' }
      }
    });
    checkoutCard.mount('#purchaseCardElement');
  }
}

async function openCheckoutPopup(mode, amount) {
  createCheckoutPopup();
  checkoutMode = mode;
  checkoutTipAmount = amount || 1;

  const overlay = document.getElementById('purchaseOverlay');
  const title = document.getElementById('purchaseTitle');
  const status = document.getElementById('purchaseStatus');
  const errors = document.getElementById('purchaseCardErrors');
  const payBtn = document.getElementById('purchasePayBtn');

  if (!overlay || !title || !status || !errors || !payBtn) return;

  title.textContent = mode === 'tip' ? 'Support Burnfolder' : 'Checkout';
  payBtn.textContent = mode === 'tip' ? `Pay $${checkoutTipAmount}` : 'Pay';
  if (mode === 'tip') {
    payBtn.textContent = `Pay $${formatTipAmount(checkoutTipAmount)}`;
  }
  status.textContent = '';
  errors.textContent = '';

  renderCheckoutSummary();

  overlay.classList.add('open');
  document.body.classList.add('checkout-open');

  try {
    await ensureCheckoutCardMounted();
    await mountCheckoutWalletButton();
  } catch (err) {
    status.textContent = err.message || 'Checkout unavailable.';
  }
}

function closeCheckoutPopup() {
  const overlay = document.getElementById('purchaseOverlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  document.body.classList.remove('checkout-open');
  resetCheckoutWalletButton();
  setHostedWalletVisibility(false);
  setWalletHint('');
}

async function handlePopupCheckoutSubmit(e) {
  e.preventDefault();

  const form = e.currentTarget;
  const status = document.getElementById('purchaseStatus');
  const errors = document.getElementById('purchaseCardErrors');
  const payBtn = document.getElementById('purchasePayBtn');

  if (!status || !errors || !payBtn || !checkoutCard) return;

  errors.textContent = '';
  payBtn.disabled = true;
  status.textContent = 'Processing payment...';

  try {
    let clientSecret = '';
    let confirmOpts = { payment_method: { card: checkoutCard } };

    if (checkoutMode === 'tip') {
      const res = await fetch('/.netlify/functions/create-tip-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: checkoutTipAmount })
      });
      const data = await res.json();
      if (!res.ok || !data.clientSecret) {
        throw new Error(data.error || 'Could not create tip payment intent.');
      }

      clientSecret = data.clientSecret;
      confirmOpts = { payment_method: { card: checkoutCard } };
    } else {
      const cart = getCartItems();
      if (cart.length === 0) throw new Error('Your cart is empty.');

      const shipping = {
        name: form.name.value,
        email: form.email.value,
        address_line1: form.address_line1.value,
        address_line2: form.address_line2.value || '',
        city: form.city.value,
        state: form.state.value,
        zip: form.zip.value
      };

      const res = await fetch('/.netlify/functions/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cart, shipping })
      });
      const data = await res.json();
      if (!res.ok || !data.clientSecret) {
        throw new Error(data.error || 'Could not create payment intent.');
      }

      clientSecret = data.clientSecret;
      confirmOpts = {
        payment_method: {
          card: checkoutCard,
          billing_details: {
            name: shipping.name,
            email: shipping.email
          }
        },
        shipping: {
          name: shipping.name,
          address: {
            line1: shipping.address_line1,
            line2: shipping.address_line2,
            city: shipping.city,
            state: shipping.state,
            postal_code: shipping.zip,
            country: 'US'
          }
        }
      };
    }

    const result = await stripeClient.confirmCardPayment(clientSecret, confirmOpts);
    if (result.error) {
      errors.textContent = result.error.message || 'Payment failed.';
      status.textContent = '';
      payBtn.disabled = false;
      return;
    }

    if (checkoutMode === 'cart') {
      localStorage.removeItem('cart');
      updateCartFloat();
      status.textContent = 'Payment successful. Your order is confirmed.';
    } else {
      status.textContent = 'Payment successful. Thank you for supporting burnfolder.';
    }

    setTimeout(() => {
      closeCheckoutPopup();
    }, 1200);
  } catch (err) {
    status.textContent = err.message || 'Checkout failed.';
    payBtn.disabled = false;
  }
}

window.openCheckoutPopup = openCheckoutPopup;

document.addEventListener('click', (e) => {
  const cartBtn = e.target.closest('#cartFloat');
  if (!cartBtn) return;
  if (cartBtn.hasAttribute('onclick')) cartBtn.removeAttribute('onclick');
  e.preventDefault();
  e.stopPropagation();
  openCheckoutPopup('cart');
}, true);

window.addEventListener('storage', updateCartFloat);
document.addEventListener('DOMContentLoaded', updateCartFloat);

let activeIdx = null;
let activeSongOverride = null;
let activeQueue = [];
let activeQueueIdx = null;

function getActiveSong() {
  const currentPlaybackId = activeMuxPlayer ? activeMuxPlayer.getAttribute('playback-id') : '';

  if (
    activeSongOverride &&
    (!currentPlaybackId || activeSongOverride.playbackId === currentPlaybackId)
  ) {
    return activeSongOverride;
  }

  if (activeIdx !== null && activeIdx >= 0 && window.currentSongs[activeIdx]) {
    const candidate = window.currentSongs[activeIdx];
    if (!currentPlaybackId || candidate.playbackId === currentPlaybackId) {
      return candidate;
    }
  }

  if (Array.isArray(window.allSongs) && currentPlaybackId) {
    const fromAll = window.allSongs.find((song) => song.playbackId === currentPlaybackId);
    if (fromAll) return fromAll;
  }

  return activeSongOverride;
}

function persistPlaybackState() {
  if (!activeMuxPlayer) return;
  const playbackId = activeMuxPlayer.getAttribute('playback-id');
  const activeSong = getActiveSong();
  if (!playbackId || !activeSong || activeSong.playbackId !== playbackId) return;
  sessionStorage.setItem(
    'playbackState',
    JSON.stringify({
      playbackId: activeSong.playbackId,
      title: activeSong.title,
      currentTime: activeMuxPlayer.currentTime || 0,
      isPlaying: !activeMuxPlayer.paused,
    })
  );
}

function preservePlaybackAcrossNavigation() {
  if (!activeMuxPlayer) return;
  const playbackId = activeMuxPlayer.getAttribute('playback-id');
  if (!playbackId) return;

  let song = getActiveSong();
  if (!song) {
    song = Array.isArray(window.allSongs)
      ? window.allSongs.find((item) => item.playbackId === playbackId)
      : null;
    if (song) {
      activeSongOverride = song;
      const idx = window.currentSongs.findIndex((item) => item.playbackId === playbackId);
      activeIdx = idx >= 0 ? idx : null;
      if (!activeQueue.length || !activeQueue.some((item) => item.playbackId === playbackId)) {
        activeQueue = [song];
        activeQueueIdx = 0;
      }
    } else if (activeSongOverride && activeSongOverride.playbackId === playbackId) {
      song = activeSongOverride;
    } else {
      song = { playbackId: playbackId, title: activeSongOverride?.title || 'Track' };
      activeSongOverride = song;
      activeIdx = null;
      activeQueue = [song];
      activeQueueIdx = 0;
    }
  }

  if (song && bottomBar) {
    bottomBar.style.display = 'flex';
    updateUI();
  } else {
    syncPlaybackChromeState();
    syncTracklistPlayback();
  }
}

window.preservePlaybackAcrossNavigation = preservePlaybackAcrossNavigation;

mountNowPlayingBar();
renderSongHubPage();
renderAlbumHubPage();

// Store reference to active player globally
if (!window.globalMuxPlayer) {
  window.globalMuxPlayer = activeMuxPlayer;
}

// Restore playback state from previous page
const savedState = sessionStorage.getItem('playbackState');
if (savedState && audioList) {
  try {
    const state = JSON.parse(savedState);
    // Only restore if the song is valid for the current page
    let songIndex = window.currentSongs.findIndex(s => s.playbackId === state.playbackId);
    const fallbackSong = songIndex === -1 && Array.isArray(window.allSongs)
      ? window.allSongs.find(s => s.playbackId === state.playbackId)
      : null;
    if (songIndex !== -1) {
      activeSongOverride = window.currentSongs[songIndex];
      activeIdx = songIndex;
      activeQueue = window.currentSongs.slice();
      activeQueueIdx = songIndex;
      // Check if player already has this track loaded
      const currentPlaybackId = activeMuxPlayer.getAttribute('playback-id');
      if (currentPlaybackId === state.playbackId) {
        // Same track, just update UI - don't reload
        bottomBar.style.display = 'flex';
        updateUI();
        initializeVolumeControl();
      } else {
        // Different track or first load
        setTimeout(() => {
          activeMuxPlayer.setAttribute('playback-id', state.playbackId);
          activeMuxPlayer.setAttribute('metadata-video-title', state.title);
          // mux-player reacts to playback-id changes automatically — no .load() needed
          activeMuxPlayer.addEventListener('loadedmetadata', () => {
            activeMuxPlayer.currentTime = state.currentTime || 0;
            if (state.isPlaying) {
              activeMuxPlayer.play().catch(() => {
                // Auto-play blocked
                console.log('Auto-play prevented');
              });
            }
            updateUI();
            initializeVolumeControl();
          }, { once: true });
        }, 50);
      }
    } else if (fallbackSong) {
      activeSongOverride = fallbackSong;
      activeIdx = -1;
      activeQueue = [fallbackSong];
      activeQueueIdx = 0;
      setTimeout(() => {
        activeMuxPlayer.setAttribute('playback-id', fallbackSong.playbackId);
        activeMuxPlayer.setAttribute('metadata-video-title', fallbackSong.title);
        activeMuxPlayer.addEventListener('loadedmetadata', () => {
          activeMuxPlayer.currentTime = state.currentTime || 0;
          if (state.isPlaying) {
            activeMuxPlayer.play().catch(() => {
              console.log('Auto-play prevented');
            });
          }
          updateUI();
          initializeVolumeControl();
        }, { once: true });
      }, 50);
    } else {
      const currentPlaybackId = activeMuxPlayer ? activeMuxPlayer.getAttribute('playback-id') : '';
      if (currentPlaybackId && currentPlaybackId === state.playbackId) {
        activeSongOverride = fallbackSong || {
          playbackId: state.playbackId,
          title: state.title,
        };
        activeIdx = fallbackSong
          ? window.currentSongs.findIndex((item) => item.playbackId === state.playbackId)
          : null;
        if (activeIdx === -1) activeIdx = null;
        activeQueue = activeSongOverride ? [activeSongOverride] : [];
        activeQueueIdx = 0;
        bottomBar.style.display = 'flex';
        updateUI();
        initializeVolumeControl();
      }
    }
  } catch (e) {
    console.error('Failed to restore playback state:', e);
  }
}

// Save playback state before page unload
window.addEventListener('beforeunload', () => {
  persistPlaybackState();
});

// Update playback state periodically
setInterval(() => {
  persistPlaybackState();
}, 1000);

// Render song list — only when spa-router hasn't already populated it
// (spa-router.js runs before scripts.js and calls updateAudioListForPage on load;
//  if audioList already has children, skip to avoid duplicates)
const didRenderInitially =
  document.body.classList.contains('page-music') ||
  !audioList ||
  audioList.children.length > 0;

if (document.body.classList.contains('page-music')) {
  renderMusicPage();
}

if (audioList && !didRenderInitially) {
  fillTracklistContainer(
    audioList,
    window.currentSongs.map((song, idx) => ({
      song,
      displayTitle: getTracklistDisplayTitle(song),
      onPlay: (toPlay) => {
        const target = toPlay || song;
        const activeSong = getActiveSong();
        const sameTrack = activeSong && activeSong.playbackId === target.playbackId;
        if (sameTrack && activeMuxPlayer && !activeMuxPlayer.paused) {
          togglePlayPause();
        } else {
          playTrackBySong(target);
        }
      },
    }))
  );
}

function updateUI() {
  const activeSong = getActiveSong();
  const bar = nowPlayingBar || mountNowPlayingBar();
  if (bar) {
    bar.setExtraSongs(Array.isArray(window.currentSongs) ? window.currentSongs : []);
    bar.update({
      song: activeSong || null,
      playing: !!(activeSong && activeMuxPlayer && !activeMuxPlayer.paused)
    });
  } else if (activeSong) {
    // Fallback only if the shared bar module failed to load.
    bottomPlayBtn.innerHTML = !activeMuxPlayer.paused
      ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="5" width="4" height="14" fill="currentColor"/><rect x="14" y="5" width="4" height="14" fill="currentColor"/></svg>'
      : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><polygon points="6,4 20,12 6,20" fill="currentColor"/></svg>';
    songTitleEl.textContent =
      window.BurnfolderPlaybackContext && window.BurnfolderPlaybackContext.displayTitleForPlayback
        ? window.BurnfolderPlaybackContext.displayTitleForPlayback(activeSong, window.currentSongs)
        : activeSong.title;
  }
  if (activeSong) {
    bottomBar.style.display = 'flex';
    focusPlayControl();
  } else {
    bottomBar.style.display = 'none';
    if (!bar) songTitleEl.textContent = '';
  }
  syncPlaybackChromeState();
  syncTracklistPlayback();
}

function syncPlaybackChromeState() {
  const activeSong = getActiveSong();
  const barOn = bottomBar && bottomBar.style.display === 'flex';
  const active = !!activeSong && barOn;
  const playing =
    active &&
    !activeMuxPlayer.paused;
  document.body.classList.toggle('playback-active', !!active);
  document.body.classList.toggle('playback-playing', !!playing);
}

window.syncPlaybackChromeState = syncPlaybackChromeState;

function getSiteMuxPlayback() {
  if (!siteMuxPlayback && activeMuxPlayer && window.BurnfolderMuxPlayback) {
    siteMuxPlayback = window.BurnfolderMuxPlayback.create({
      getPlayer: () => activeMuxPlayer,
      recall: true,
      restoreRecall: true,
      artist: 'burnfolder',
      album: 'burnfolder.com',
      onPlayBlocked: (player) => {
        if (player) player.play().catch(() => {});
      },
      onStateChange: (detail) => {
        if (Array.isArray(detail.queue)) {
          activeQueue = detail.queue.slice();
          activeQueueIdx = typeof detail.queueIdx === 'number' ? detail.queueIdx : activeQueueIdx;
        }
        if (detail.song) {
          activeSongOverride = detail.song;
          const idx = window.currentSongs.findIndex(
            (item) => item.playbackId === detail.song.playbackId
          );
          activeIdx = idx >= 0 ? idx : null;
        }
        updateUI();
        syncPlaybackChromeState();
        syncTracklistPlayback();
      },
      onAfterStart: () => {
        if (bottomPlayBtn) focusPlayControl();
      }
    });
  }
  return siteMuxPlayback;
}

function mountNowPlayingBar() {
  if (nowPlayingBar || !window.BurnfolderNowPlayingBar) return nowPlayingBar;
  if (!songTitleEl || !songTitleEl.parentElement) return null;
  nowPlayingBar = window.BurnfolderNowPlayingBar.mount({
    barEl: bottomBar,
    titleEl: songTitleEl,
    playBtnEl: bottomPlayBtn,
    closeBtnEl: closeBtn,
    muxPlayerEl: activeMuxPlayer,
    bodyActiveClass: '',
    getActiveSong: getActiveSong,
    onTogglePlay: togglePlayPause,
    onPlayVersion: playTrackBySong,
    onClose: function () {
      if (!getActiveSong()) return;
      activeMuxPlayer.pause();
      activeIdx = null;
      activeSongOverride = null;
      activeQueue = [];
      activeQueueIdx = null;
      sessionStorage.removeItem('playbackState');
      updateUI();
    }
  });
  if (nowPlayingBar) {
    nowPlayingBar.setExtraSongs(Array.isArray(window.currentSongs) ? window.currentSongs : []);
  }
  return nowPlayingBar;
}

function startPlayback(song, queueSongs, queueIdx) {
  if (!song || !song.playbackId || !activeMuxPlayer) return;

  activeSongOverride = song;
  activeQueue = Array.isArray(queueSongs) && queueSongs.length ? queueSongs.slice() : [song];
  activeQueueIdx = typeof queueIdx === 'number' ? queueIdx : 0;
  activeIdx = window.currentSongs.findIndex((item) => item.playbackId === song.playbackId);
  if (activeIdx === -1) activeIdx = null;

  const engine = getSiteMuxPlayback();
  if (engine) {
    engine.startPlayback(song, activeQueue, activeQueueIdx, { immediatePlay: true });
  } else {
    activeMuxPlayer.pause();
    activeMuxPlayer.currentTime = 0;
    activeMuxPlayer.setAttribute('playback-id', song.playbackId);
    activeMuxPlayer.setAttribute('metadata-video-title', song.title);
    const playPromise = activeMuxPlayer.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        if (bottomPlayBtn) bottomPlayBtn.click();
      });
    }
    setTimeout(() => {
      if (activeMuxPlayer.paused && bottomPlayBtn) bottomPlayBtn.click();
      if (bottomPlayBtn) focusPlayControl();
    }, 100);
  }

  updateUI();
  setTimeout(() => {
    initializeVolumeControl();
  }, 100);
}

function playTrack(idx) {
  const song = window.currentSongs[idx];
  if (!song) return;
  startPlayback(song, window.currentSongs, idx);
}

function playTrackQueue(queueSongs, queueStartIdx) {
  if (!Array.isArray(queueSongs) || !queueSongs.length) return;
  const start = typeof queueStartIdx === 'number' ? queueStartIdx : 0;
  const song = queueSongs[start];
  if (!song) return;
  startPlayback(song, queueSongs, start);
}

window.playTrackQueue = playTrackQueue;

function playQueuedTrack(queueIdx) {
  const song = activeQueue && activeQueue[queueIdx];
  if (!song) return;
  const engine = getSiteMuxPlayback();
  if (engine) {
    engine.startPlayback(song, activeQueue, queueIdx, { immediatePlay: true });
    return;
  }
  startPlayback(song, activeQueue, queueIdx);
}

function togglePlayPause() {
  if (!getActiveSong()) return;
  const engine = getSiteMuxPlayback();
  if (engine) {
    engine.togglePlayPause();
    return;
  }
  if (activeMuxPlayer.paused) {
    activeMuxPlayer.play();
  } else {
    activeMuxPlayer.pause();
  }
  updateUI();
}

// Play/pause button click is wired through BurnfolderNowPlayingBar (onTogglePlay).

function isTypingTarget(target) {
  const el = target && target.nodeType === 1 ? target : null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(el.closest('[contenteditable="true"]'));
}

document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' && e.key !== ' ') return;
  if (e.defaultPrevented) return;
  if (!getActiveSong()) return;
  const barOpen =
    (bottomBar && bottomBar.style.display === 'flex') ||
    document.body.classList.contains('now-playing-active') ||
    document.body.classList.contains('stream-playback-active');
  if (!barOpen) return;
  if (isTypingTarget(e.target)) return;
  e.preventDefault();
  e.stopPropagation();
  togglePlayPause();
  // Keep focus off the bar — :focus-visible inverts the button on every Space press.
  if (bottomPlayBtn && bottomPlayBtn.blur) bottomPlayBtn.blur();
});

// Close button is wired through BurnfolderNowPlayingBar onClose (see mountNowPlayingBar).

// Buffering spinner removed: it shifted the bottom-bar buttons on every track start.
function showLoading() {
  if (loadingSpinner) loadingSpinner.style.display = 'none';
}

// Progress fill/playhead are driven by shared/now-playing-bar.js (timeupdate/loadedmetadata).
// Queue advance, lock-screen handoff, and recall are handled by BurnfolderMuxPlayback.
// Progress-bar seek (click + drag + touch) and hover timestamp are handled by
// shared/now-playing-bar.js, which is mounted via mountNowPlayingBar().

function applyVolumeToPlayer() {
  if (!activeMuxPlayer) return;
  try {
    const mediaElement = activeMuxPlayer.media || activeMuxPlayer;
    if (mediaElement) {
      mediaElement.volume = 1;
      mediaElement.muted = false;
    }
  } catch (_) {
    /* ignore */
  }
}

function initializeVolumeControl() {
  applyVolumeToPlayer();
}

try {
  createTipUI();
} catch (err) {
  console.warn('Tip UI setup failed:', err);
}
