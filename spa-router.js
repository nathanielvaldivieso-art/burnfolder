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
      const entries = ["2.25.26", "11.29.25", "11.28.25"];
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

    // Update audio list for current page
    updateAudioListForPage();
  }

  function updateAudioListForPage() {
    const audioListEl = document.getElementById('audioList');
    if (!audioListEl) return;

    // Clear existing track list if visible
    if (audioListEl.style.display !== 'none') {
      audioListEl.innerHTML = '';
      
      // Re-render songs based on current page
      const currentPage = document.title;
      let filteredSongs = allSongs;
      
      if (currentPage.match(/^\d+\.\d+\.\d+$/)) {
        filteredSongs = allSongs.filter(song => song.page === currentPage);
      }
      
      // Re-render song list
      filteredSongs.forEach((song, idx) => {
        const titleSpan = document.createElement('span');
        titleSpan.className = 'page-song-title';
        titleSpan.id = `pageSongTitle${idx+1}`;
        
        const nameSpan = document.createElement('span');
        nameSpan.textContent = song.title;
        
        const durationSpan = document.createElement('span');
        durationSpan.className = 'song-duration';
        durationSpan.textContent = '--:--';
        
        titleSpan.appendChild(nameSpan);
        titleSpan.appendChild(durationSpan);
        
        titleSpan.setAttribute('tabindex', '0');
        titleSpan.setAttribute('role', 'button');
        titleSpan.setAttribute('aria-label', `Play ${song.title}`);
        titleSpan.addEventListener('click', () => {
          playTrack(idx);
        });
        
        const container = document.createElement('div');
        container.className = 'mux-audio-container';
        if (idx > 0) container.style.marginTop = '32px';
        container.appendChild(titleSpan);
        audioListEl.appendChild(container);
      });

      // Preload durations
      filteredSongs.forEach((song, idx) => {
        const tempPlayer = document.createElement('mux-player');
        tempPlayer.setAttribute('playback-id', song.playbackId);
        tempPlayer.setAttribute('metadata-video-title', song.title);
        tempPlayer.style.display = 'none';
        tempPlayer.muted = true;
        document.body.appendChild(tempPlayer);
        
        tempPlayer.addEventListener('loadedmetadata', () => {
          const duration = tempPlayer.duration;
          if (duration && !isNaN(duration)) {
            const minutes = Math.floor(duration / 60);
            const seconds = Math.floor(duration % 60);
            const formattedDuration = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            const durationEl = document.querySelector(`#pageSongTitle${idx + 1} .song-duration`);
            if (durationEl) {
              durationEl.textContent = formattedDuration;
            }
          }
          tempPlayer.remove();
        }, { once: true });
      });
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRouter);
  } else {
    initRouter();
  }

})();
