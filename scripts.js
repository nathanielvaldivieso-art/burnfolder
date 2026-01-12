// Dark mode functionality
function initializeDarkMode() {
  const themeToggle = document.getElementById('themeToggle');
  const body = document.body;

  if (themeToggle) {
    // Check for saved theme preference or default to light mode
    const currentTheme = localStorage.getItem('theme') || 'light';
    if (currentTheme === 'dark') {
      body.classList.add('dark-mode');
    }

    themeToggle.addEventListener('click', () => {
      body.classList.toggle('dark-mode');
      const theme = body.classList.contains('dark-mode') ? 'dark' : 'light';
      localStorage.setItem('theme', theme);
    });
  }
}

// Initialize dark mode when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeDarkMode);

// --- Spotify-like Streaming Service Audio Logic ---
const allSongs = [
  {
    title: 'fire escape',
    playbackId: 'ph01iN9TPgERZhYIUPQpQqk6ZXNQEXaMxzK01n7Yb9JhE',
    page: '11.29.25'
  },
  {
    title: 'sometimes',
    playbackId: 'b1WrV600XLm8GHFoe3yiPiD2CvotHD5LH8pvkXSJl00LM',
    page: '11.28.25'
  }
  // Add more songs here
];

// Filter songs based on current page
const currentPage = document.title;
let songs = allSongs;

// If on a dated entry page (e.g., 11.28.25), show only that page's song
if (currentPage.match(/^\d+\.\d+\.\d+$/)) {
  songs = allSongs.filter(song => song.page === currentPage);
  // Clear playback state to avoid wrong song playing
  sessionStorage.removeItem('playbackState');
}
// If on music page, show all songs
// Otherwise (index, content, etc.), show all songs

const audioList = document.getElementById('audioList');
const progressEl = document.getElementById('progress');
const bottomBar = document.getElementById('bottomBar');
const progressBarArea = document.getElementById('progressBarArea');
const bottomPlayBtn = document.getElementById('bottomPlayPause');
const songTitleEl = document.getElementById('songTitle');
const closeBtn = document.getElementById('closeBtn');
const loadingSpinner = document.getElementById('loadingSpinner');
const activeMuxPlayer = document.getElementById('activeMuxPlayer');

let activeIdx = null;

// Store reference to active player globally
if (!window.globalMuxPlayer) {
  window.globalMuxPlayer = activeMuxPlayer;
}

// Restore playback state from previous page
const savedState = sessionStorage.getItem('playbackState');
if (savedState && audioList) {
  try {
    const state = JSON.parse(savedState);
    // Find the song in the current filtered list
    const songIndex = songs.findIndex(s => s.playbackId === state.playbackId);
    if (songIndex !== -1) {
      activeIdx = songIndex;
      
      // Check if player already has this track loaded
      const currentPlaybackId = activeMuxPlayer.getAttribute('playback-id');
      if (currentPlaybackId === state.playbackId) {
        // Same track, just update UI - don't reload
        bottomBar.style.display = 'block';
        updateUI();
        initializeVolumeControl();
      } else {
        // Different track or first load
        setTimeout(() => {
          activeMuxPlayer.setAttribute('playback-id', state.playbackId);
          activeMuxPlayer.setAttribute('metadata-video-title', state.title);
          activeMuxPlayer.load();
          
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
    }
  } catch (e) {
    console.error('Failed to restore playback state:', e);
  }
}

// Save playback state before page unload
window.addEventListener('beforeunload', () => {
  if (activeIdx !== null && activeMuxPlayer) {
    const state = {
      playbackId: songs[activeIdx].playbackId,
      title: songs[activeIdx].title,
      currentTime: activeMuxPlayer.currentTime || 0,
      isPlaying: !activeMuxPlayer.paused
    };
    sessionStorage.setItem('playbackState', JSON.stringify(state));
  }
});

// Update playback state periodically
setInterval(() => {
  if (activeIdx !== null && activeMuxPlayer) {
    const state = {
      playbackId: songs[activeIdx].playbackId,
      title: songs[activeIdx].title,
      currentTime: activeMuxPlayer.currentTime || 0,
      isPlaying: !activeMuxPlayer.paused
    };
    sessionStorage.setItem('playbackState', JSON.stringify(state));
  }
}, 1000);

// Render song list

songs.forEach((song, idx) => {
  const titleSpan = document.createElement('span');
  titleSpan.className = 'page-song-title';
  titleSpan.id = `pageSongTitle${idx+1}`;
  // Create song name element
  const nameSpan = document.createElement('span');
  nameSpan.textContent = song.title;
  // Create duration element
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
  titleSpan.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (activeIdx === idx) {
        togglePlayPause();
      } else {
        playTrack(idx);
      }
    }
  });
  const container = document.createElement('div');
  container.className = 'mux-audio-container';
  if (idx > 0) container.style.marginTop = '32px';
  container.appendChild(titleSpan);
  audioList.appendChild(container);
});

// Preload all track durations
songs.forEach((song, idx) => {
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
    // Remove temp player after getting duration
    tempPlayer.remove();
  }, { once: true });
});

function updateUI() {
  document.querySelectorAll('.page-song-title').forEach((el, i) => {
    el.classList.toggle('active', i === activeIdx && !activeMuxPlayer.paused);
  });
  if (activeIdx !== null) {
    if (!activeMuxPlayer.paused) {
      bottomPlayBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="5" width="4" height="14" fill="currentColor"/><rect x="14" y="5" width="4" height="14" fill="currentColor"/></svg>';
    } else {
      bottomPlayBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><polygon points="6,4 20,12 6,20" fill="currentColor"/></svg>';
    }
    songTitleEl.textContent = songs[activeIdx].title;
    bottomBar.style.display = 'block';
    bottomPlayBtn.focus();
  } else {
    bottomBar.style.display = 'none';
    songTitleEl.textContent = '';
  }
}

function playTrack(idx) {
  // Pause and reset current player
  activeMuxPlayer.pause();
  activeMuxPlayer.currentTime = 0;
  // Set new playback-id and play
  activeMuxPlayer.setAttribute('playback-id', songs[idx].playbackId);
  activeMuxPlayer.setAttribute('metadata-video-title', songs[idx].title);
  activeMuxPlayer.load();
  activeIdx = idx;
  updateUI();
  
  // Initialize volume control when track starts
  setTimeout(() => {
    initializeVolumeControl();
  }, 100);
  
  // Try to play directly
  const playPromise = activeMuxPlayer.play();
  if (playPromise !== undefined) {
    playPromise.catch(() => {
      // Fallback: dispatch synthetic click to play/pause button
      bottomPlayBtn.click();
    });
  }
  // Fallback: dispatch synthetic click after short delay if still paused
  setTimeout(() => {
    if (activeMuxPlayer.paused) {
      bottomPlayBtn.click();
    }
    bottomPlayBtn.focus();
  }, 100);
}

function togglePlayPause() {
  if (activeIdx !== null) {
    if (activeMuxPlayer.paused) {
      activeMuxPlayer.play();
    } else {
      activeMuxPlayer.pause();
    }
    updateUI();
    bottomPlayBtn.focus();
  }
}

bottomPlayBtn.addEventListener('click', () => {
  togglePlayPause();
});

document.addEventListener('keydown', (e) => {
  if ((e.code === 'Space' || e.key === ' ') && activeIdx !== null && bottomBar.style.display === 'block') {
    e.preventDefault();
    togglePlayPause();
    bottomPlayBtn.focus();
  }
});

closeBtn.addEventListener('click', () => {
  if (activeIdx !== null) {
    activeMuxPlayer.pause();
    activeIdx = null;
    sessionStorage.removeItem('playbackState');
    updateUI();
  }
});

function showLoading(show) {
  if (loadingSpinner) loadingSpinner.style.display = show ? 'block' : 'none';
}

function updateProgress() {
  if (activeIdx !== null) {
    if (activeMuxPlayer.duration) {
      const percent = (activeMuxPlayer.currentTime / activeMuxPlayer.duration) * 100;
      progressEl.style.width = percent + '%';
    } else {
      progressEl.style.width = '0%';
    }
  }
}
activeMuxPlayer.addEventListener('timeupdate', updateProgress);
activeMuxPlayer.addEventListener('ended', () => {
  updateUI();
  progressEl.style.width = '0%';
});
activeMuxPlayer.addEventListener('waiting', () => {
  showLoading(true);
});
activeMuxPlayer.addEventListener('playing', () => {
  showLoading(false);
  updateUI();
});
activeMuxPlayer.addEventListener('pause', () => {
  updateUI();
});
activeMuxPlayer.addEventListener('error', () => {
  alert(`Failed to load "${songs[activeIdx].title}". Please try again later.`);
  activeMuxPlayer.pause();
  showLoading(false);
  updateUI();
});
progressBarArea.addEventListener('click', (e) => {
  if (activeIdx !== null) {
    const rect = progressBarArea.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = x / rect.width;
    if (activeMuxPlayer.duration) {
      activeMuxPlayer.currentTime = percent * activeMuxPlayer.duration;
    }
  }
});

// Enhanced progress bar interaction with dragging support
let isProgressDragging = false;
let pendingProgressUpdate = null;
let cachedProgressRect = null;
let lastUpdateTime = 0;
const UPDATE_THROTTLE = 16; // ~60fps, update every 16ms

const updateProgressFromEvent = (e) => {
  if (activeIdx !== null && activeMuxPlayer.duration) {
    const now = performance.now();
    
    // Cache rect when dragging starts, don't recalculate every time
    if (!cachedProgressRect) {
      cachedProgressRect = progressBarArea.getBoundingClientRect();
    }
    
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const x = clientX - cachedProgressRect.left;
    const percent = Math.max(0, Math.min(1, x / cachedProgressRect.width));
    
    // Throttle updates for better performance during fast dragging
    if (now - lastUpdateTime >= UPDATE_THROTTLE) {
      // Cancel any pending update
      if (pendingProgressUpdate) {
        cancelAnimationFrame(pendingProgressUpdate);
      }
      
      // Use requestAnimationFrame for smooth updates
      pendingProgressUpdate = requestAnimationFrame(() => {
        try {
          // Batch the audio update to reduce audio engine overhead
          const newTime = percent * activeMuxPlayer.duration;
          if (Math.abs(activeMuxPlayer.currentTime - newTime) > 0.1) {
            activeMuxPlayer.currentTime = newTime;
          }
        } catch (error) {
          // Ignore errors during rapid seeking
        }
        pendingProgressUpdate = null;
      });
      
      lastUpdateTime = now;
    }
  }
};

// Mouse events for progress bar dragging
progressBarArea.addEventListener('mousedown', (e) => {
  if (activeIdx !== null) {
    isProgressDragging = true;
    cachedProgressRect = null; // Reset cache
    updateProgressFromEvent(e);
    e.preventDefault();
  }
});

document.addEventListener('mousemove', (e) => {
  if (isProgressDragging) {
    // Immediate update for responsiveness
    updateProgressFromEvent(e);
    e.preventDefault();
  }
});

document.addEventListener('mouseup', () => {
  if (isProgressDragging) {
    isProgressDragging = false;
    cachedProgressRect = null; // Clear cache
    lastUpdateTime = 0; // Reset throttle
    // Cancel any pending updates when dragging stops
    if (pendingProgressUpdate) {
      cancelAnimationFrame(pendingProgressUpdate);
      pendingProgressUpdate = null;
    }
  }
});

// Touch events for progress bar dragging
progressBarArea.addEventListener('touchstart', (e) => {
  if (activeIdx !== null) {
    isProgressDragging = true;
    cachedProgressRect = null; // Reset cache
    updateProgressFromEvent(e);
    e.preventDefault();
  }
});

document.addEventListener('touchmove', (e) => {
  if (isProgressDragging) {
    // Immediate update for responsiveness
    updateProgressFromEvent(e);
    e.preventDefault(); // Prevent scrolling
  }
}, { passive: false }); // Important: non-passive for preventDefault

document.addEventListener('touchend', () => {
  if (isProgressDragging) {
    isProgressDragging = false;
    cachedProgressRect = null; // Clear cache
    lastUpdateTime = 0; // Reset throttle
    // Cancel any pending updates when dragging stops
    if (pendingProgressUpdate) {
      cancelAnimationFrame(pendingProgressUpdate);
      pendingProgressUpdate = null;
    }
  }
});

// Volume control functionality
let currentVolume = 0.75; // Default volume at 75%

function initializeVolumeControl() {
  const volumeControl = document.getElementById('volumeControl');
  const volumeFader = document.getElementById('volumeFader');
  const volumeTrack = volumeFader?.querySelector('.volume-track');
  const volumeFill = document.getElementById('volumeFill');
  
  if (volumeControl && activeMuxPlayer) {
    // Set initial volume display and player volume
    updateVolumeDisplay();
    
    // Set initial volume - access the underlying media element for mux-player
    try {
      const mediaElement = activeMuxPlayer.media || activeMuxPlayer;
      if (mediaElement) {
        mediaElement.volume = currentVolume;
        mediaElement.muted = false;
        console.log('Initial volume set to:', currentVolume);
      }
    } catch (error) {
      console.log('Initial volume setting error:', error);
    }
    
    // Also set volume on any other audio elements after a delay
    setTimeout(() => {
      const audioElements = document.querySelectorAll('audio, video');
      audioElements.forEach(element => {
        try {
          element.volume = currentVolume;
          element.muted = false;
        } catch (error) {
          console.log('Initial audio element volume error:', error);
        }
      });
    }, 500); // Delay to ensure elements are loaded
    
    // Keep fader visible while interacting
    let faderTimeout;
    
    volumeControl.addEventListener('mouseenter', () => {
      clearTimeout(faderTimeout);
      volumeFader.classList.add('active');
    });
    
    volumeControl.addEventListener('mouseleave', () => {
      faderTimeout = setTimeout(() => {
        volumeFader.classList.remove('active');
      }, 300);
    });
    
    // Handle volume track interactions (mouse and touch)
    if (volumeTrack) {
      let isDragging = false;
      
      const updateVolumeFromEvent = (e) => {
        const rect = volumeTrack.getBoundingClientRect();
        // Handle both mouse and touch events
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const y = clientY - rect.top;
        const percent = Math.max(0, Math.min(1, 1 - (y / rect.height))); // Invert y for bottom-up
        
        currentVolume = percent;
        updateVolumeDisplay();
        
        // Set volume on the active Mux player
        if (activeMuxPlayer) {
          try {
            // For mux-player-audio, we need to access the underlying media element
            const mediaElement = activeMuxPlayer.media || activeMuxPlayer;
            if (mediaElement) {
              mediaElement.volume = percent;
              mediaElement.muted = false; // Ensure not muted
              console.log('Volume set to:', percent);
            }
          } catch (error) {
            console.log('Volume setting error:', error);
          }
        }
        
        // Also try to find any audio/video elements and set their volume
        const audioElements = document.querySelectorAll('audio, video');
        audioElements.forEach(element => {
          try {
            element.volume = percent;
            element.muted = false;
          } catch (error) {
            console.log('Audio element volume error:', error);
          }
        });
      };
      
      // Mouse events
      volumeTrack.addEventListener('mousedown', (e) => {
        isDragging = true;
        updateVolumeFromEvent(e);
        e.preventDefault();
      });
      
      volumeTrack.addEventListener('mousemove', (e) => {
        if (isDragging) {
          updateVolumeFromEvent(e);
        }
      });
      
      document.addEventListener('mouseup', () => {
        isDragging = false;
      });
      
      // Touch events for mobile - show fader only when touching
      volumeTrack.addEventListener('touchstart', (e) => {
        isDragging = true;
        clearTimeout(faderTimeout);
        volumeFader.classList.add('active');
        updateVolumeFromEvent(e);
        e.preventDefault();
        e.stopPropagation();
      });
      
      volumeTrack.addEventListener('touchmove', (e) => {
        if (isDragging) {
          updateVolumeFromEvent(e);
          e.preventDefault();
          e.stopPropagation();
        }
      });
      
      volumeTrack.addEventListener('touchend', (e) => {
        isDragging = false;
        e.preventDefault();
        // Hide fader after touch ends
        faderTimeout = setTimeout(() => {
          volumeFader.classList.remove('active');
        }, 1000);
      });
      
      // Speaker icon events to toggle fader
      const speakerIcon = document.getElementById('speakerIcon');
      if (speakerIcon) {
        // Click event for desktop (toggle on/off)
        speakerIcon.addEventListener('click', (e) => {
          e.stopPropagation();
          clearTimeout(faderTimeout);
          
          if (volumeFader.classList.contains('active')) {
            // Hide fader
            volumeFader.classList.remove('active');
          } else {
            // Show fader
            volumeFader.classList.add('active');
          }
        });
        
        // Touch events for mobile (toggle on/off)
        if ('ontouchstart' in window) {
          speakerIcon.addEventListener('touchstart', (e) => {
            e.stopPropagation();
            e.preventDefault();
            clearTimeout(faderTimeout);
            
            if (volumeFader.classList.contains('active')) {
              // Hide fader
              volumeFader.classList.remove('active');
            } else {
              // Show fader
              volumeFader.classList.add('active');
            }
          });
        }
      }
      
      // Close volume fader when clicking/touching outside
      document.addEventListener('click', (e) => {
        if (!volumeControl.contains(e.target)) {
          volumeFader.classList.remove('active');
          clearTimeout(faderTimeout);
        }
      });
      
      if ('ontouchstart' in window) {
        document.addEventListener('touchstart', (e) => {
          if (!volumeControl.contains(e.target)) {
            volumeFader.classList.remove('active');
            clearTimeout(faderTimeout);
          }
        });
      }
      
      // Fallback click event for volume track (for non-touch devices)
      volumeTrack.addEventListener('click', (e) => {
        if (!isDragging) {
          updateVolumeFromEvent(e);
        }
      });
    }
  }
}

function updateVolumeDisplay() {
  const volumeFill = document.getElementById('volumeFill');
  
  if (volumeFill) {
    const fillHeight = (currentVolume * 100) + '%';
    volumeFill.style.height = fillHeight;
  }
}
