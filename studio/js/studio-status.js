(function (root) {
  'use strict';

  function classify(msg) {
    if (!msg) return '';
    const m = String(msg).toLowerCase();
    if (/loading|creating|checking|saving|unlocking|uploading|subscribing/.test(m)) return 'working';
    if (/error|failed|wrong|could not|unavailable|invalid|denied/.test(m)) return 'error';
    if (/saved|synced|success|subscribed|uploaded|published|done\b/.test(m)) return 'success';
    return '';
  }

  function set(el, msg, kind) {
    if (!el) return;
    const text = msg || '';
    el.textContent = text;
    el.classList.remove('studio-status--error', 'studio-status--success', 'studio-status--working');
    const tone = kind || classify(text);
    if (tone) el.classList.add('studio-status--' + tone);
  }

  root.BurnfolderStudioStatus = {
    set: set,
    classify: classify
  };
})(typeof window !== 'undefined' ? window : globalThis);
