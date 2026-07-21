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

      if (hit.closest('.studio-dnd-landing-zone')) {
        return { type: 'landing' };
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
          targetId: albumTrack.dataset.playbackId,
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
    el.dataset.studioDndBound = '1';

    const handleSelector =
      spec.handle || '.studio-track-grip, .studio-stream-album-track-handle';
    const handles = el.querySelectorAll(handleSelector);
    if (!handles.length) return;

    el.draggable = false;

    function bindHandle(handle) {
      handle.style.touchAction = 'none';

      const TOUCH_HOLD_MS = 400;
      const MOUSE_DRAG_PX = 6;

      function tryStart(clientX, clientY, pointerType, grab) {
        startDrag(clientX, clientY, el, spec, pointerType, grab);
      }

      handle.addEventListener('pointerdown', function (e) {
        if (!e.isPrimary || e.button > 0) return;
        if (e.target.closest('.studio-stream-track-delete')) return;
        if (active) return;

        const rect = el.getBoundingClientRect();
        const grab = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        const start = { x: e.clientX, y: e.clientY };
        const touchPointer = e.pointerType === 'touch';
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
          if (!touchPointer) {
            const dist = Math.hypot(clientX - start.x, clientY - start.y);
            if (dist >= MOUSE_DRAG_PX) beginDrag(clientX, clientY);
          }
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

    handles.forEach(bindHandle);
  }

  root.BurnfolderStudioDnD = {
    attach: attach,
    setDropHandler: setDropHandler,
    registerDropHandler: registerDropHandler,
    unregisterDropHandler: unregisterDropHandler,
    begin: begin,
    end: end,
    clearTargets: clearTargets
  };
})(typeof window !== 'undefined' ? window : globalThis);
