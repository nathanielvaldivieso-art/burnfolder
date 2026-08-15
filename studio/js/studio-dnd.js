/**
 * Unified drag — pointer-based (desktop + touch). iOS-style: drag out of a group to release.
 */
(function (root) {
  'use strict';

  let landingEl = null;
  let hintEl = null;
  let ghostEl = null;
  let active = null;
  let dropHandler = null;
  const dropHandlers = {};
  let depth = 0;
  let dragListeners = null;
  let rafId = null;

  /** Edge band (px) that triggers auto-scroll while dragging. */
  const AUTO_SCROLL_EDGE_PX = 56;
  /** Max px/frame when the pointer is at the extreme edge. */
  const AUTO_SCROLL_MAX_PX = 26;
  /** Known studio scrollports — included even when the pointer is over a sibling pane. */
  const AUTO_SCROLL_HINTS = [
    '.studio-editor-mux-list',
    '.studio-entry-sidebar',
    '.studio-stream-list',
    '.studio-preview-frame',
    '#entryPreview',
    '.studio-entry-preview',
    '#clipsBoard',
    '.clips-board',
    '.clips-unfiled-shelf',
    '.clips-unfiled-grid',
    '.clips-collection-grid',
    '.studio-playlist-track-list',
    '.studio-inspector-panel',
    '#studioInspector',
    '.page-wrap',
    'main.page-wrap'
  ];

  function albumGroupFromEl(el) {
    return el && el.closest ? el.closest('.studio-stream-album-group') : null;
  }

  function albumGroupById(groupId) {
    if (!groupId) return null;
    return document.querySelector('.studio-stream-album-group[data-group-id="' + groupId + '"]');
  }

  function activeAlbumGroup() {
    if (!active) return null;
    return albumGroupById(active.groupId) || albumGroupFromEl(active.el);
  }

  function albumGroupFromHit(hit) {
    return hit ? hit.closest('.studio-stream-album-group') : null;
  }

  function isOutsideRect(clientX, clientY, el, pad) {
    if (!el) return true;
    const r = el.getBoundingClientRect();
    const inset = pad || 0;
    return (
      clientX < r.left - inset ||
      clientX > r.right + inset ||
      clientY < r.top - inset ||
      clientY > r.bottom + inset
    );
  }

  function libraryDropTargets() {
    return document.querySelectorAll(
      '.studio-stream-library-drop, .studio-stream-library-shelf, .studio-dnd-eject-zone'
    );
  }

  function canScrollAxis(el, axis) {
    if (!el) return false;
    const style = root.getComputedStyle ? root.getComputedStyle(el) : null;
    if (!style) return false;
    if (axis === 'y') {
      const oy = style.overflowY;
      if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') return false;
      return el.scrollHeight > el.clientHeight + 1;
    }
    const ox = style.overflowX;
    if (ox !== 'auto' && ox !== 'scroll' && ox !== 'overlay') return false;
    return el.scrollWidth > el.clientWidth + 1;
  }

  function collectScrollPorts(clientX, clientY) {
    const ports = [];
    const seen = typeof root.Set === 'function' ? new Set() : null;

    function add(el) {
      if (!el || (seen && seen.has(el))) return;
      if (seen) seen.add(el);
      if (ports.indexOf(el) >= 0) return;
      ports.push(el);
    }

    const hit = hitElementAt(clientX, clientY);
    let node = hit;
    while (node && node !== document.documentElement) {
      if (canScrollAxis(node, 'y') || canScrollAxis(node, 'x')) add(node);
      node = node.parentElement;
    }

    for (let i = 0; i < AUTO_SCROLL_HINTS.length; i += 1) {
      const found = document.querySelectorAll(AUTO_SCROLL_HINTS[i]);
      for (let j = 0; j < found.length; j += 1) {
        const el = found[j];
        if (canScrollAxis(el, 'y') || canScrollAxis(el, 'x')) add(el);
      }
    }

    const scrolling = document.scrollingElement || document.documentElement;
    if (scrolling) add(scrolling);
    return ports;
  }

  function edgeScrollDelta(pointer, start, end, edge) {
    if (pointer < start + edge) {
      const t = Math.max(0, Math.min(1, 1 - (pointer - start) / edge));
      return -Math.ceil(AUTO_SCROLL_MAX_PX * t);
    }
    if (pointer > end - edge) {
      const t = Math.max(0, Math.min(1, 1 - (end - pointer) / edge));
      return Math.ceil(AUTO_SCROLL_MAX_PX * t);
    }
    return 0;
  }

  /**
   * Scroll the nearest scrollports when the pointer sits in an edge band.
   * Returns true if any scrollTop/scrollLeft changed (caller should re-hit-test).
   */
  function autoScrollAtPoint(clientX, clientY) {
    if (typeof clientX !== 'number' || typeof clientY !== 'number') return false;
    let scrolled = false;
    const vw = root.innerWidth || document.documentElement.clientWidth || 0;
    const vh = root.innerHeight || document.documentElement.clientHeight || 0;
    const ports = collectScrollPorts(clientX, clientY);

    for (let i = 0; i < ports.length; i += 1) {
      const el = ports[i];
      const isDoc =
        el === document.scrollingElement ||
        el === document.documentElement ||
        el === document.body;
      const rect = isDoc
        ? { top: 0, left: 0, bottom: vh, right: vw, width: vw, height: vh }
        : el.getBoundingClientRect();

      // Only drive a port when the pointer is over (or just outside) it —
      // except the document, which always tracks viewport edges.
      if (!isDoc) {
        const pad = AUTO_SCROLL_EDGE_PX;
        if (
          clientX < rect.left - pad ||
          clientX > rect.right + pad ||
          clientY < rect.top - pad ||
          clientY > rect.bottom + pad
        ) {
          continue;
        }
      }

      if (canScrollAxis(el, 'y') || isDoc) {
        const dy = edgeScrollDelta(clientY, rect.top, rect.bottom, AUTO_SCROLL_EDGE_PX);
        if (dy) {
          const before = el.scrollTop;
          el.scrollTop = before + dy;
          if (el.scrollTop !== before) scrolled = true;
        }
      }
      if (canScrollAxis(el, 'x')) {
        const dx = edgeScrollDelta(clientX, rect.left, rect.right, AUTO_SCROLL_EDGE_PX);
        if (dx) {
          const before = el.scrollLeft;
          el.scrollLeft = before + dx;
          if (el.scrollLeft !== before) scrolled = true;
        }
      }
    }

    // Window scroll fallback when scrollingElement is quirky (older WebKit).
    if (!scrolled && typeof root.scrollBy === 'function') {
      const dy = edgeScrollDelta(clientY, 0, vh, AUTO_SCROLL_EDGE_PX);
      const dx = edgeScrollDelta(clientX, 0, vw, AUTO_SCROLL_EDGE_PX);
      if (dy || dx) {
        root.scrollBy(dx, dy);
        scrolled = true;
      }
    }

    return scrolled;
  }

  function entryPreviewDropAt(clientX, clientY, hit) {
    const el = hit || hitElementAt(clientX, clientY);
    if (!el) return null;
    if (el.closest('#editorMuxGrid, .studio-entry-sidebar, .studio-editor-mux-list')) return null;

    const preview = el.closest(
      '#entryPreview, .studio-entry-preview, .studio-preview-frame, #studioPreviewFrame'
    );
    if (!preview) return null;

    let playlistBlockId = null;
    const playlistShell = el.closest('.studio-preview-bubble[data-block-type="playlist"]');
    if (playlistShell && playlistShell.dataset.blockId) {
      playlistBlockId = playlistShell.dataset.blockId;
    } else {
      const playlists = document.querySelectorAll(
        '.studio-preview-bubble[data-block-type="playlist"] .entry-playlist'
      );
      for (let i = 0; i < playlists.length; i += 1) {
        const playlistEl = playlists[i];
        const rect = playlistEl.getBoundingClientRect();
        if (
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        ) {
          const shell = playlistEl.closest('.studio-preview-bubble[data-block-type="playlist"]');
          if (shell && shell.dataset.blockId) {
            playlistBlockId = shell.dataset.blockId;
            break;
          }
        }
      }
    }

    return {
      type: 'entryInsert',
      targetEl: preview,
      playlistBlockId: playlistBlockId,
      clientX: clientX,
      clientY: clientY
    };
  }

  const MIN_DROP_MOVE_PX = 18;

  function hitElementAt(clientX, clientY) {
    const stack = document.elementsFromPoint(clientX, clientY);
    for (let i = 0; i < stack.length; i += 1) {
      const node = stack[i];
      if (ghostEl && (node === ghostEl || ghostEl.contains(node))) continue;
      if (active) {
        if (active.el && (node === active.el || active.el.contains(node))) continue;
        if (active.placeholder && (node === active.placeholder || active.placeholder.contains(node))) continue;
        if (active.liftMount && (node === active.liftMount || active.liftMount.contains(node))) continue;
      }
      return node;
    }
    return null;
  }

  function ensureLanding() {
    if (landingEl) return landingEl;
    landingEl = document.createElement('div');
    landingEl.className = 'studio-dnd-landing-zone studio-dnd-landing-zone--overlay';
    landingEl.setAttribute('aria-hidden', 'true');
    const landingText = document.createElement('span');
    landingText.className = 'studio-dnd-landing-text';
    landingText.textContent = 'drop here for a new folder';
    landingEl.appendChild(landingText);
    document.body.appendChild(landingEl);
    requestAnimationFrame(function () {
      if (landingEl) landingEl.classList.add('is-visible');
    });
    return landingEl;
  }

  function hideLanding() {
    if (landingEl && landingEl.parentNode) landingEl.parentNode.removeChild(landingEl);
    landingEl = null;
  }

  function showDragHint(kind) {
    if (hintEl) return;
    hintEl = document.createElement('div');
    hintEl.className = 'studio-dnd-hint';
    hintEl.setAttribute('aria-live', 'polite');
    if (kind === 'album') {
      hintEl.textContent = 'drag out to remove from folder';
    } else {
      hintEl.textContent = 'drop on a song to group';
    }
    document.body.appendChild(hintEl);
    requestAnimationFrame(function () {
      if (hintEl) hintEl.classList.add('is-visible');
    });
  }

  function hideDragHint() {
    if (hintEl && hintEl.parentNode) hintEl.parentNode.removeChild(hintEl);
    hintEl = null;
  }

  function clearTargets() {
    document
      .querySelectorAll(
        '.is-merge-target, .is-drop-target, .is-drop-before, .is-drop-after, .is-eject-target, .is-playlist-drop-target'
      )
      .forEach(function (el) {
        el.classList.remove(
          'is-merge-target',
          'is-drop-target',
          'is-drop-before',
          'is-drop-after',
          'is-eject-target',
          'is-playlist-drop-target'
        );
      });
  }

  function begin(opts) {
    depth += 1;
    document.body.classList.add('studio-dnd-active');
    const options = opts || {};
    if (options.dndKind) {
      document.body.dataset.dndKind = options.dndKind;
    }
    if (options.showLanding) ensureLanding();
    if (options.dndKind) showDragHint(options.dndKind);
    if (options.showEjectTargets) {
      libraryDropTargets().forEach(function (el) {
        el.classList.add('is-eject-target');
      });
    }
  }

  function stopRaf() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function syncGhostPosition() {
    if (!ghostEl || !active) return;
    const x = active.clientX - active.grabOffsetX;
    const y = active.clientY - active.grabOffsetY;
    ghostEl.style.position = 'fixed';
    ghostEl.style.left = x + 'px';
    ghostEl.style.top = y + 'px';
    ghostEl.style.zIndex = '2147483647';
    ghostEl.style.margin = '0';
    ghostEl.style.pointerEvents = 'none';
  }

  function startRaf() {
    stopRaf();
    function tick() {
      if (!active) {
        rafId = null;
        return;
      }
      syncGhostPosition();
      if (autoScrollAtPoint(active.clientX, active.clientY)) {
        if (dragMoveDistance(active.clientX, active.clientY) >= MIN_DROP_MOVE_PX) {
          highlightDrop(resolveDrop(active.clientX, active.clientY));
        }
      }
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
  }

  function disarmDragListeners() {
    if (!dragListeners) return;
    window.removeEventListener('pointermove', dragListeners.pointerMove, true);
    window.removeEventListener('mousemove', dragListeners.mouseMove, true);
    window.removeEventListener('touchmove', dragListeners.touchMove, true);
    window.removeEventListener('pointerup', dragListeners.up, true);
    window.removeEventListener('pointercancel', dragListeners.up, true);
    window.removeEventListener('mouseup', dragListeners.up, true);
    window.removeEventListener('touchend', dragListeners.up, true);
    window.removeEventListener('touchcancel', dragListeners.up, true);
    dragListeners = null;
  }

  function end(opts) {
    depth = Math.max(0, depth - 1);
    if (depth > 0) return;
    stopRaf();
    disarmDragListeners();
    document.body.classList.remove('studio-dnd-active');
    delete document.body.dataset.dndKind;
    hideLanding();
    hideDragHint();
    clearTargets();
    if (!opts || !opts.skipUnlift) {
      unliftTrack();
    }
    ghostEl = null;
    active = null;
  }

  function setDropHandler(fn) {
    dropHandler = fn;
  }

  function registerDropHandler(zone, fn) {
    if (zone && typeof fn === 'function') dropHandlers[zone] = fn;
  }

  function unregisterDropHandler(zone) {
    if (zone) delete dropHandlers[zone];
  }

  function resolveDrop(clientX, clientY) {
    const hit = hitElementAt(clientX, clientY);
    if (!active) return null;

    const hitGroup = albumGroupFromHit(hit);
    const activeGroup = activeAlbumGroup();
    const albumTrack = hit && hit.closest ? hit.closest('.studio-stream-album-track') : null;
    const albumTracksList = hit && hit.closest ? hit.closest('.studio-stream-album-tracks') : null;
    const libraryTrack =
      hit && hit.closest
        ? hit.closest(
            '.studio-stream-track-item:not(.studio-stream-album-track), .studio-editor-mux-item'
          )
        : null;
    const libraryDrop =
      hit && hit.closest
        ? hit.closest(
            '.studio-stream-library-drop, .studio-stream-library-shelf, .studio-dnd-eject-zone'
          )
        : null;

    if (active.kind === 'library') {
      if (!hit) return null;

      const entryDrop = entryPreviewDropAt(clientX, clientY, hit);
      if (entryDrop) return entryDrop;

      if (hit.closest('.studio-dnd-landing-zone')) {
        return { type: 'landing' };
      }

      const trash = hit.closest('.studio-stream-track-delete');
      if (trash && trash.closest('.studio-stream-track-item') === active.el) {
        return { type: 'delete', targetEl: trash };
      }

      if (albumTrack && albumTrack !== active.el) {
        return {
          type: 'merge',
          targetEl: albumTrack,
          targetId: albumTrack.dataset.playbackId || ''
        };
      }

      if (libraryTrack && libraryTrack !== active.el) {
        const row = libraryTrack.querySelector('.music-track-row');
        return {
          type: 'merge',
          targetEl: libraryTrack,
          targetId: (row && row.dataset.playbackId) || libraryTrack.dataset.playbackId || ''
        };
      }

      if (hitGroup && !albumTrack && hit.closest('.studio-stream-album-group')) {
        return {
          type: 'addToGroup',
          groupId: hitGroup.dataset.groupId || '',
          targetEl: hitGroup
        };
      }

      if (libraryDrop && !hit.closest('.studio-stream-album-group')) {
        return { type: 'landing' };
      }

      return null;
    }

    if (active.kind === 'album') {
      const entryDrop = entryPreviewDropAt(clientX, clientY, hit);
      if (entryDrop) return entryDrop;

      if (
        albumTrack &&
        albumTrack !== active.el &&
        albumTracksList &&
        activeGroup &&
        hitGroup === activeGroup &&
        activeGroup.contains(albumTrack)
      ) {
        const rect = albumTrack.getBoundingClientRect();
        const before = clientY < rect.top + rect.height / 2;
        return {
          type: 'reorder',
          targetEl: albumTrack,
          targetId: albumTrack.dataset.songKey || albumTrack.dataset.playbackId,
          before: before,
          groupId: activeGroup.dataset.groupId || ''
        };
      }

      if (
        albumTrack &&
        albumTrack !== active.el &&
        hitGroup &&
        activeGroup &&
        hitGroup !== activeGroup
      ) {
        return {
          type: 'merge',
          targetEl: albumTrack,
          targetId: albumTrack.dataset.playbackId || ''
        };
      }

      if (libraryTrack && !libraryTrack.classList.contains('studio-stream-album-track')) {
        return { type: 'eject', targetEl: libraryTrack };
      }

      if (libraryDrop && (!hitGroup || !activeGroup || !activeGroup.contains(hit))) {
        return { type: 'eject', targetEl: libraryDrop };
      }

      if (activeGroup && isOutsideRect(clientX, clientY, activeGroup, 28)) {
        return { type: 'eject' };
      }

      if (albumTrack && albumTrack !== active.el) {
        return {
          type: 'merge',
          targetEl: albumTrack,
          targetId: albumTrack.dataset.playbackId || ''
        };
      }

      return null;
    }

    return null;
  }

  function highlightDrop(result) {
    clearTargets();
    if (!result) return;

    if (result.type === 'merge' || result.type === 'reorder') {
      if (result.targetEl) {
        if (result.type === 'reorder') {
          result.targetEl.classList.add(result.before ? 'is-drop-before' : 'is-drop-after');
        } else {
          result.targetEl.classList.add('is-merge-target');
        }
      }
    } else if (result.type === 'addToGroup') {
      if (result.targetEl) result.targetEl.classList.add('is-drop-target');
    } else if (result.type === 'landing') {
      if (landingEl) landingEl.classList.add('is-drop-target');
      libraryDropTargets().forEach(function (el) {
        if (!el.closest('.studio-stream-album-group')) el.classList.add('is-drop-target');
      });
    } else if (result.type === 'eject') {
      libraryDropTargets().forEach(function (el) {
        if (!el.closest('.studio-stream-album-group')) el.classList.add('is-drop-target');
      });
    } else if (result.type === 'delete') {
      if (result.targetEl) result.targetEl.classList.add('is-drop-target');
    } else if (result.type === 'entryInsert') {
      if (result.targetEl) {
        result.targetEl.classList.add('is-drop-target');
        const frame = result.targetEl.closest('.studio-preview-frame');
        if (frame && frame !== result.targetEl) frame.classList.add('is-drop-target');
      }
      if (result.playlistBlockId) {
        document
          .querySelectorAll('.studio-preview-bubble[data-block-type="playlist"]')
          .forEach(function (shell) {
            if (shell.dataset.blockId === result.playlistBlockId) {
              shell.classList.add('is-playlist-drop-target');
            }
          });
      }
    }
  }

  function unliftTrack() {
    if (!active || !active.el) return;
    const el = active.el;
    const mount = active.liftMount;
    const placeholder = active.placeholder;

    el.classList.remove('studio-dnd-lift', 'is-dragging');
    el.style.width = '';
    el.style.left = '';
    el.style.top = '';
    el.style.position = '';
    el.style.zIndex = '';
    el.style.pointerEvents = '';
    el.style.margin = '';
    el.style.opacity = '';
    el.style.transform = '';
    el.style.boxShadow = '';
    delete el.dataset.studioDragging;

    if (mount) mount.classList.remove('is-active');
    if (mount && el.parentNode === mount) {
      mount.removeChild(el);
    }
    if (placeholder && placeholder.parentNode) {
      placeholder.parentNode.insertBefore(el, placeholder);
      placeholder.parentNode.removeChild(placeholder);
    }
    if (mount && mount.parentNode) {
      mount.parentNode.removeChild(mount);
    }
    active.liftMount = null;
    active.placeholder = null;
  }

  function liftTrack(el) {
    const rect = el.getBoundingClientRect();
    const parent = el.parentNode;
    if (!parent || !active) return;

    const placeholder = document.createElement('li');
    placeholder.className = 'studio-dnd-placeholder music-tracklist-item studio-stream-track-item';
    placeholder.setAttribute('aria-hidden', 'true');
    placeholder.style.height = Math.max(rect.height, 1) + 'px';
    placeholder.style.minHeight = Math.max(rect.height, 1) + 'px';
    parent.insertBefore(placeholder, el);
    active.placeholder = placeholder;

    const mount = document.createElement('div');
    mount.className = 'studio-dnd-lift-wrap';
    mount.setAttribute('aria-hidden', 'true');
    mount.style.width = Math.max(rect.width, 1) + 'px';
    mount.style.height = Math.max(rect.height, 1) + 'px';
    document.body.appendChild(mount);
    mount.appendChild(el);
    el.classList.add('studio-dnd-lift');
    active.liftMount = mount;
    ghostEl = mount;

    requestAnimationFrame(function () {
      if (mount.parentNode) mount.classList.add('is-active');
    });
  }

  function dragMoveDistance(clientX, clientY) {
    if (!active) return 0;
    return Math.hypot(clientX - active.startX, clientY - active.startY);
  }

  function moveDrag(clientX, clientY) {
    if (!active) return;
    active.clientX = clientX;
    active.clientY = clientY;
    syncGhostPosition();
    autoScrollAtPoint(clientX, clientY);
    if (dragMoveDistance(clientX, clientY) < MIN_DROP_MOVE_PX) {
      clearTargets();
      return;
    }
    highlightDrop(resolveDrop(clientX, clientY));
  }

  function armDragListeners() {
    if (dragListeners) return;
    dragListeners = {
      pointerMove: function (ev) {
        if (!active) return;
        if (ev.cancelable) ev.preventDefault();
        moveDrag(ev.clientX, ev.clientY);
      },
      mouseMove: function (ev) {
        if (!active) return;
        moveDrag(ev.clientX, ev.clientY);
      },
      touchMove: function (ev) {
        if (!active) return;
        ev.preventDefault();
        const t = ev.touches[0];
        if (t) moveDrag(t.clientX, t.clientY);
      },
      up: function (ev) {
        if (!active) return;
        let x = active.clientX;
        let y = active.clientY;
        if (ev.type.indexOf('touch') === 0) {
          const t = ev.changedTouches[0];
          if (t) {
            x = t.clientX;
            y = t.clientY;
          }
        } else if (typeof ev.clientX === 'number') {
          x = ev.clientX;
          y = ev.clientY;
        }
        finishDrag(x, y);
      }
    };
    window.addEventListener('pointermove', dragListeners.pointerMove, true);
    window.addEventListener('mousemove', dragListeners.mouseMove, true);
    window.addEventListener('touchmove', dragListeners.touchMove, { capture: true, passive: false });
    window.addEventListener('pointerup', dragListeners.up, true);
    window.addEventListener('pointercancel', dragListeners.up, true);
    window.addEventListener('mouseup', dragListeners.up, true);
    window.addEventListener('touchend', dragListeners.up, true);
    window.addEventListener('touchcancel', dragListeners.up, true);
  }

  function startDrag(clientX, clientY, el, spec, pointerType, grab) {
    if (active) return;
    const id = spec.getId();
    if (!id) return;

    const rect = el.getBoundingClientRect();

    active = {
      el: el,
      kind: spec.kind,
      zone: spec.zone || 'default',
      id: id,
      index: typeof spec.getIndex === 'function' ? spec.getIndex() : -1,
      groupId: typeof spec.getGroupId === 'function' ? spec.getGroupId() : '',
      pointerType: pointerType || 'mouse',
      clientX: clientX,
      clientY: clientY,
      startX: clientX,
      startY: clientY,
      grabOffsetX: grab ? grab.x : clientX - rect.left,
      grabOffsetY: grab ? grab.y : clientY - rect.top,
      placeholder: null,
      liftMount: null
    };

    el.dataset.studioDragging = '1';
    liftTrack(el);
    syncGhostPosition();

    begin({
      dndKind: spec.kind,
      showLanding: spec.kind === 'library' && spec.showLanding,
      landingHost: spec.landingHost,
      showEjectTargets: spec.kind === 'album'
    });

    armDragListeners();
    startRaf();
    moveDrag(clientX, clientY);
  }

  function finishDrag(clientX, clientY) {
    if (!active) return;
    disarmDragListeners();
    stopRaf();

    let result = null;
    if (dragMoveDistance(clientX, clientY) >= MIN_DROP_MOVE_PX) {
      result = resolveDrop(clientX, clientY);
    }

    const zone = active.zone;
    const payload = {
      kind: active.kind,
      id: active.id,
      index: active.index,
      groupId: active.groupId || '',
      el: active.el
    };

    const draggedEl = active.el;
    unliftTrack();
    if (draggedEl) {
      draggedEl.dataset.studioJustDragged = '1';
      setTimeout(function () {
        delete draggedEl.dataset.studioJustDragged;
      }, 450);
    }
    end({ skipUnlift: true });

    const handler = dropHandlers[zone] || dropHandler;
    if (handler && result) {
      handler(payload, result);
    } else if (handler) {
      handler(payload, { type: 'cancel' });
    }
  }

  function attach(el, spec) {
    if (!el || el.dataset.studioDndBound === '1') return;

    const handleSelector =
      spec.handle || '.studio-track-grip, .studio-stream-album-track-handle';
    const handles = el.querySelectorAll(handleSelector);

    // Optional wider grab area for mouse/pen only — never touch, so the
    // narrow grip stays the sole touch handle (preserves row tap-to-insert
    // and vertical-scroll behavior on mobile).
    const wideHandles = spec.wideHandle ? el.querySelectorAll(spec.wideHandle) : [];
    const extraWideHandles = [];
    wideHandles.forEach(function (candidate) {
      if (Array.prototype.indexOf.call(handles, candidate) === -1) {
        extraWideHandles.push(candidate);
      }
    });

    if (!handles.length && !extraWideHandles.length) return;
    el.dataset.studioDndBound = '1';

    el.draggable = false;

    function bindHandle(handle, touchCapable) {
      if (touchCapable) handle.style.touchAction = 'none';

      const TOUCH_HOLD_MS = 400;
      const MOUSE_DRAG_PX = 6;

      function tryStart(clientX, clientY, pointerType, grab) {
        startDrag(clientX, clientY, el, spec, pointerType, grab);
      }

      handle.addEventListener('pointerdown', function (e) {
        if (!e.isPrimary || e.button > 0) return;
        if (e.target.closest('.studio-stream-track-delete')) return;
        if (active) return;
        const touchPointer = e.pointerType === 'touch';
        if (touchPointer && !touchCapable) return;

        const rect = el.getBoundingClientRect();
        const grab = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        const start = { x: e.clientX, y: e.clientY };
        let dragging = false;
        let canceled = false;
        const pointerId = e.pointerId;
        let holdTimer = null;
        let lastX = e.clientX;
        let lastY = e.clientY;

        function clearHoldState() {
          if (holdTimer) {
            clearTimeout(holdTimer);
            holdTimer = null;
          }
          el.classList.remove('studio-dnd-hold-ready');
          document.body.classList.remove('studio-dnd-pending');
        }

        function cleanup() {
          clearHoldState();
          window.removeEventListener('pointermove', onPointerMove, true);
          window.removeEventListener('touchmove', onTouchMove, true);
          try {
            if (handle.releasePointerCapture && pointerId != null) {
              handle.releasePointerCapture(pointerId);
            }
          } catch (_) {}
        }

        function beginDrag(clientX, clientY) {
          if (dragging || canceled || active) return;
          dragging = true;
          clearHoldState();
          try {
            if (handle.setPointerCapture && pointerId != null) {
              handle.setPointerCapture(pointerId);
            }
          } catch (_) {}
          tryStart(clientX, clientY, e.pointerType || 'mouse', grab);
          if (active) moveDrag(clientX, clientY);
        }

        function onHoldComplete() {
          holdTimer = null;
          if (canceled || dragging) return;
          el.classList.add('studio-dnd-hold-ready');
          if (root.navigator && root.navigator.vibrate) {
            try {
              root.navigator.vibrate(12);
            } catch (_) {}
          }
          beginDrag(lastX, lastY);
        }

        if (touchPointer) {
          document.body.classList.add('studio-dnd-pending');
          holdTimer = setTimeout(onHoldComplete, TOUCH_HOLD_MS);
        }

        function onMove(clientX, clientY) {
          lastX = clientX;
          lastY = clientY;
          if (canceled) return;
          if (dragging) {
            if (active) moveDrag(clientX, clientY);
            return;
          }
          const dist = Math.hypot(clientX - start.x, clientY - start.y);
          if (touchPointer) {
            // Moved before hold completed → user is scrolling; abort drag arming.
            if (holdTimer && dist > 10) {
              canceled = true;
              cleanup();
              window.removeEventListener('pointerup', onUp, true);
              window.removeEventListener('pointercancel', onUp, true);
              window.removeEventListener('touchend', onUp, true);
              window.removeEventListener('touchcancel', onUp, true);
            }
            return;
          }
          if (dist >= MOUSE_DRAG_PX) beginDrag(clientX, clientY);
        }

        function onPointerMove(ev) {
          if (dragging && ev.cancelable) ev.preventDefault();
          onMove(ev.clientX, ev.clientY);
        }

        function onTouchMove(ev) {
          if (dragging) ev.preventDefault();
          const t = ev.touches[0];
          if (t) onMove(t.clientX, t.clientY);
        }

        function onUp() {
          const wasHold = touchPointer && !dragging;
          cleanup();
          if (wasHold) {
            el.dataset.studioDragHold = '1';
            setTimeout(function () {
              delete el.dataset.studioDragHold;
            }, 120);
          }
          window.removeEventListener('pointerup', onUp, true);
          window.removeEventListener('pointercancel', onUp, true);
          window.removeEventListener('touchend', onUp, true);
          window.removeEventListener('touchcancel', onUp, true);
        }

        window.addEventListener('pointermove', onPointerMove, true);
        window.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
        window.addEventListener('pointerup', onUp, true);
        window.addEventListener('pointercancel', onUp, true);
        window.addEventListener('touchend', onUp, true);
        window.addEventListener('touchcancel', onUp, true);
      });
    }

    handles.forEach(function (handle) {
      bindHandle(handle, true);
    });
    extraWideHandles.forEach(function (handle) {
      bindHandle(handle, false);
    });
  }

  /**
   * Ghost-clone pointer drag for list reorder / custom drops.
   * Does not lift the source out of the DOM (safe for inputs / contenteditable).
   * Sensors match attach(): 400ms hold on touch, 6px move on mouse/pen.
   */
  function attachGhostDrag(el, spec) {
    if (!el || !spec || el.dataset.studioGhostDndBound === '1') return;
    const handleSelector = spec.handle || null;
    let handle = el;
    if (handleSelector) {
      if (el.matches && el.matches(handleSelector)) {
        handle = el;
      } else {
        handle = el.querySelector(handleSelector);
      }
    }
    if (!handle) return;
    el.dataset.studioGhostDndBound = '1';
    el.draggable = false;

    const TOUCH_HOLD_MS = typeof spec.holdMs === 'number' ? spec.holdMs : 400;
    const MOUSE_DRAG_PX = typeof spec.dragPx === 'number' ? spec.dragPx : 6;
    const touchCapable = spec.touch !== false;
    const gripOnly = !!(handleSelector && handle !== el);

    // Narrow grips can claim touch immediately; wide/row handles must stay
    // pan-scrollable until the hold completes or the mouse drag threshold hits.
    if (gripOnly && touchCapable) handle.style.touchAction = 'none';

    handle.addEventListener('pointerdown', function (e) {
      if (!e.isPrimary || e.button > 0) return;
      if (active) return;
      if (typeof spec.shouldIgnore === 'function' && spec.shouldIgnore(e)) return;

      const touchPointer = e.pointerType === 'touch';
      if (touchPointer && !touchCapable) return;

      const rect = el.getBoundingClientRect();
      const grab = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const start = { x: e.clientX, y: e.clientY };
      let dragging = false;
      let canceled = false;
      const pointerId = e.pointerId;
      let holdTimer = null;
      let lastX = e.clientX;
      let lastY = e.clientY;
      let ghost = null;
      let raf = null;

      function clearHoldState() {
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }
        el.classList.remove('studio-dnd-hold-ready');
        document.body.classList.remove('studio-dnd-pending');
      }

      function syncGhost() {
        raf = null;
        if (!ghost) return;
        ghost.style.transform =
          'translate3d(' + (lastX - grab.x) + 'px, ' + (lastY - grab.y) + 'px, 0)';
      }

      function scheduleGhost() {
        if (raf != null) return;
        raf = requestAnimationFrame(syncGhost);
      }

      function cleanupDragUi() {
        clearHoldState();
        if (raf != null) {
          cancelAnimationFrame(raf);
          raf = null;
        }
        document.body.classList.remove('studio-dnd-active', 'studio-ghost-dnd-active');
        el.classList.remove('is-dragging');
        delete el.dataset.studioDragging;
        if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
        ghost = null;
        if (typeof spec.onDragEnd === 'function') spec.onDragEnd();
        try {
          if (handle.releasePointerCapture && pointerId != null) {
            handle.releasePointerCapture(pointerId);
          }
        } catch (_) {}
        window.removeEventListener('pointermove', onPointerMove, true);
        window.removeEventListener('touchmove', onTouchMove, true);
        window.removeEventListener('pointerup', onUp, true);
        window.removeEventListener('pointercancel', onUp, true);
        window.removeEventListener('touchend', onUp, true);
        window.removeEventListener('touchcancel', onUp, true);
      }

      function beginDrag(clientX, clientY) {
        if (dragging || canceled) return;
        dragging = true;
        clearHoldState();
        lastX = clientX;
        lastY = clientY;
        try {
          if (handle.setPointerCapture && pointerId != null) {
            handle.setPointerCapture(pointerId);
          }
        } catch (_) {}

        document.body.classList.add('studio-dnd-active', 'studio-ghost-dnd-active');
        el.classList.add('is-dragging');
        el.dataset.studioDragging = '1';
        if (!gripOnly) handle.style.touchAction = 'none';
        ghost = el.cloneNode(true);
        ghost.classList.add('studio-ghost-dnd-ghost');
        ghost.removeAttribute('id');
        ghost.setAttribute('aria-hidden', 'true');
        ghost.style.width = Math.max(rect.width, 1) + 'px';
        ghost.style.height = Math.max(rect.height, 1) + 'px';
        ghost.style.pointerEvents = 'none';
        document.body.appendChild(ghost);
        syncGhost();
        if (typeof spec.onDragStart === 'function') spec.onDragStart(clientX, clientY);
        if (typeof spec.onDragMove === 'function') spec.onDragMove(clientX, clientY);
      }

      function onHoldComplete() {
        holdTimer = null;
        if (canceled || dragging) return;
        el.classList.add('studio-dnd-hold-ready');
        if (root.navigator && root.navigator.vibrate) {
          try {
            root.navigator.vibrate(12);
          } catch (_) {}
        }
        beginDrag(lastX, lastY);
      }

      if (touchPointer) {
        document.body.classList.add('studio-dnd-pending');
        holdTimer = setTimeout(onHoldComplete, TOUCH_HOLD_MS);
      }

      function onMove(clientX, clientY) {
        lastX = clientX;
        lastY = clientY;
        if (canceled) return;
        if (!dragging) {
          const dist = Math.hypot(clientX - start.x, clientY - start.y);
          if (touchPointer) {
            if (holdTimer && dist > 10) {
              canceled = true;
              cleanupDragUi();
            }
            return;
          }
          if (dist >= MOUSE_DRAG_PX) beginDrag(clientX, clientY);
          return;
        }
        scheduleGhost();
        autoScrollAtPoint(clientX, clientY);
        if (typeof spec.onDragMove === 'function') spec.onDragMove(clientX, clientY);
      }

      function onPointerMove(ev) {
        if (dragging && ev.cancelable) ev.preventDefault();
        onMove(ev.clientX, ev.clientY);
      }

      function onTouchMove(ev) {
        if (dragging) ev.preventDefault();
        const t = ev.touches[0];
        if (t) onMove(t.clientX, t.clientY);
      }

      function onUp(ev) {
        const wasDragging = dragging;
        let x = lastX;
        let y = lastY;
        if (ev && ev.type && ev.type.indexOf('touch') === 0) {
          const t = ev.changedTouches && ev.changedTouches[0];
          if (t) {
            x = t.clientX;
            y = t.clientY;
          }
        } else if (ev && typeof ev.clientX === 'number') {
          x = ev.clientX;
          y = ev.clientY;
        }
        const wasHold = touchPointer && !wasDragging;
        cleanupDragUi();
        if (wasHold) {
          el.dataset.studioDragHold = '1';
          setTimeout(function () {
            delete el.dataset.studioDragHold;
          }, 120);
          return;
        }
        if (!wasDragging) return;
        el.dataset.studioJustDragged = '1';
        setTimeout(function () {
          delete el.dataset.studioJustDragged;
        }, 450);
        if (typeof spec.onDrop === 'function') spec.onDrop(x, y);
      }

      window.addEventListener('pointermove', onPointerMove, true);
      window.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onUp, true);
      window.addEventListener('touchend', onUp, true);
      window.addEventListener('touchcancel', onUp, true);
    });
  }

  function hitElementsFromPoint(clientX, clientY, skipEls) {
    const skip = skipEls || [];
    const stack = document.elementsFromPoint(clientX, clientY);
    for (let i = 0; i < stack.length; i += 1) {
      const node = stack[i];
      let skipped = false;
      for (let j = 0; j < skip.length; j += 1) {
        const s = skip[j];
        if (s && (node === s || (s.contains && s.contains(node)))) {
          skipped = true;
          break;
        }
      }
      if (skipped) continue;
      if (node.classList && node.classList.contains('studio-dnd-ghost')) continue;
      if (node.classList && node.classList.contains('clips-drag-ghost')) continue;
      if (node.classList && node.classList.contains('studio-ghost-dnd-ghost')) continue;
      return node;
    }
    return null;
  }

  root.BurnfolderStudioDnD = {
    attach: attach,
    attachGhostDrag: attachGhostDrag,
    setDropHandler: setDropHandler,
    registerDropHandler: registerDropHandler,
    unregisterDropHandler: unregisterDropHandler,
    begin: begin,
    end: end,
    clearTargets: clearTargets,
    autoScrollAtPoint: autoScrollAtPoint,
    hitElementsFromPoint: hitElementsFromPoint
  };
})(typeof window !== 'undefined' ? window : globalThis);
