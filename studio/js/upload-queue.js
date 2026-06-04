(function () {
  'use strict';

  function makeRowId() {
    return 'up-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8);
  }

  window.BurnfolderUploadQueue = {
    attach: function (host) {
      if (!host) {
        return {
          add: function () { return makeRowId(); },
          update: function () {},
          clear: function () {}
        };
      }

      let queueEl = host.querySelector('.studio-upload-queue');
      if (!queueEl) {
        queueEl = document.createElement('div');
        queueEl.className = 'studio-upload-queue';
        queueEl.setAttribute('aria-live', 'polite');
        host.appendChild(queueEl);
      }

      const rows = new Map();

      function renderRow(id) {
        const state = rows.get(id);
        if (!state || !state.el) return;

        const bar = state.el.querySelector('.studio-upload-bar-fill');
        const status = state.el.querySelector('.studio-upload-status');
        const pct = Math.max(0, Math.min(100, state.percent || 0));

        if (bar) bar.style.width = pct + '%';
        if (status) {
          status.textContent = state.message || state.phase || '';
          status.className =
            'studio-upload-status studio-upload-status--' + (state.status || 'working');
        }

        state.el.classList.toggle('is-success', state.status === 'success');
        state.el.classList.toggle('is-error', state.status === 'error');
        state.el.classList.toggle('is-working', state.status === 'working');
      }

      return {
        add: function (file) {
          const id = makeRowId();
          const row = document.createElement('div');
          row.className = 'studio-upload-row is-working';
          row.innerHTML =
            '<div class="studio-upload-row-top">' +
            '<span class="studio-upload-name"></span>' +
            '<span class="studio-upload-status studio-upload-status--working">starting…</span>' +
            '</div>' +
            '<div class="studio-upload-bar" aria-hidden="true"><div class="studio-upload-bar-fill"></div></div>';

          row.querySelector('.studio-upload-name').textContent = file.name || 'file';

          queueEl.prepend(row);

          rows.set(id, {
            el: row,
            percent: 0,
            status: 'working',
            phase: 'starting',
            message: 'starting…'
          });

          renderRow(id);
          return id;
        },

        update: function (id, patch) {
          const state = rows.get(id);
          if (!state) return;
          Object.assign(state, patch || {});
          if (patch.message === undefined && patch.phase) state.message = patch.phase;
          renderRow(id);
        },

        remove: function (id, delayMs) {
          const state = rows.get(id);
          if (!state) return;
          const wait = typeof delayMs === 'number' ? delayMs : 4000;
          window.setTimeout(function () {
            if (state.el && state.el.parentNode) state.el.remove();
            rows.delete(id);
          }, wait);
        },

        clear: function () {
          queueEl.innerHTML = '';
          rows.clear();
        }
      };
    }
  };
})();
