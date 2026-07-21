(function () {
  'use strict';

  const shared = window.BurnfolderStreamShared;
  if (!shared) return;
  const MUX_MIME = shared.MUX_MIME;
  const STACK_TRACK_MIME = 'application/x-burnfolder-stack-track';

  function mountStackDock(opts) {
    const dock = document.getElementById('streamStackDock');
    const drop = document.getElementById('streamStackDrop');
    const list = document.getElementById('streamStackList');
    const playBtn = document.getElementById('stackPlayBtn');
    const entryBtn = document.getElementById('stackEntryBtn');
    const clearBtn = document.getElementById('stackClearBtn');
    const titleInput = document.getElementById('stackTitleInput');
    const coverBtn = document.getElementById('stackCoverBtn');
    const coverInput = document.getElementById('stackCoverInput');
    const player = opts.player;
    const getLibrary = opts.getLibrary || function () {
      return [];
    };

    let stackTracks = shared.loadStack();
    let stackMeta = shared.loadStackMeta();
    let dragStackId = null;

    function persist() {
      shared.saveStack(stackTracks);
    }

    function persistMeta() {
      stackMeta = shared.saveStackMeta(stackMeta);
    }

    function renderMeta() {
      if (titleInput && document.activeElement !== titleInput) {
        titleInput.value = stackMeta.title || '';
      }
      if (!coverBtn) return;
      const coverApi = window.BurnfolderCoverArt;
      if (coverApi && coverApi.applyCoverPreview) {
        coverBtn.className = 'studio-stack-cover-pick studio-stream-album-cover';
        coverApi.applyCoverPreview(coverBtn, stackMeta);
        coverBtn.classList.toggle('has-cover', !!(stackMeta && stackMeta.coverArt));
        return;
      }
      coverBtn.innerHTML = '';
      if (stackMeta.coverArt) {
        const img = document.createElement('img');
        img.src = stackMeta.coverArt;
        img.alt = stackMeta.coverAlt || stackMeta.title || 'cover art';
        img.className = 'stream-stack-cover-img';
        coverBtn.appendChild(img);
        coverBtn.classList.add('has-cover');
      } else {
        const ph = document.createElement('span');
        ph.className = 'stream-stack-cover-placeholder';
        ph.textContent = 'cover';
        coverBtn.appendChild(ph);
        coverBtn.classList.remove('has-cover');
      }
    }

    function addByPlaybackId(playbackId) {
      const item = shared.findInLibrary(getLibrary(), playbackId);
      if (!item || shared.isVideoItem(item)) return;
      const result = shared.addToStack(item, stackTracks);
      stackTracks = result.tracks;
      render();
    }

    function reorderStack(fromId, toIndex) {
      const fromIndex = stackTracks.findIndex(function (t) {
        return t.playbackId === fromId;
      });
      if (fromIndex < 0) return;
      const track = stackTracks.splice(fromIndex, 1)[0];
      let insertAt = toIndex;
      if (insertAt < 0) insertAt = 0;
      if (insertAt > stackTracks.length) insertAt = stackTracks.length;
      if (fromIndex < insertAt) insertAt -= 1;
      stackTracks.splice(insertAt, 0, track);
      persist();
      render();
    }

    function clearDropMarkers() {
      if (!list) return;
      list.querySelectorAll('.stream-stack-chip').forEach(function (el) {
        el.classList.remove('is-drop-before', 'is-drop-after');
      });
    }

    function render() {
      const n = stackTracks.length;
      if (dock) {
        dock.classList.toggle('has-tracks', n > 0);
        dock.classList.toggle('is-empty', n === 0);
      }
      document.body.classList.toggle('has-stream-stack', n > 0);
      if (playBtn) playBtn.disabled = n === 0;
      if (entryBtn) entryBtn.disabled = n === 0;
      if (clearBtn) clearBtn.disabled = n === 0;
      if (!list) return;

      list.innerHTML = '';
      stackTracks.forEach(function (track, index) {
        const chip = document.createElement('li');
        chip.className = 'stream-stack-chip';
        chip.draggable = true;
        chip.dataset.playbackId = track.playbackId;

        const thumb = document.createElement('span');
        thumb.className = 'stream-stack-chip-thumb';
        const url = shared.thumbnailUrl(track.playbackId);
        if (url) {
          const img = document.createElement('img');
          img.src = url;
          img.alt = '';
          thumb.appendChild(img);
        }

        const label = document.createElement('span');
        label.className = 'stream-stack-chip-label';
        label.textContent = track.title;

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'stream-stack-chip-remove';
        removeBtn.textContent = '×';
        removeBtn.setAttribute('aria-label', 'Remove');
        removeBtn.addEventListener('click', function (event) {
          event.stopPropagation();
          stackTracks = shared.removeFromStack(track.playbackId, stackTracks);
          render();
        });

        chip.appendChild(thumb);
        chip.appendChild(label);
        chip.appendChild(removeBtn);

        chip.addEventListener('dragstart', function (event) {
          dragStackId = track.playbackId;
          event.dataTransfer.setData(STACK_TRACK_MIME, track.playbackId);
          event.dataTransfer.effectAllowed = 'move';
          chip.classList.add('is-dragging');
        });

        chip.addEventListener('dragend', function () {
          dragStackId = null;
          chip.classList.remove('is-dragging');
          clearDropMarkers();
        });

        chip.addEventListener('dragover', function (event) {
          if (Array.from(event.dataTransfer.types).indexOf(STACK_TRACK_MIME) < 0) return;
          if (dragStackId === track.playbackId) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          clearDropMarkers();
          const rect = chip.getBoundingClientRect();
          const before = event.clientX < rect.left + rect.width / 2;
          chip.classList.add(before ? 'is-drop-before' : 'is-drop-after');
        });

        chip.addEventListener('drop', function (event) {
          if (Array.from(event.dataTransfer.types).indexOf(STACK_TRACK_MIME) < 0) return;
          event.preventDefault();
          event.stopPropagation();
          const draggedId = event.dataTransfer.getData(STACK_TRACK_MIME) || dragStackId;
          clearDropMarkers();
          if (!draggedId || draggedId === track.playbackId) return;
          const rect = chip.getBoundingClientRect();
          const before = event.clientX < rect.left + rect.width / 2;
          let targetIndex = index;
          if (!before) targetIndex += 1;
          reorderStack(draggedId, targetIndex);
        });

        list.appendChild(chip);
      });
    }

    function acceptMuxDrag(event) {
      const types = event.dataTransfer && event.dataTransfer.types;
      if (!types) return false;
      return (
        Array.from(types).indexOf(MUX_MIME) >= 0 ||
        Array.from(types).indexOf(STACK_TRACK_MIME) >= 0
      );
    }

    if (drop) {
      drop.addEventListener('dragover', function (event) {
        if (!acceptMuxDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        drop.classList.add('is-drop-target');
      });

      drop.addEventListener('dragleave', function (event) {
        if (drop.contains(event.relatedTarget)) return;
        drop.classList.remove('is-drop-target');
      });

      drop.addEventListener('drop', function (event) {
        if (!acceptMuxDrag(event)) return;
        event.preventDefault();
        drop.classList.remove('is-drop-target');
        const muxId = event.dataTransfer.getData(MUX_MIME);
        const stackId = event.dataTransfer.getData(STACK_TRACK_MIME);
        if (muxId) addByPlaybackId(muxId);
        else if (stackId) reorderStack(stackId, stackTracks.length);
      });
    }

    if (playBtn) {
      const playTap = window.BurnfolderTouchTap || window.BurnfolderStudioTap;
      const onPlay = function () {
        if (!player || !stackTracks.length) return;
        const items = stackTracks.map(function (t) {
          return shared.findInLibrary(getLibrary(), t.playbackId) || t;
        });
        player.playQueue(items, 0, { coverArt: stackMeta.coverArt || '' });
      };
      if (playTap && playTap.bind) playTap.bind(playBtn, onPlay);
      else playBtn.addEventListener('click', onPlay);
    }

    if (entryBtn) entryBtn.addEventListener('click', function () {
      shared.pushStackToEntry(stackTracks, stackMeta);
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        stackTracks = shared.clearStack();
        stackMeta = shared.loadStackMeta();
        render();
        renderMeta();
      });
    }

    if (titleInput) {
      titleInput.addEventListener('input', function () {
        stackMeta.title = titleInput.value;
        if (stackMeta.coverArt && !stackMeta.coverAlt) {
          stackMeta.coverAlt = stackMeta.title;
        }
        persistMeta();
      });
    }

    if (coverBtn && coverInput) {
      coverBtn.addEventListener('click', function () {
        coverInput.click();
      });
      coverInput.addEventListener('change', function () {
        const file = coverInput.files && coverInput.files[0];
        coverInput.value = '';
        if (!file) return;
        const coverApi = window.BurnfolderCoverArt;
        const label = stackMeta.title || file.name || 'album';
        if (!coverApi || !coverApi.registerCoverFromFile) return;
        coverApi.registerCoverFromFile(file, label).then(function (result) {
          coverApi.patchFromCoverResult(stackMeta, result);
          persistMeta();
          renderMeta();
        });
      });
    }

    window.addEventListener('burnfolder-stack-changed', function () {
      stackTracks = shared.loadStack();
      stackMeta = shared.loadStackMeta();
      render();
      renderMeta();
    });

    window.addEventListener('burnfolder-stack-meta-changed', function () {
      stackMeta = shared.loadStackMeta();
      renderMeta();
    });

    render();
    renderMeta();

    return {
      addByPlaybackId: addByPlaybackId,
      refresh: function () {
        stackTracks = shared.loadStack();
        stackMeta = shared.loadStackMeta();
        render();
        renderMeta();
      }
    };
  }

  window.BurnfolderStreamStackDock = { mount: mountStackDock };
})();
