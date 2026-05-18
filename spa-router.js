// SPA Router for seamless navigation without stopping audio playback

(function() {
  'use strict';

  // Main content container
  let contentContainer;

  // Initialize SPA router
  function initRouter() {
    // Create content container if it doesn't exist
    contentContainer = document.getElementById('spa-content');
    if (!contentContainer) {
      contentContainer = document.createElement('div');
      contentContainer.id = 'spa-content';
      // Move all body content except bottom bar into container
      const bottomBar = document.getElementById('bottomBar');
      while (document.body.firstChild && document.body.firstChild !== bottomBar) {
        contentContainer.appendChild(document.body.firstChild);
      }
      document.body.insertBefore(contentContainer, bottomBar);
    }

    // Intercept all internal link clicks
    document.addEventListener('click', handleLinkClick);

    // Handle browser back/forward
    window.addEventListener('popstate', handlePopState);

    // Render songs for the initial page load
    updateAudioListForPage();
  }

  function handleLinkClick(e) {
    const link = e.target.closest('a');
    if (!link) return;

    const href = link.getAttribute('href');
    if (!href) return;

    // Only intercept internal links (not external, mailto, etc)
    if (href.startsWith('http') || href.startsWith('mailto') || href.startsWith('#')) {
      return;
    }

    // Prevent default navigation
    e.preventDefault();

    // Navigate to the new page
    navigateTo(href);
  }

  function handlePopState(e) {
    // Load the page from the URL
    loadPage(window.location.pathname);
  }

  async function navigateTo(url) {
    // Update URL without reload
    history.pushState({}, '', url);
    
    // Load the new content
    await loadPage(url);
  }

  async function loadPage(url) {
    try {
      // Fetch the new page
      const response = await fetch(url);
      if (!response.ok) throw new Error('Page not found');
      
      const html = await response.text();
      
      // Parse the HTML
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      // Extract the body content (excluding scripts and bottom bar)
      const newContent = document.createElement('div');
      const bodyChildren = Array.from(doc.body.children);
      
      bodyChildren.forEach(child => {
        // Skip the bottom bar and script tags
        if (child.id !== 'bottomBar' && child.tagName !== 'SCRIPT') {
          newContent.appendChild(child.cloneNode(true));
        }
      });

      // Update page title
      document.title = doc.title;

      // Keep body flags in sync so route-specific CSS (e.g. index newsletter dock) applies after SPA navigation
      document.body.className = doc.body.className;

      // Replace content
      contentContainer.innerHTML = '';
      contentContainer.appendChild(newContent);

      // Re-initialize any page-specific scripts
      reinitializePageScripts();

      if (typeof window.syncPlaybackChromeState === 'function') {
        window.syncPlaybackChromeState();
      }

      // Scroll to top
      window.scrollTo(0, 0);

    } catch (error) {
      console.error('Navigation error:', error);
      // Fall back to normal navigation
      window.location.href = url;
    }
  }

  function reinitializePageScripts() {
    if (typeof window.renderDataEntryPage === 'function') {
      window.renderDataEntryPage();
    }

    // Re-run entry list population for index page
    const entriesContainer = document.getElementById('entries');
    if (entriesContainer && entriesContainer.children.length === 0) {
      const entries = window.journalEntries || [];
      entries.forEach(entry => {
        const li = document.createElement("li");
        const link = document.createElement("a");
        link.href = `${entry}.html`;
        link.textContent = entry;
        li.appendChild(link);
        entriesContainer.appendChild(li);
      });
    }

    // Newsletter uses a single document-level submit handler (see bindNewsletterOnce below)

    // Update audio and video lists for current page
    updateAudioListForPage();
    updateVideoListForPage();

    // Re-render song hub page content when present
    if (typeof window.renderSongHubPage === 'function') {
      window.renderSongHubPage();
    }
  }

  function updateAudioListForPage() {
    // Determine the current page key from the URL (not document.title)
    const pathParts = window.location.pathname.split('/');
    const pageKey = pathParts[pathParts.length - 1].replace('.html', '') || 'index';

    const noAudioListPages = new Set(['index', 'shop', 'cart', 'checkout', 'cancel', 'success']);
    if (noAudioListPages.has(pageKey)) {
      window.currentSongs = [];
    } else if (window.songsByPage && window.songsByPage[pageKey]) {
      window.currentSongs = window.songsByPage[pageKey];
    } else {
      window.currentSongs = window.allSongs || [];
    }

    const songs = window.currentSongs;

    // Helper: build a page-song-title row and wire it up
    function makeSongRow(song, idx, idPrefix) {
      const wrap = document.createElement('div');
      wrap.className = 'mux-audio-container';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'page-song-title';
      if (idPrefix) titleSpan.id = idPrefix + (idx + 1);
      titleSpan.setAttribute('tabindex', '0');
      titleSpan.setAttribute('role', 'button');
      titleSpan.setAttribute('aria-label', 'Play ' + song.title);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'audio-track-name';
      nameSpan.textContent = song.title;

      const durSpan = document.createElement('span');
      durSpan.className = 'song-duration';
      durSpan.textContent = '--:--';

      titleSpan.appendChild(nameSpan);
      titleSpan.appendChild(durSpan);

      titleSpan.addEventListener('click', function() { playTrack(idx); });
      titleSpan.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (typeof activeIdx !== 'undefined' && activeIdx === idx && typeof togglePlayPause === 'function') {
            togglePlayPause();
          } else {
            playTrack(idx);
          }
        }
      });

      // Preload duration
      const tmp = document.createElement('mux-player');
      tmp.setAttribute('playback-id', song.playbackId);
      tmp.style.display = 'none';
      tmp.muted = true;
      document.body.appendChild(tmp);
      tmp.addEventListener('loadedmetadata', function() {
        const d = tmp.duration;
        if (d && !isNaN(d)) {
          const m = Math.floor(d / 60);
          const s = Math.floor(d % 60);
          durSpan.textContent = m + ':' + (s < 10 ? '0' : '') + s;
        }
        tmp.remove();
      }, { once: true });

      wrap.appendChild(titleSpan);

      return wrap;
    }

    function getSongsForContainer(container) {
      if (container.dataset.album) {
        return songs
          .map((song, idx) => ({ song, idx }))
          .filter(item => item.song.album === container.dataset.album);
      }

      if (container.dataset.playbackId) {
        const exactMatches = songs
          .map((song, idx) => ({ song, idx }))
          .filter(item => item.song.playbackId === container.dataset.playbackId);
        const nonAlbumMatches = exactMatches.filter(item => !item.song.album);
        return nonAlbumMatches.length ? nonAlbumMatches : exactMatches;
      }

      return songs.map((song, idx) => ({ song, idx }));
    }

    const scopedAudioLists = Array.from(document.querySelectorAll('.entry-audio-list'));
    if (scopedAudioLists.length) {
      scopedAudioLists.forEach((listEl, listIdx) => {
        listEl.innerHTML = '';
        getSongsForContainer(listEl).forEach(({ song, idx }) => {
          const row = makeSongRow(song, idx, `pageSongTitle${listIdx}-`);
          listEl.appendChild(row);
        });
      });
      return;
    }

    // ── Regular audioList pages ────────────────────────────────────────────
    const audioListEl = document.getElementById('audioList');
    if (!audioListEl || audioListEl.style.display === 'none') return;

    audioListEl.innerHTML = '';
    songs.forEach(function(song, idx) {
      const row = makeSongRow(song, idx, 'pageSongTitle');
      audioListEl.appendChild(row);
    });
  }

  function updateVideoListForPage() {
    const videoListEl = document.getElementById('videoList');
    if (!videoListEl || !window.allVideos) return;
    videoListEl.innerHTML = '';
    window.allVideos.forEach(function(video) {
      const entry = document.createElement('div');
      entry.className = 'video-entry';

      const player = document.createElement('mux-player');
      player.setAttribute('playback-id', video.playbackId);
      player.setAttribute('metadata-video-title', video.title);
      player.setAttribute('playbackrates', '1 1.5 2');
      player.setAttribute('noairplay', '');
      player.classList.add('page-inline-video');
      entry.appendChild(player);

      if (video.page && /^\d/.test(video.page)) {
        const meta = document.createElement('div');
        meta.className = 'song-date-link';
        const link = document.createElement('a');
        link.href = video.page + '.html';
        link.textContent = video.page;
        meta.appendChild(link);
        entry.appendChild(meta);
      }

      videoListEl.appendChild(entry);
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRouter);
  } else {
    initRouter();
  }

  // Single delegated handler — survives SPA swaps without duplicate listeners
  document.addEventListener('submit', async function onBurnfolderSubscribe(e) {
    const form = e.target.closest('#subscribeForm');
    if (!form) return;
    e.preventDefault();
    const emailInput = document.getElementById('emailInput');
    const statusMsg = document.getElementById('statusMessage');
    if (!emailInput || !statusMsg) return;

    const email = emailInput.value;
    const host = typeof location !== 'undefined' ? location.hostname : '';
    const isLocal = host === 'localhost' || host === '127.0.0.1';

    statusMsg.textContent = 'subscribing...';
    statusMsg.style.color = '#666';

    if (isLocal) {
      statusMsg.textContent =
        'subscribe needs netlify (deploy or netlify dev). not sent from local preview.';
      statusMsg.style.color = '#000';
      return;
    }

    try {
      const response = await fetch('/.netlify/functions/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await response.json();
      if (response.ok) {
        statusMsg.textContent = data.message || '✓ subscribed';
        statusMsg.style.color = '#000';
        emailInput.value = '';
      } else {
        statusMsg.textContent = data.message || 'error — try again';
        statusMsg.style.color = '#000';
      }
    } catch {
      statusMsg.textContent = 'error — try again';
      statusMsg.style.color = '#000';
    }
  });

})();
