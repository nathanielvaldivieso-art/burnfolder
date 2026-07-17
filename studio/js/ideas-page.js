(function () {
  'use strict';

  function markNav() {
    document.querySelectorAll('.studio-main-nav-link').forEach(function (link) {
      const active = link.getAttribute('data-nav') === 'ideas';
      link.classList.toggle('is-active', active);
      link.classList.toggle('page-nav', active);
    });
  }

  window.studioInitIdeasPage = function () {
    markNav();
  };

  window.studioFlushIdeasSave = function () {
    return Promise.resolve();
  };

  markNav();
})();
