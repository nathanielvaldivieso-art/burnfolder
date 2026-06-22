/**
 * Generate public-site artifacts from a block-based entry draft.
 * Used by studio publish panel and entry editor outputs.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.BurnfolderPublish = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : {}, function () {
  'use strict';

  const SCRIPT_VERSION = '20260601a';

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeJsString(value) {
    return JSON.stringify(String(value || ''));
  }

  function normalizeSpacingSize(size) {
    return size === 'sm' || size === 'lg' ? size : 'md';
  }

  function normalizeTextSize(size) {
    return size === 'sm' || size === 'lg' ? size : 'md';
  }

  function textParagraphClass(block) {
    const size = normalizeTextSize(block && block.textSize);
    return size === 'md' ? 'page-annotation' : 'page-annotation entry-text--' + size;
  }

  function textToHtml(value) {
    return escapeHtml(value).replace(/\n/g, '<br>');
  }

  function textBlockHasRenderableContent(text) {
    const raw = String(text || '');
    return raw.length > 0 && (raw.trim().length > 0 || raw.includes('\n'));
  }

  function renderTextBlockHtml(value) {
    const raw = String(value || '');
    if (!textBlockHasRenderableContent(raw)) return '';
    const trimmed = raw.trim();
    if (trimmed && typeof globalThis !== 'undefined' && globalThis.isEntryTextHtml && globalThis.isEntryTextHtml(trimmed)) {
      return globalThis.sanitizeEntryTextHtml(trimmed);
    }
    return textToHtml(raw);
  }

  function spacingBlockHtml(block) {
    const size = normalizeSpacingSize(block.size);
    return `  <div class="entry-spacing entry-spacing--${size}" aria-hidden="true"></div>`;
  }

  function cleanBlockForData(block) {
    if (block.type === 'text') {
      return {
        type: 'text',
        text: block.text || '',
        textSize: normalizeTextSize(block.textSize)
      };
    }
    if (block.type === 'spacing') {
      return { type: 'spacing', size: normalizeSpacingSize(block.size) };
    }
    if (block.type === 'image') return { type: 'image', src: block.src || '', alt: block.alt || '' };
    if (block.type === 'audio') return { type: 'audio', title: block.title || '', playbackId: block.playbackId || '' };
    if (block.type === 'video') return { type: 'video', title: block.title || '', playbackId: block.playbackId || '' };
    if (block.type === 'album') {
      return {
        type: 'album',
        title: block.title || '',
        coverArt: block.coverArt || '',
        coverAlt: block.coverAlt || '',
        tracks: (block.tracks || []).map(track => ({
          title: track.title || '',
          playbackId: track.playbackId || ''
        }))
      };
    }
    if (block.type === 'playlist') {
      return {
        type: 'playlist',
        playlistId: block.playlistId || block.id || '',
        title: block.title || '',
        coverArt: block.coverArt || '',
        coverAlt: block.coverAlt || '',
        tracks: (block.tracks || []).map(track => ({
          title: track.title || '',
          playbackId: track.playbackId || ''
        }))
      };
    }
    return { type: block.type };
  }

  function stripEditorIds(blocks) {
    return (blocks || []).map(block => {
      const copy = { ...block };
      delete copy.id;
      if (Array.isArray(copy.tracks)) {
        copy.tracks = copy.tracks.map(track => {
          const t = { ...track };
          delete t.id;
          return t;
        });
      }
      return copy;
    });
  }

  function getAudioFromBlocks(blocks) {
    return (blocks || []).flatMap(block => {
      if (block.type === 'audio' && (block.title || block.playbackId)) {
        return [{
          title: block.title,
          playbackId: block.playbackId,
          album: undefined,
          coverArt: undefined
        }];
      }
      if (block.type === 'album' && Array.isArray(block.tracks)) {
        return block.tracks
          .filter(track => track.title || track.playbackId)
          .map(track => ({
            title: track.title,
            playbackId: track.playbackId,
            album: block.title || undefined,
            coverArt: block.coverArt || undefined
          }));
      }
      if (block.type === 'playlist' && Array.isArray(block.tracks)) {
        return block.tracks
          .filter(track => track.playbackId)
          .map(track => ({
            title: track.title,
            playbackId: track.playbackId,
            playlist: block.playlistId || block.id,
            coverArt: block.coverArt || undefined
          }));
      }
      return [];
    });
  }

  function playlistRootClass(block) {
    const hasTitle = !!(block.title && String(block.title).trim());
    const hasCover = !!(block.coverArt && String(block.coverArt).trim());
    const parts = ['entry-playlist'];
    if (hasCover) parts.push('entry-playlist--has-cover');
    if (hasTitle) parts.push('entry-playlist--has-title');
    if (!hasCover && !hasTitle) parts.push('entry-playlist--minimal');
    return parts.join(' ');
  }

  function blockToHtml(block) {
    if (block.type === 'text' && textBlockHasRenderableContent(block.text)) {
      return `  <p class="${textParagraphClass(block)}">${renderTextBlockHtml(block.text)}</p>`;
    }
    if (block.type === 'spacing') return spacingBlockHtml(block);
    if (block.type === 'image' && block.src && String(block.src).trim()) {
      return `  <img src="${escapeHtml(String(block.src).trim())}" alt="${escapeHtml(block.alt || '')}" class="page-img">`;
    }
    if (block.type === 'video' && block.playbackId && String(block.playbackId).trim()) {
      const title = (block.title && String(block.title).trim()) || 'video';
      return `  <mux-player
    playback-id="${escapeHtml(String(block.playbackId).trim())}"
    metadata-video-title="${escapeHtml(title)}"
    playbackrates="1 1.5 2"
    noairplay
    class="page-inline-video"
    style="width:100%;margin-bottom:24px;"
  ></mux-player>`;
    }
    if (block.type === 'audio' && block.playbackId && String(block.playbackId).trim()) {
      return `  <div class="entry-audio-list" data-playback-id="${escapeHtml(String(block.playbackId).trim())}"></div>`;
    }
    if (block.type === 'album') {
      const albumParts = ['  <div class="entry-album">'];
      if (block.coverArt && String(block.coverArt).trim()) {
        albumParts.push(
          `    <img src="${escapeHtml(String(block.coverArt).trim())}" alt="${escapeHtml(block.coverAlt || block.title || 'album cover')}" class="entry-album-cover">`
        );
      }
      if (block.title && String(block.title).trim()) {
        albumParts.push(`    <p class="entry-album-title">${escapeHtml(String(block.title).trim())}</p>`);
        albumParts.push(`    <div class="entry-audio-list" data-album="${escapeHtml(String(block.title).trim())}" style="margin-top: 24px;"></div>`);
      }
      albumParts.push('  </div>');
      return albumParts.length > 2 ? albumParts.join('\n') : '';
    }
    const playlistKey = block.playlistId || block.id;
    if (block.type === 'playlist' && playlistKey && Array.isArray(block.tracks)) {
      const hasTracks = block.tracks.some(track => track.playbackId);
      if (!hasTracks) return '';
      const parts = [`  <div class="${playlistRootClass(block)}">`];
      if (block.coverArt && String(block.coverArt).trim()) {
        parts.push(
          `    <img src="${escapeHtml(String(block.coverArt).trim())}" alt="${escapeHtml(block.coverAlt || block.title || 'cover art')}" class="entry-playlist-cover">`
        );
      }
      if (block.title && String(block.title).trim()) {
        parts.push(`    <p class="entry-playlist-title">${escapeHtml(String(block.title).trim())}</p>`);
      }
      parts.push(`    <div class="entry-audio-list" data-playlist="${escapeHtml(String(playlistKey))}"></div>`);
      parts.push('  </div>');
      return parts.join('\n');
    }
    return '';
  }

  function buildEntryHtml(entry, scriptVersion) {
    const version = scriptVersion || SCRIPT_VERSION;
    const blocks = entry.blocks || [];
    const bodyParts = [`  <p class="page-id">${escapeHtml(entry.date)}</p>`];

    blocks.forEach(block => {
      const html = blockToHtml(block);
      if (html) bodyParts.push(html);
    });

    if (!blocks.some(block => block.type === 'audio' || block.type === 'album' || block.type === 'playlist')) {
      bodyParts.push('  <div id="audioList" style="margin-top: 48px;"></div>');
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(entry.date)}</title>
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="preconnect" href="https://stream.mux.com" crossorigin>
<link rel="preconnect" href="https://image.mux.com" crossorigin>
<link rel="dns-prefetch" href="https://www.mux.com">
<script src="https://cdn.jsdelivr.net/npm/@mux/mux-player" defer></script>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header class="site-header">
  <a href="index.html" class="site-brand">burnfolder.com</a>
  <nav class="site-nav" aria-label="Primary">
    <a href="music.html" class="page-nav">music</a>
    <a href="content.html" class="page-nav">video</a>
    <a href="shop.html" class="page-nav">shop</a>
  </nav>
  <a href="cart.html" class="icon-btn site-cart-btn site-cart-btn--hidden" id="cartFloat" title="View cart">cart</a>
</header>

<div class="page-wrap">
${bodyParts.join('\n\n')}
</div>

<div class="page-watermark">${escapeHtml(entry.date)}</div>

<!-- bottom player - do not modify -->
<div class="bottom-progress-bar" id="bottomBar">
  <div class="close-btn" id="closeBtn" aria-label="Close Now Playing">&times;</div>
  <div class="bottom-bar-content">
    <mux-player id="activeMuxPlayer" style="width:0;height:0;position:absolute;left:-9999px;"></mux-player>
    <span class="song-title" id="songTitle">Track Title</span>
    <div class="bottom-bar-controls">
      <button class="bottom-play-pause-btn" id="bottomPlayPause" aria-label="Play/Pause">&#9654;</button>
      <div class="progress-bar-area" id="progressBarArea">
        <div class="progress" id="progress"></div>
        <div class="progress-playhead" id="progressPlayhead"></div>
      </div>
    </div>
    <div class="loading-spinner" id="loadingSpinner"></div>
  </div>
</div>
<script src="entries.js"></script>
<script src="entry-renderer.js"></script>
<script src="songs.js"></script>
<script src="stripe-publishable.js"></script>
<script src="spa-router.js"></script>
<script src="shared/song-versions.js?v=${version}"></script>
<script src="shared/playback-prefetch.js?v=${version}"></script>
<script src="shared/mux-playback.js?v=${version}"></script>
<script src="scripts.js?v=${version}"></script>
<script src="shared/register-sw.js"></script>
</body>
</html>
`;
  }

  function buildEntryDataSnippet(entry) {
    const data = {
      date: entry.date,
      blocks: stripEditorIds(entry.blocks || []).map(cleanBlockForData)
    };
    return `  ${escapeJsString(entry.date)}: ${JSON.stringify(data, null, 2).replace(/\n/g, '\n  ')},`;
  }

  function buildSongsSnippet(entry) {
    const songs = entry.songs || getAudioFromBlocks(entry.blocks);
    const tracks = songs
      .filter(song => song.title && String(song.title).trim() && song.playbackId && String(song.playbackId).trim())
      .map(song => {
        const fields = [
          `title: ${escapeJsString(String(song.title).trim())}`,
          `playbackId: ${escapeJsString(String(song.playbackId).trim())}`
        ];
        if (song.album) fields.push(`album: ${escapeJsString(song.album)}`);
        if (song.playlist) fields.push(`playlist: ${escapeJsString(song.playlist)}`);
        if (song.coverArt) fields.push(`coverArt: ${escapeJsString(song.coverArt)}`);
        return `    { ${fields.join(', ')} }`;
      });

    if (!tracks.length) {
      return `  // no manual songs.js entry needed — tracks may come from entries.js blocks`;
    }

    return `  ${escapeJsString(entry.date)}: [
${tracks.join(',\n')}
  ],`;
  }

  function buildJournalLine(entry, existingJournal) {
    const existing = Array.isArray(existingJournal) ? existingJournal : [];
    const next = [entry.date].concat(existing.filter(item => item !== entry.date));
    return `window.journalEntries = ${JSON.stringify(next)};`;
  }

  function buildPublishArtifacts(entry, options) {
    const opts = options || {};
    const normalized = {
      date: entry.date,
      blocks: stripEditorIds(entry.blocks || []),
      songs: entry.songs || getAudioFromBlocks(entry.blocks)
    };

    return {
      date: normalized.date,
      entryHtml: buildEntryHtml(normalized, opts.scriptVersion),
      entriesJsSnippet: buildEntryDataSnippet(normalized),
      songsJsSnippet: buildSongsSnippet(normalized),
      journalJsLine: buildJournalLine(normalized, opts.existingJournal),
      publishUrl: `https://burnfolder.com/${normalized.date}.html`,
      checklist: [
        `merge entries.js snippet for "${normalized.date}"`,
        `save ${normalized.date}.html to repo root`,
        `update window.journalEntries in songs.js (newest first)`,
        `video blocks in entries.js appear on the video page automatically`,
        `deploy burnfolder.com on Netlify`,
        `confirm ${normalized.date}.html loads on production`,
        `newsletter: GitHub Action should email subscribers with link to publishUrl`
      ]
    };
  }

  return {
    SCRIPT_VERSION,
    buildPublishArtifacts,
    buildEntryHtml,
    buildEntryDataSnippet,
    buildSongsSnippet,
    buildJournalLine,
    cleanBlockForData,
    stripEditorIds
  };
});
