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
const songs = [
  {
    title: 'Too Late',
    playbackId: 'oKGswvba36ypOwUherXTTeF008NmQb1t9ypJH2AdVmZM'
  },
  {
    title: 'sometimes',
    playbackId: 'b1WrV600XLm8GHFoe3yiPiD2CvotHD5LH8pvkXSJl00LM'
  }
  // Add more songs here
];

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

// Render song list
songs.forEach((song, idx) => {
  const titleSpan = document.createElement('span');
  titleSpan.className = 'page-song-title';
  titleSpan.id = `pageSongTitle${idx+1}`;
  titleSpan.textContent = song.title;
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

// Add touch support for progress bar
progressBarArea.addEventListener('touchstart', (e) => {
  if (activeIdx !== null) {
    e.preventDefault();
    const rect = progressBarArea.getBoundingClientRect();
    const x = e.touches[0].clientX - rect.left;
    const percent = x / rect.width;
    if (activeMuxPlayer.duration) {
      activeMuxPlayer.currentTime = percent * activeMuxPlayer.duration;
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
    
    // Set initial volume more aggressively for mobile compatibility
    try {
      activeMuxPlayer.volume = currentVolume;
      // Force volume change event
      activeMuxPlayer.dispatchEvent(new Event('volumechange'));
    } catch (error) {
      console.log('Initial volume setting error:', error);
    }
    
    // Also set volume on any other audio elements
    setTimeout(() => {
      const audioElements = document.querySelectorAll('audio, video, mux-player');
      audioElements.forEach(element => {
        try {
          if (element.volume !== undefined) {
            element.volume = currentVolume;
          }
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
        
        // Try multiple ways to set volume for better mobile compatibility
        if (activeMuxPlayer) {
          try {
            activeMuxPlayer.volume = percent;
            // Force a volume update event
            activeMuxPlayer.dispatchEvent(new Event('volumechange'));
          } catch (error) {
            console.log('Volume setting error:', error);
          }
        }
        
        // Also try to find any audio elements and set their volume
        const audioElements = document.querySelectorAll('audio, video, mux-player');
        audioElements.forEach(element => {
          try {
            if (element.volume !== undefined) {
              element.volume = percent;
            }
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
      
      // Speaker icon touch events to show/hide fader
      const speakerIcon = document.getElementById('speakerIcon');
      if (speakerIcon && 'ontouchstart' in window) {
        speakerIcon.addEventListener('touchstart', (e) => {
          clearTimeout(faderTimeout);
          volumeFader.classList.add('active');
          e.stopPropagation();
        });
        
        speakerIcon.addEventListener('touchend', (e) => {
          e.stopPropagation();
          // Don't hide immediately, let user interact with fader
          faderTimeout = setTimeout(() => {
            volumeFader.classList.remove('active');
          }, 2000);
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
