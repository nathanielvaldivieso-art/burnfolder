(function () {
  'use strict';

  const shared = window.BurnfolderStreamShared;
  const muxLib = window.BurnfolderStudioMux;
  const player = window.BurnfolderStreamPlayer;
  const MUX_MIME = shared.MUX_MIME;

  const stackDrop = document.getElementById('stackDrop');
  const stackList = document.getElementById('stackList');
  const stackCount = document.getElementById('stackCount');
  const playBtn = document.getElementById('stackPlayBtn');
  const entryBtn = document.getElementById('stackEntryBtn');
  const clearBtn = document.getElementById('stackClearBtn');

  let libraryCache = [];
  let stackTracks = [];
  let dragMuxId = null;

  function render() {
    const n = stackTracks.length;
    if (stackCount) stackCount.textContent = n + ' track' + (n === 1 ? '' : 's');
    if (playBtn) playBtn.disabled = n === 0;
    if (entryBtn) entryBtn.disabled = n === 0;
    if (clearBtn) clearBtn.disabled = n === 0;
    if (stackDrop) stackDrop.classList.toggle('has-tracks', n > 0);
    if (!stackList) return;

    stackList.innerHTML = '';
    stackTracks.forEach(function (track, index) {
      const li = document.createElement('li');
      li.className = 'studio-stream-stack-item';

      const link = document.createElement('a');
      link.className = 'studio-stream-stack-item-link';
      link.href = shared.songPageUrl(track);
      link.textContent = index + 1 + '. ' + track.title;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'studio-stream-stack-remove';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', function () {
        stackTracks = shared.removeFromStack(track.playbackId, stackTracks);
        render();
      });

      li.appendChild(link);
      li.appendChild(removeBtn);
      stackList.appendChild(li);
    });
  }

  function addByPlaybackId(playbackId) {
    const item = shared.findInLibrary(libraryCache, playbackId);
    if (!item) return;
    const result = shared.addToStack(item, stackTracks);
    stackTracks = result.tracks;
    render();
  }

  if (stackDrop) {
    stackDrop.addEventListener('dragover', function (event) {
      if (Array.from(event.dataTransfer.types).indexOf(MUX_MIME) < 0) return;
      event.preventDefault();
      stackDrop.classList.add('is-drop-target');
    });
    stackDrop.addEventListener('dragleave', function () {
      stackDrop.classList.remove('is-drop-target');
    });
    stackDrop.addEventListener('drop', function (event) {
      event.preventDefault();
      stackDrop.classList.remove('is-drop-target');
      addByPlaybackId(event.dataTransfer.getData(MUX_MIME) || dragMuxId);
    });
  }

  if (playBtn) {
    playBtn.addEventListener('click', function () {
      const items = stackTracks.map(function (t) {
        return shared.findInLibrary(libraryCache, t.playbackId) || t;
      });
      if (player) player.playQueue(items, 0);
    });
  }

  if (entryBtn) entryBtn.addEventListener('click', function () {
    shared.pushStackToEntry(stackTracks);
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      stackTracks = shared.clearStack();
      render();
    });
  }

  muxLib.listMuxLibrary().then(function (assets) {
    libraryCache = assets;
    stackTracks = shared.loadStack();
    render();
  });

  window.addEventListener('burnfolder-stack-changed', function () {
    stackTracks = shared.loadStack();
    render();
  });
})();
