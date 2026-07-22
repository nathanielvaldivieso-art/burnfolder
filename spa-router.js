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
      // Move all body content except bottom bar + persistent chrome into container
      const bottomBar = document.getElementById('bottomBar');
      const preserved = [];
      while (document.body.firstChild && document.body.firstChild !== bottomBar) {
        const child = document.body.firstChild;
        if (
          child.id === 'bfSkinToggle' ||
          child.id === 'siteMenu' ||
          child.id === 'cartFloat' ||
          child.id === 'skinMapPhotonegative' ||
          (child.classList && child.classList.contains('skin-map__scroll-room')) ||
          (child.getAttribute && child.getAttribute('data-bf-skin-chrome') === '1')
        ) {
          preserved.push(child);
          document.body.removeChild(child);
          continue;
        }
        contentContainer.appendChild(child);
      }
      document.body.insertBefore(contentContainer, bottomBar);
      preserved.forEach(function (node) {
        document.body.insertBefore(node, contentContainer);
      });
    }

    // Intercept all internal link clicks
    document.addEventListener('click', handleLinkClick);

    // Handle browser back/forward
    window.addEventListener('popstate', handlePopState);

    // Warm likely next pages in the background (HTML only — keeps audio SPA snappy)
    prefetchNavPages();

    // Render songs for the initial page load
    updateAudioListForPage();
    if (typeof window.mountSiteMenu === 'function') {
      window.mountSiteMenu();
    }
    reinitializePageScripts();
  }

  function prefetchNavPages() {
    const warm = function () {
      document.querySelectorAll('.site-nav a[href], .page-nav[href]').forEach(function (link) {
        const href = link.getAttribute('href');
        if (!href || href.indexOf('.html') === -1) return;
        if (document.querySelector('link[rel="prefetch"][href="' + href + '"]')) return;
        const hint = document.createElement('link');
        hint.rel = 'prefetch';
        hint.href = href;
        hint.as = 'document';
        document.head.appendChild(hint);
      });
    };
    if ('requestIdleCallback' in window) {
      requestIdleCallback(warm, { timeout: 3000 });
    } else {
      setTimeout(warm, 1500);
    }
  }

  function hubPageName(pathname) {
    const raw = String(pathname || '')
      .split('?')[0]
      .split('#')[0]
      .replace(/\/+$/, '');
    const base = raw.split('/').pop() || '';
    return base.toLowerCase();
  }

  // Album/song hubs ship their own script boot (album-pages.js, render APIs).
  // Soft-swapping their HTML into another page leaves the empty shell until refresh.
  function isHubNavigation(href, baseHref) {
    if (!href) return false;
    try {
      const resolved = new URL(href, baseHref || window.location.href);
      if (resolved.origin !== window.location.origin) return false;
      const name = hubPageName(resolved.pathname);
      return (
        name === 'album.html' ||
        name === 'song.html' ||
        name === 'album' ||
        name === 'song'
      );
    } catch (_) {
      const path = String(href).split('?')[0].split('#')[0];
      const name = hubPageName(path);
      return (
        name === 'album.html' ||
        name === 'song.html' ||
        name === 'album' ||
        name === 'song'
      );
    }
  }

  // Index home uses the photonegative skin + gate boot — soft swap leaves the
  // old stage visible (URL changes but archive/shop/etc. never mount).
  function leavingIndexHome(href, baseHref) {
    if (!document.body || !document.body.classList.contains('index-home')) return false;
    if (!href) return false;
    try {
      const resolved = new URL(href, baseHref || window.location.href);
      if (resolved.origin !== window.location.origin) return false;
      return !isIndexPathname(resolved.pathname);
    } catch (_) {
      return !isIndexPathname(String(href).split('?')[0].split('#')[0]);
    }
  }

  function isIndexPathname(pathname) {
    const name = hubPageName(pathname);
    return !name || name === 'index' || name === 'index.html';
  }

  function resolvePath(url, baseHref) {
    try {
      return new URL(url, baseHref || window.location.href).pathname;
    } catch (_) {
      return String(url || '').split('?')[0].split('#')[0];
    }
  }

  // Index skin CSS + gate boot only ship on index.html — never SPA-swap the landing.
  function enteringIndexHome(href, baseHref) {
    if (!href) return false;
    try {
      const resolved = new URL(href, baseHref || window.location.href);
      if (resolved.origin !== window.location.origin) return false;
      return isIndexPathname(resolved.pathname);
    } catch (_) {
      return isIndexPathname(resolvePath(href, baseHref));
    }
  }

  function isAudioPathname(pathname) {
    const name = hubPageName(pathname);
    return name === 'audio' || name === 'audio.html';
  }

  // Hard-load audio when photonegative.css isn't present (index scroll keeps it in-DOM).
  function enteringAudioPage(href, baseHref) {
    if (document.body && document.body.classList.contains('index-home')) return false;
    if (document.querySelector('link[href*="photonegative.css"]')) return false;
    if (!href) return false;
    try {
      const resolved = new URL(href, baseHref || window.location.href);
      if (resolved.origin !== window.location.origin) return false;
      return isAudioPathname(resolved.pathname);
    } catch (_) {
      return isAudioPathname(resolvePath(href, baseHref));
    }
  }

  function shouldHardNavigate(href, baseHref) {
    return (
      isHubNavigation(href, baseHref) ||
      leavingIndexHome(href, baseHref) ||
      enteringIndexHome(href, baseHref) ||
      enteringAudioPage(href, baseHref)
    );
  }

  function hardNavigate(url) {
    window.location.assign(url);
  }

  function albumHubCanRender() {
    return !!(window.burnfolderAlbumPages && window.BurnfolderAlbumPageRender);
  }

  function songHubCanRender() {
    return !!(window.burnfolderSongPages && window.BurnfolderSongPageRender);
  }

  function handleLinkClick(e) {
    if (e.defaultPrevented) return;
    const link = e.target.closest('a');
    if (!link) return;
    if (link.getAttribute('data-skin-set')) return;

    const href = link.getAttribute('href');
    if (!href) return;

    // Only intercept internal links (not external, mailto, etc)
    if (href.startsWith('http') || href.startsWith('mailto') || href.startsWith('#')) {
      return;
    }

    // Gate → audio: one-way soft enter (Mux only after leaving index-home).
    try {
      const resolvedAudio = new URL(href, link.href || window.location.href);
      if (
        document.body &&
        document.body.classList.contains('index-home') &&
        resolvedAudio.origin === window.location.origin &&
        isAudioPathname(resolvedAudio.pathname) &&
        window.BurnfolderSoftEnterAudio &&
        typeof window.BurnfolderSoftEnterAudio.enter === 'function' &&
        window.BurnfolderSoftEnterAudio.isEnabled()
      ) {
        e.preventDefault();
        window.BurnfolderSoftEnterAudio.enter();
        return;
      }
    } catch (_) {
      /* fall through */
    }

    // Full document load so hub boot scripts actually run.
    if (shouldHardNavigate(href, link.href || window.location.href)) {
      return;
    }

    // Prevent default navigation
    e.preventDefault();

    // Navigate to the new page
    navigateTo(href);
  }

  function handlePopState(e) {
    const dest =
      window.location.pathname + window.location.search + window.location.hash;
    if (shouldHardNavigate(dest)) {
      hardNavigate(dest);
      return;
    }
    loadPage(dest);
  }

  async function navigateTo(url) {
    if (shouldHardNavigate(url)) {
      hardNavigate(url);
      return;
    }

    // Update URL without reload
    history.pushState({}, '', url);
    
    // Load the new content
    await loadPage(url);
  }

  async function loadPage(url) {
    const path = resolvePath(url);
    if (isIndexPathname(path)) {
      hardNavigate(url);
      return;
    }
    if (isAudioPathname(path) && !document.querySelector('link[href*="photonegative.css"]')) {
      hardNavigate(url);
      return;
    }

    if (shouldHardNavigate(url)) {
      hardNavigate(url);
      return;
    }

    try {
      // Fetch the new page
      const response = await fetch(url);
      if (!response.ok) throw new Error('Page not found');
      
      const html = await response.text();
      
      // Parse the HTML
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      // Extract the body content (excluding scripts and bottom bar)
      const bodyChildren = Array.from(doc.body.children);
      
      contentContainer.innerHTML = '';
      bodyChildren.forEach(child => {
        // Skip the bottom bar and script tags
        if (
          child.id !== 'bottomBar' &&
          child.id !== 'siteMenu' &&
          child.id !== 'cartFloat' &&
          child.id !== 'skinMapPhotonegative' &&
          child.tagName !== 'SCRIPT'
        ) {
          contentContainer.appendChild(child.cloneNode(true));
        }
      });

      // Update page title
      document.title = doc.title;

      // Keep body flags in sync so route-specific CSS (e.g. index newsletter dock) applies after SPA navigation
      // Preserve playback chrome classes — audio + bar must survive soft nav.
      const keepPlaybackClasses = ['playback-active', 'playback-playing', 'stream-playback-active', 'now-playing-active'];
      const preserved = keepPlaybackClasses.filter(function (cls) {
        return document.body.classList.contains(cls);
      });
      document.body.className = doc.body.className;
      preserved.forEach(function (cls) {
        document.body.classList.add(cls);
      });

      // Replace content
      // (contentContainer already cleared and filled above)

      // Hub shells cannot render without their page-specific scripts — hard-load instead.
      if (document.getElementById('albumHubPage') && !albumHubCanRender()) {
        hardNavigate(url);
        return;
      }
      if (document.getElementById('songHubPage') && !songHubCanRender()) {
        hardNavigate(url);
        return;
      }

      // Re-initialize any page-specific scripts
      if (typeof window.mountSiteMenu === 'function') {
        window.mountSiteMenu();
      }
      reinitializePageScripts();

      if (document.body.classList.contains('page-audio')) {
        const gate = document.getElementById('skinMapPhotonegative');
        if (gate) gate.hidden = true;
        if (window.BurnfolderHomeMusic) {
          if (typeof window.BurnfolderHomeMusic.mountLinks === 'function') {
            window.BurnfolderHomeMusic.mountLinks();
          }
          if (typeof window.BurnfolderHomeMusic.bindPlayback === 'function') {
            window.BurnfolderHomeMusic.bindPlayback();
          }
        }
      }

      if (typeof window.preservePlaybackAcrossNavigation === 'function') {
        window.preservePlaybackAcrossNavigation();
      } else if (typeof window.syncPlaybackChromeState === 'function') {
        window.syncPlaybackChromeState();
      }

      // Final guard: if mux is still playing, the bar must be visible.
      const liveBar = document.getElementById('bottomBar');
      const livePlayer = document.getElementById('activeMuxPlayer');
      if (
        liveBar &&
        livePlayer &&
        livePlayer.getAttribute('playback-id') &&
        !livePlayer.paused
      ) {
        liveBar.style.display = 'flex';
        document.body.classList.add('playback-active', 'playback-playing');
      }

      // Scroll to top
      window.scrollTo(0, 0);

      try {
        window.dispatchEvent(
          new CustomEvent('burnfolder-spa-navigated', { detail: { url: url } })
        );
      } catch (e) {
        /* noop */
      }

    } catch (error) {
      console.error('Navigation error:', error);
      // Fall back to normal navigation
      hardNavigate(url);
    }
  }

  function reinitializePageScripts() {
    if (typeof window.renderDataEntryPage === 'function') {
      window.renderDataEntryPage();
    }

    // Re-run entry list population for archive page
    if (typeof window.renderArchivePage === 'function') {
      window.renderArchivePage();
    }

    if (typeof window.mountSiteMenu === 'function') {
      window.mountSiteMenu();
    }

    // Newsletter uses a single document-level submit handler (see bindNewsletterOnce below)

    // Update audio and video lists for current page
    updateAudioListForPage();
    updateVideoListForPage();

    // Re-render song hub page content when present
    if (typeof window.renderSongHubPage === 'function') {
      window.renderSongHubPage();
    }

    // Re-render album hub page content when present
    if (typeof window.renderAlbumHubPage === 'function') {
      window.renderAlbumHubPage();
    } else if (
      window.BurnfolderAlbumHubBoot &&
      typeof window.BurnfolderAlbumHubBoot.schedule === 'function'
    ) {
      window.BurnfolderAlbumHubBoot.schedule();
    }
  }

  function updateAudioListForPage() {
    // Determine the current page key from the URL (not document.title)
    const pathParts = window.location.pathname.split('/');
    const pageKey = pathParts[pathParts.length - 1].replace('.html', '') || 'index';

    const noAudioListPages = new Set([
      'index',
      'archive',
      'shop',
      'cart',
      'checkout',
      'cancel',
      'success',
      'about',
      'contact',
      'press',
      'content'
    ]);
    if (noAudioListPages.has(pageKey)) {
      window.currentSongs = [];
    } else if (window.songsByPage && window.songsByPage[pageKey]) {
      window.currentSongs = window.songsByPage[pageKey];
    } else {
      window.currentSongs = window.allSongs || [];
    }

    const songs = window.currentSongs;

    function trackDisplayTitle(song, inAlbum) {
      if (typeof window.getTracklistDisplayTitle === 'function') {
        return window.getTracklistDisplayTitle(song, { inAlbum: inAlbum });
      }
      return song.title;
    }

    function renderTracklist(container, songIdxPairs, inAlbum) {
      if (typeof fillTracklistContainer !== 'function') return;
      fillTracklistContainer(
        container,
        songIdxPairs.map(function(item) {
          var idx = item.idx;
          return {
            song: item.song,
            displayTitle: trackDisplayTitle(item.song, inAlbum),
            onPlay: function(toPlay) {
              var target = toPlay || item.song;
              if (typeof playTrackBySong === 'function') {
                playTrackBySong(target);
              } else if (typeof startPlayback === 'function') {
                startPlayback(idx);
              } else if (typeof playTrack === 'function') {
                playTrack(idx);
              }
            }
          };
        })
      );
      if (typeof syncTracklistPlayback === 'function') syncTracklistPlayback();
    }

    function getSongsForContainer(container) {
      if (container.dataset.playlist) {
        return songs
          .map((song, idx) => ({ song, idx }))
          .filter(item => item.song.playlist === container.dataset.playlist);
      }

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

    if (pageKey === 'music' && typeof window.renderMusicPage === 'function') {
      window.renderMusicPage();
      return;
    }

    const scopedAudioLists = Array.from(document.querySelectorAll('.entry-audio-list'));
    if (scopedAudioLists.length) {
      scopedAudioLists.forEach(function(listEl) {
        renderTracklist(
          listEl,
          getSongsForContainer(listEl),
          !!(listEl.dataset.album || listEl.dataset.playlist)
        );
      });
      return;
    }

    // ── Regular audioList pages ────────────────────────────────────────────
    const audioListEl = document.getElementById('audioList');
    if (!audioListEl || audioListEl.style.display === 'none') return;

    renderTracklist(
      audioListEl,
      songs.map(function(song, idx) {
        return { song: song, idx: idx };
      }),
      false
    );
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

  window.BurnfolderSpaRouter = {
    navigateTo: navigateTo,
    loadPage: loadPage
  };

})();