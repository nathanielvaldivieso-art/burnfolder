(function (root) {
  'use strict';

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function textToHtml(text) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  function appendSection(mount, heading, bodyHtml) {
    const section = document.createElement('section');
    section.className = 'press-section';

    const head = document.createElement('h2');
    head.className = 'press-heading';
    head.textContent = heading;
    section.appendChild(head);

    const body = document.createElement('div');
    body.innerHTML = bodyHtml;
    section.appendChild(body);

    mount.appendChild(section);
  }

  function renderLinks(links) {
    const rows = Array.isArray(links) ? links.filter((row) => row && row.label) : [];
    if (!rows.length) return '';

    const nav = document.createElement('nav');
    nav.className = 'press-links';
    nav.setAttribute('aria-label', 'Release links');

    rows.forEach((link) => {
      const href = String(link.href || '').trim();
      const pending = !!link.pending || !href;
      if (pending) {
        const span = document.createElement('span');
        span.className = 'press-link press-link--pending';
        span.textContent = link.label;
        nav.appendChild(span);
        return;
      }
      const a = document.createElement('a');
      a.className = 'press-link';
      a.href = href;
      a.textContent = link.label;
      nav.appendChild(a);
    });

    return nav.outerHTML;
  }

  function renderAssets(assets) {
    const rows = Array.isArray(assets) ? assets.filter((row) => row && row.label) : [];
    if (!rows.length) return '';

    const ul = document.createElement('ul');
    ul.className = 'press-assets';

    rows.forEach((asset) => {
      const li = document.createElement('li');
      const href = String(asset.href || '').trim();
      const pending = !!asset.pending || !href;
      if (pending) {
        const span = document.createElement('span');
        span.className = 'press-link--pending';
        span.textContent = asset.label;
        li.appendChild(span);
      } else {
        const a = document.createElement('a');
        a.href = href;
        a.textContent = asset.label;
        if (asset.download) a.setAttribute('download', '');
        li.appendChild(a);
      }
      ul.appendChild(li);
    });

    return ul.outerHTML;
  }

  function apply(rootEl, options) {
    const opts = options || {};
    const page = opts.page || {};
    const mount = rootEl.querySelector('[data-press-field="body"]') || rootEl;
    const bodyMount =
      mount === rootEl
        ? rootEl.querySelector('[data-press-field="body"]') || rootEl
        : mount;

    if (!bodyMount) return;

    bodyMount.innerHTML = '';

    const artist = String(page.artist || '').trim();
    if (artist) {
      appendSection(bodyMount, 'artist', '<p class="page-annotation">' + textToHtml(artist) + '</p>');
    }

    const releaseLine = String(page.releaseLine || '').trim();
    const pullQuote = String(page.pullQuote || '').trim();
    if (releaseLine || pullQuote) {
      let releaseHtml = '';
      if (releaseLine) {
        releaseHtml += '<p class="page-annotation">' + textToHtml(releaseLine) + '</p>';
      }
      if (pullQuote) {
        releaseHtml += '<p class="press-quote">' + textToHtml(pullQuote) + '</p>';
      }
      appendSection(bodyMount, 'release', releaseHtml);
    }

    const story = String(page.story || '').trim();
    if (story) {
      appendSection(bodyMount, 'story', '<p class="page-annotation">' + textToHtml(story) + '</p>');
    }

    const linksHtml = renderLinks(page.links);
    if (linksHtml) {
      appendSection(bodyMount, 'links', linksHtml);
    }

    const assetsHtml = renderAssets(page.assets);
    if (assetsHtml) {
      appendSection(bodyMount, 'assets', assetsHtml);
    }

    const credits = String(page.credits || '').trim();
    if (credits) {
      appendSection(bodyMount, 'credits', '<p class="page-annotation">' + textToHtml(credits) + '</p>');
    }

    const contactEmail = String(page.contactEmail || '').trim();
    if (contactEmail) {
      const contactHtml =
        '<p class="page-annotation"><a href="mailto:' +
        escapeHtml(contactEmail) +
        '">' +
        escapeHtml(contactEmail) +
        '</a></p>';
      appendSection(bodyMount, 'contact', contactHtml);
    }
  }

  root.BurnfolderPressPageRender = {
    apply: apply,
    textToHtml: textToHtml,
    escapeHtml: escapeHtml
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
