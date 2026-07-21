/* Site-wide constellation nav — matches the audio page menu. */
(function () {
  'use strict';

  var NAV_ITEMS = [
    { id: 'audio', label: 'audio', href: 'audio.html' },
    { id: 'visual', label: 'visual', href: 'content.html' },
    { id: 'archive', label: 'archive', href: 'archive.html' },
    { id: 'shop', label: 'shop', href: 'shop.html' },
    { id: 'about', label: 'about', href: 'about.html' },
    { id: 'contact', label: 'contact', href: 'contact.html' }
  ];

  var handlersBound = false;

  function removeLegacyNav() {
    document.querySelectorAll('header.site-header:not(.studio-header)').forEach(function (el) {
      el.remove();
    });
  }

  function placeOutsideSpa(node) {
    if (!node) return;
    var spa = document.getElementById('spa-content');
    var bottomBar = document.getElementById('bottomBar');
    if (spa && node.parentElement === spa) {
      if (bottomBar) document.body.insertBefore(node, bottomBar);
      else document.body.appendChild(node);
    }
  }

  function ensureSiteMenuRoot() {
    var root = document.getElementById('siteMenu');
    if (!root) {
      root = document.createElement('div');
      root.id = 'siteMenu';
    }
    placeOutsideSpa(root);
    if (!root.isConnected) {
      var bottomBar = document.getElementById('bottomBar');
      if (bottomBar) document.body.insertBefore(root, bottomBar);
      else document.body.insertBefore(root, document.body.firstChild);
    }
    return root;
  }

  function pageKey() {
    var parts = window.location.pathname.split('/');
    return (parts[parts.length - 1] || 'index.html').replace(/\.html$/, '') || 'index';
  }

  function detectCurrentSection() {
    var key = pageKey();
    if (key === 'index') return null;
    if (key === 'audio') return 'audio';
    if (key === 'content') return 'visual';
    if (key === 'archive') return 'archive';
    if (key === 'shop') return 'shop';
    if (key === 'about') return 'about';
    if (key === 'contact') return 'contact';
    return null;
  }

  function setMenuOpen(open) {
    var menu = document.getElementById('siteMenu');
    var toggle = document.getElementById('siteMenuToggle');
    var panel = document.getElementById('siteMenuPanel');
    if (!menu || !toggle || !panel) return;
    panel.hidden = !open;
    menu.classList.toggle('is-open', open);
    document.body.classList.toggle('is-site-menu-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      var linksList = document.getElementById('homeMusicLinksList');
      var linksToggle = document.getElementById('homeMusicLinksToggle');
      if (linksList) linksList.hidden = true;
      if (linksToggle) linksToggle.setAttribute('aria-expanded', 'false');
    }
  }

  function bindHandlers() {
    if (handlersBound) return;
    handlersBound = true;

    document.addEventListener('click', function (e) {
      var menu = document.getElementById('siteMenu');
      var panel = document.getElementById('siteMenuPanel');
      if (!menu || !panel) return;

      if (e.target.closest('.site-menu__brand')) {
        setMenuOpen(false);
        return;
      }

      if (e.target.closest('#siteMenuToggle')) {
        e.preventDefault();
        e.stopPropagation();
        setMenuOpen(panel.hidden);
        return;
      }

      var link = e.target.closest('.site-menu__item');
      if (link && menu.contains(link)) {
        if (link.classList.contains('is-unassigned')) {
          e.preventDefault();
          return;
        }
        var href = link.getAttribute('href') || '';
        if (href.charAt(0) === '#') {
          var target = document.querySelector(href);
          if (target) {
            e.preventDefault();
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setMenuOpen(false);
          }
        } else {
          setMenuOpen(false);
        }
        return;
      }

      if (!panel.hidden && !e.target.closest('#siteMenu')) {
        setMenuOpen(false);
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setMenuOpen(false);
    });
  }

  function renderMenu(root) {
    var current = detectCurrentSection();
    var currentItem = null;
    NAV_ITEMS.some(function (item) {
      if (item.id === current) {
        currentItem = item;
        return true;
      }
      return false;
    });

    root.innerHTML = '';
    root.className = 'site-menu';
    root.id = 'siteMenu';

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'site-menu__toggle';
    toggle.id = 'siteMenuToggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'siteMenuPanel');

    var brand = document.createElement('a');
    brand.className = 'site-menu__brand';
    brand.href = 'index.html';
    brand.textContent = 'burnfolder';
    toggle.appendChild(brand);

    if (currentItem) {
      var sep = document.createElement('span');
      sep.className = 'site-menu__sep';
      sep.setAttribute('aria-hidden', 'true');
      sep.textContent = '—';
      toggle.appendChild(sep);

      var currentEl = document.createElement('span');
      currentEl.className = 'site-menu__current';
      currentEl.textContent = currentItem.label;
      toggle.appendChild(currentEl);
    }

    var panel = document.createElement('nav');
    panel.className = 'site-menu__panel';
    panel.id = 'siteMenuPanel';
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Site navigation');

    NAV_ITEMS.forEach(function (item) {
      var href = (item.href || '').trim();
      var hasLink = !!href;
      var el = document.createElement(hasLink ? 'a' : 'span');
      el.className =
        'site-menu__item site-menu__item--' + item.id + (hasLink ? '' : ' is-unassigned');
      el.textContent = item.label;
      if (hasLink) {
        el.href = href;
      } else {
        el.setAttribute('aria-disabled', 'true');
      }
      if (item.id === current) {
        el.classList.add('is-current');
        if (hasLink) el.setAttribute('aria-current', 'page');
      }
      panel.appendChild(el);
    });

    root.appendChild(toggle);
    root.appendChild(panel);
  }

  function mountSiteMenu() {
    removeLegacyNav();
    var root = ensureSiteMenuRoot();
    renderMenu(root);
    bindHandlers();
  }

  window.mountSiteMenu = mountSiteMenu;
  window.BurnfolderSiteMenu = {
    mount: mountSiteMenu,
    detectCurrentSection: detectCurrentSection,
    setOpen: setMenuOpen
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountSiteMenu);
  } else {
    mountSiteMenu();
  }

  window.addEventListener('burnfolder-spa-navigated', mountSiteMenu);
})();
