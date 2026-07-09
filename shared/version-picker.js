/**
 * Now-playing title menu: go to song / go to album / go to entry / version list.
 * Matches burnfolder.com bottom bar UX (scripts.js createVersionPickerUI).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.BurnfolderVersionPicker = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function mount(options) {
    const opts = options || {};
    const titleEl = opts.titleEl;
    if (!titleEl) return null;

    let wrapEl = opts.wrapEl;
    if (!wrapEl) {
      wrapEl = titleEl.closest('.song-title-wrap');
      if (!wrapEl) {
        wrapEl = document.createElement('div');
        wrapEl.className = 'song-title-wrap';
        const parent = titleEl.parentElement;
        if (!parent) return null;
        parent.insertBefore(wrapEl, titleEl);
        wrapEl.appendChild(titleEl);
      }
    }

    let menuEl = wrapEl.querySelector('.version-picker-menu');
    let actionsEl;
    let listEl;

    if (!menuEl) {
      menuEl = document.createElement('div');
      menuEl.className = 'version-picker-menu';
      menuEl.id = opts.menuId || 'versionPickerMenu';
      menuEl.innerHTML =
        '<div class="version-picker-actions"></div>' +
        '<div class="version-picker-heading">versions</div>' +
        '<div class="version-picker-list"></div>';
      wrapEl.appendChild(menuEl);
    }

    actionsEl = menuEl.querySelector('.version-picker-actions');
    listEl = menuEl.querySelector('.version-picker-list');

    titleEl.classList.add('song-title-trigger');
    if (titleEl.tagName === 'A') {
      titleEl.setAttribute('href', '#');
    }
    titleEl.setAttribute('tabindex', '0');
    titleEl.setAttribute('role', 'button');
    titleEl.setAttribute('aria-haspopup', 'dialog');
    titleEl.setAttribute('aria-expanded', 'false');
    if (!titleEl.getAttribute('aria-label')) {
      titleEl.setAttribute('aria-label', 'Open now playing menu');
    }

    function close() {
      menuEl.classList.remove('open');
      titleEl.setAttribute('aria-expanded', 'false');
    }

    function render() {
      const active = opts.getActiveSong ? opts.getActiveSong() : null;
      actionsEl.innerHTML = '';
      listEl.innerHTML = '';
      if (!active || !active.playbackId) {
        close();
        return;
      }

      const songHref = opts.getSongHref ? opts.getSongHref(active) : '';
      if (songHref) {
        const goSong = document.createElement('a');
        goSong.className = 'icon-btn version-picker-go-link';
        goSong.href = songHref;
        goSong.textContent = 'go to song';
        goSong.addEventListener('click', close);
        actionsEl.appendChild(goSong);
      }

      const albumHref = opts.getAlbumHref ? opts.getAlbumHref(active) : '';
      if (albumHref) {
        const goAlbum = document.createElement('a');
        goAlbum.className = 'icon-btn version-picker-go-link';
        goAlbum.href = albumHref;
        goAlbum.textContent = 'go to album';
        goAlbum.addEventListener('click', close);
        actionsEl.appendChild(goAlbum);
      }

      const entryHref = opts.getEntryHref ? opts.getEntryHref(active) : '';
      if (entryHref) {
        const goEntry = document.createElement('a');
        goEntry.className = 'icon-btn version-picker-go-link';
        goEntry.href = entryHref;
        goEntry.textContent = 'go to entry';
        goEntry.addEventListener('click', close);
        actionsEl.appendChild(goEntry);
      }

      const versions = opts.getVersions ? opts.getVersions(active) : [];
      versions.forEach(function (song) {
        if (!song || !song.playbackId) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'icon-btn version-picker-item';
        button.textContent = song.title || 'untitled';
        if (song.playbackId === active.playbackId) {
          button.classList.add('active');
        }
        button.addEventListener('click', function () {
          close();
          if (song.playbackId === active.playbackId) return;
          if (typeof opts.onPlayVersion === 'function') opts.onPlayVersion(song);
        });
        listEl.appendChild(button);
      });
    }

    function toggle(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      const active = opts.getActiveSong ? opts.getActiveSong() : null;
      if (!active || !active.playbackId) return;
      render();
      const opening = !menuEl.classList.contains('open');
      menuEl.classList.toggle('open', opening);
      titleEl.setAttribute('aria-expanded', opening ? 'true' : 'false');
    }

    titleEl.addEventListener('click', toggle);
    titleEl.addEventListener('keydown', function (event) {
      // Enter opens the menu. Space is reserved for global play/pause
      // (document handlers in scripts.js / studio-playback-shell.js).
      if (event.key === 'Enter') {
        event.preventDefault();
        toggle(event);
      }
      if (event.key === 'Escape') close();
    });

    menuEl.addEventListener('click', function (event) {
      event.stopPropagation();
    });

    document.addEventListener('click', function (event) {
      if (!wrapEl.contains(event.target)) close();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') close();
    });

    return { close: close, render: render, toggle: toggle };
  }

  return { mount: mount };
});
