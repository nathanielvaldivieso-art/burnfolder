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

      // Replace content
      contentContainer.innerHTML = '';
      contentContainer.appendChild(newContent);

      // Re-initialize any page-specific scripts
      reinitializePageScripts();

      // Scroll to top
      window.scrollTo(0, 0);

    } catch (error) {
      console.error('Navigation error:', error);
      // Fall back to normal navigation
      window.location.href = url;
    }
  }

  function reinitializePageScripts() {
    // Re-run dark mode initialization
    if (typeof initializeDarkMode === 'function') {
      initializeDarkMode();
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

    // Re-initialize newsletter form if present
    const subscribeForm = document.getElementById('subscribeForm');
    if (subscribeForm) {
      subscribeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('emailInput').value;
        const statusMsg = document.getElementById('statusMessage');
        
        statusMsg.textContent = 'subscribing...';
        statusMsg.style.color = '#666';
        
        try {
          const response = await fetch('/.netlify/functions/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email })
          });
          
          const data = await response.json();
          
          if (response.ok) {
            statusMsg.textContent = '✓ subscribed! check your email';
            statusMsg.style.color = '#000';
            document.getElementById('emailInput').value = '';
          } else {
            statusMsg.textContent = data.message || 'error - try again';
            statusMsg.style.color = '#000';
          }
        } catch (error) {
          statusMsg.textContent = 'error - try again';
          statusMsg.style.color = '#000';
        }
      });
    }

    // Update audio and video lists for current page
    updateAudioListForPage();
    updateVideoListForPage();
  }

  function updateAudioListForPage() {
    // Determine the current page key from the URL (not document.title)
    const pathParts = window.location.pathname.split('/');
    const pageKey = pathParts[pathParts.length - 1].replace('.html', '') || 'index';

    // Update window.currentSongs so playTrack() always reads the right array
    if (window.songsByPage && window.songsByPage[pageKey]) {
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
          playTrack(idx);
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

      // On the music page each song has a .page date — show a subtle entry link
      if (song.page && /^\d/.test(song.page)) {
        const dateMeta = document.createElement('div');
        dateMeta.className = 'song-date-link';
        const dateLink = document.createElement('a');
        dateLink.href = song.page + '.html';
        dateLink.textContent = song.page;
        dateMeta.appendChild(dateLink);
        wrap.appendChild(dateMeta);
      }

      return wrap;
    }

    // ── Archive page: populate section columns ─────────────────────────────
    if (pageKey === 'archive') {
      songs.forEach(function(song, idx) {
        const section = song.section || 'misc';
        const trackList = document.querySelector(
          '.archive-section[data-section="' + section + '"] .archive-track-list'
        );
        if (!trackList) return;
        trackList.appendChild(makeSongRow(song, idx, null));
      });
      return;
    }

    // ── Regular audioList pages ────────────────────────────────────────────
    const audioListEl = document.getElementById('audioList');
    if (!audioListEl || audioListEl.style.display === 'none') return;

    audioListEl.innerHTML = '';
    songs.forEach(function(song, idx) {
      const row = makeSongRow(song, idx, 'pageSongTitle');
      if (idx > 0) row.style.marginTop = '32px';
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

})();
