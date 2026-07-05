/**
 * Disable OS/browser autocorrect, autocapitalize, and spellcheck on editable fields.
 * Studio + public site — safe to load more than once (idempotent).
 */
(function (root) {
  'use strict';

  if (root.BurnfolderDisableInputAutocorrect) return;

  var SELECTOR =
    'input, textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

  function isEditable(el) {
    return (
      el &&
      el.nodeType === 1 &&
      (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
    );
  }

  function apply(el) {
    if (!isEditable(el)) return;
    el.setAttribute('autocapitalize', 'off');
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('spellcheck', 'false');
    el.spellcheck = false;
  }

  function scan(node) {
    if (!node || node.nodeType !== 1) return;
    if (isEditable(node)) apply(node);
    if (typeof node.querySelectorAll === 'function') {
      node.querySelectorAll(SELECTOR).forEach(apply);
    }
  }

  function init() {
    var doc = root.document;
    if (!doc || !doc.documentElement) return;

    doc.documentElement.setAttribute('autocapitalize', 'off');

    scan(doc);
    if (!doc.body || !root.MutationObserver) return;

    new root.MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(function (node) {
          scan(node);
        });
      });
    }).observe(doc.body, { childList: true, subtree: true });

    doc.addEventListener('focusin', function (event) {
      apply(event.target);
    });
  }

  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  root.BurnfolderDisableInputAutocorrect = { apply: apply, scan: scan };
})(typeof globalThis !== 'undefined' ? globalThis : window);
