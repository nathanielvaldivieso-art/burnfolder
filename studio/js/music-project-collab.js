(function () {
  'use strict';

  function apiBase() {
    const auth = window.BurnfolderStudioAuth;
    return auth && auth.getApiBase ? auth.getApiBase() : '/.netlify/functions';
  }

  function attach(groupId, hubPanel) {
    const auth = window.BurnfolderStudioAuth;
    if (!auth || !auth.canPublish() || !groupId || !hubPanel) return;

    const section = document.createElement('div');
    section.className = 'studio-stream-album-hub-collab';

    const label = document.createElement('p');
    label.className = 'studio-stream-album-hub-label';
    label.textContent = 'collaborators';
    section.appendChild(label);

    const form = document.createElement('form');
    form.className = 'studio-today-row studio-stream-album-hub-collab-form';
    form.innerHTML =
      '<input class="studio-today-field" type="email" placeholder="email" required aria-label="collaborator email">' +
      '<select class="studio-today-field studio-today-field--select" aria-label="role">' +
      '<option value="collaborator">collaborator</option>' +
      '<option value="guest">guest</option>' +
      '</select>' +
      '<button type="submit" class="studio-today-action">invite</button>';

    const note = document.createElement('p');
    note.className = 'studio-today-note';

    const members = document.createElement('div');
    members.className = 'studio-today-list';

    section.appendChild(form);
    section.appendChild(note);
    section.appendChild(members);
    hubPanel.appendChild(section);

    const emailInput = form.querySelector('input');
    const roleSelect = form.querySelector('select');
    const hubDetails = hubPanel.closest('.studio-stream-album-hub');

    function refresh() {
      fetch(apiBase() + '/studio-music-projects?projectId=' + encodeURIComponent(groupId), {
        headers: auth.getAuthHeaders()
      })
        .then(function (res) {
          return res.json();
        })
        .then(function (data) {
          members.innerHTML = '';
          (data.members || []).forEach(function (member) {
            const row = document.createElement('div');
            row.className = 'studio-today-list-row';
            row.textContent = member.user_id.slice(0, 8) + ' · ' + member.role;
            members.appendChild(row);
          });
          const pending = (data.invites || []).filter(function (inv) {
            return !inv.accepted_at;
          });
          if (pending.length) {
            note.textContent = pending[pending.length - 1].url;
          } else {
            note.textContent = '';
          }
        })
        .catch(function () {
          /* noop */
        });
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      fetch(apiBase() + '/studio-music-projects', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, auth.getAuthHeaders()),
        body: JSON.stringify({
          action: 'invite',
          projectId: groupId,
          email: emailInput.value.trim(),
          role: roleSelect.value
        })
      })
        .then(function (res) {
          return res.json();
        })
        .then(function (data) {
          if (data.invite && data.invite.url) {
            note.textContent = data.invite.url;
          }
          refresh();
        });
    });

    if (hubDetails) {
      hubDetails.addEventListener('toggle', function () {
        if (hubDetails.open) refresh();
      });
    }
  }

  window.BurnfolderMusicProjectCollab = {
    attach: attach
  };
})();
