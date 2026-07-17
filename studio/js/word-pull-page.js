(function () {
  'use strict';

  const WORDS_PER_BELT = 18;
  const SPEW_EVERY_MS = 900;
  const LOG_KEY = 'wordPullLog';

  // 4 horizontal (alt L→R / R→L) + 4 vertical (alt T→B / B→T)
  const BELT_DEFS = [
    { axis: 'h', dir: 1, slot: 0, duration: 28 },
    { axis: 'h', dir: -1, slot: 1, duration: 34 },
    { axis: 'h', dir: 1, slot: 2, duration: 22 },
    { axis: 'h', dir: -1, slot: 3, duration: 31 },
    { axis: 'v', dir: 1, slot: 0, duration: 26 },
    { axis: 'v', dir: -1, slot: 1, duration: 36 },
    { axis: 'v', dir: 1, slot: 2, duration: 24 },
    { axis: 'v', dir: -1, slot: 3, duration: 30 }
  ];

  let frameEl = null;
  let inputEl = null;
  let daysEl = null;
  let statusEl = null;
  let running = false;
  let belts = [];
  let spewTimer = null;
  let reducedMotion = false;
  let entries = [];
  let logBound = false;

  function markNav() {
    document.querySelectorAll('.studio-main-nav-link').forEach(function (link) {
      const active = link.getAttribute('data-nav') === 'ideas';
      link.classList.toggle('is-active', active);
      link.classList.toggle('page-nav', active);
    });
  }

  function cloud() {
    return window.BurnfolderCloudState;
  }

  function whenReady() {
    if (window.BurnfolderStudioAuth && window.BurnfolderStudioAuth.whenReady) {
      return window.BurnfolderStudioAuth.whenReady();
    }
    return Promise.resolve();
  }

  function todayKey() {
    if (window.BurnfolderStudioDates && window.BurnfolderStudioDates.todayKey) {
      return window.BurnfolderStudioDates.todayKey();
    }
    const now = new Date();
    return now.getMonth() + 1 + '.' + now.getDate() + '.' + String(now.getFullYear()).slice(-2);
  }

  function setLogStatus(msg, kind) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.classList.remove('studio-status--error', 'studio-status--success', 'studio-status--working');
    if (kind === 'error') statusEl.classList.add('studio-status--error');
    if (kind === 'success') statusEl.classList.add('studio-status--success');
    if (kind === 'working') statusEl.classList.add('studio-status--working');
  }

  function uid() {
    return 'wp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function normalizeEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const text = String(raw.text || '').trim();
    if (!text) return null;
    const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : Date.now();
    const day = String(raw.day || '').trim() || todayKey();
    return {
      id: String(raw.id || uid()),
      text: text,
      day: day,
      createdAt: createdAt
    };
  }

  function normalizeStore(value) {
    const list = value && Array.isArray(value.entries)
      ? value.entries
      : Array.isArray(value)
        ? value
        : [];
    return list.map(normalizeEntry).filter(Boolean).sort(function (a, b) {
      return b.createdAt - a.createdAt;
    });
  }

  function daySortKey(day) {
    const parsed = window.BurnfolderStudioDates && window.BurnfolderStudioDates.parseDateKey
      ? window.BurnfolderStudioDates.parseDateKey(day)
      : null;
    if (!parsed) return 0;
    return parsed.year * 10000 + parsed.month * 100 + parsed.day;
  }

  function groupByDay(list) {
    const map = {};
    list.forEach(function (entry) {
      if (!map[entry.day]) map[entry.day] = [];
      map[entry.day].push(entry);
    });
    return Object.keys(map)
      .sort(function (a, b) {
        return daySortKey(b) - daySortKey(a);
      })
      .map(function (day) {
        return {
          day: day,
          entries: map[day].slice().sort(function (a, b) {
            return b.createdAt - a.createdAt;
          })
        };
      });
  }

  function persistLog() {
    const cs = cloud();
    if (!cs || !cs.put) return Promise.resolve();
    setLogStatus('saving…', 'working');
    return cs.put(LOG_KEY, { entries: entries }, 400)
      .then(function () {
        setLogStatus('');
      })
      .catch(function (err) {
        setLogStatus(err.message || 'save failed', 'error');
      });
  }

  function renderLog() {
    if (!daysEl) return;
    daysEl.replaceChildren();
    const groups = groupByDay(entries);
    if (!groups.length) {
      const empty = document.createElement('p');
      empty.className = 'studio-word-pull-empty';
      empty.textContent = 'no sentences yet';
      daysEl.appendChild(empty);
      return;
    }

    groups.forEach(function (group) {
      const section = document.createElement('section');
      section.className = 'studio-word-pull-day';

      const heading = document.createElement('h3');
      heading.className = 'studio-word-pull-day-title';
      heading.textContent = group.day;
      section.appendChild(heading);

      const list = document.createElement('ul');
      list.className = 'studio-word-pull-sentences';
      group.entries.forEach(function (entry) {
        const li = document.createElement('li');
        li.className = 'studio-word-pull-sentence';
        li.textContent = entry.text;
        list.appendChild(li);
      });
      section.appendChild(list);
      daysEl.appendChild(section);
    });
  }

  function logSentence() {
    if (!inputEl) return;
    const text = String(inputEl.value || '').trim();
    if (!text) return;
    entries.unshift({
      id: uid(),
      text: text,
      day: todayKey(),
      createdAt: Date.now()
    });
    inputEl.value = '';
    renderLog();
    persistLog();
  }

  function bindLog() {
    inputEl = document.getElementById('wordPullInput');
    daysEl = document.getElementById('wordPullDays');
    statusEl = document.getElementById('wordPullLogStatus');
    if (!inputEl || inputEl.dataset.wordPullBound === '1') return;
    inputEl.dataset.wordPullBound = '1';
    logBound = true;
    inputEl.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      logSentence();
    });
  }

  function loadLog() {
    const cs = cloud();
    if (!cs || !cs.get) {
      entries = [];
      renderLog();
      return Promise.resolve();
    }
    setLogStatus('loading…', 'working');
    return cs.get(LOG_KEY)
      .then(function (value) {
        entries = normalizeStore(value);
        renderLog();
        setLogStatus('');
      })
      .catch(function (err) {
        entries = [];
        renderLog();
        setLogStatus(err.message || 'failed to load log', 'error');
      });
  }

  function wordPool() {
    const all = window.BurnfolderWordPullAll;
    if (Array.isArray(all) && all.length) return all;
    const bank = window.BurnfolderWordPullBank || {};
    return [].concat(
      bank.verbs || [],
      bank.adjectives || [],
      bank.nouns || [],
      bank.adverbsAndPrepositions || []
    );
  }

  function pickWord(pool) {
    if (!pool.length) return '—';
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function pickWords(count) {
    const pool = wordPool();
    const out = [];
    for (let i = 0; i < count; i += 1) out.push(pickWord(pool));
    return out;
  }

  function makeChip(word) {
    const span = document.createElement('span');
    span.className = 'studio-word-pull-chip';
    span.textContent = word;
    return span;
  }

  function fillStrip(strip, words) {
    strip.replaceChildren();
    words.forEach(function (word) {
      strip.appendChild(makeChip(word));
    });
    words.forEach(function (word) {
      strip.appendChild(makeChip(word));
    });
  }

  function reshuffleBelt(belt) {
    const words = pickWords(WORDS_PER_BELT);
    fillStrip(belt.strip, words);
    belt.words = words;
  }

  function buildBelt(def) {
    const track = document.createElement('div');
    track.className =
      'studio-word-pull-belt studio-word-pull-belt--' + def.axis +
      ' studio-word-pull-belt--slot-' + def.slot +
      ' studio-word-pull-belt--dir-' + (def.dir > 0 ? 'fwd' : 'rev');

    const strip = document.createElement('div');
    strip.className = 'studio-word-pull-belt-strip';
    strip.style.animationDuration = def.duration + 's';

    const words = pickWords(WORDS_PER_BELT);
    fillStrip(strip, words);
    track.appendChild(strip);

    const belt = { def: def, track: track, strip: strip, words: words };
    strip.addEventListener('animationiteration', function () {
      reshuffleBelt(belt);
    });
    return belt;
  }

  function clearBelts() {
    belts.forEach(function (belt) {
      if (belt.track && belt.track.parentNode) belt.track.parentNode.removeChild(belt.track);
    });
    belts = [];
  }

  function spewFreshWords() {
    if (!running || !belts.length) return;
    const pool = wordPool();
    belts.forEach(function (belt) {
      const chips = belt.strip.querySelectorAll('.studio-word-pull-chip');
      if (chips.length < 4) return;
      const half = Math.floor(chips.length / 2);
      const idx = Math.floor(Math.random() * half);
      const word = pickWord(pool);
      chips[idx].textContent = word;
      chips[idx + half].textContent = word;
      if (belt.words[idx] !== undefined) belt.words[idx] = word;
    });
  }

  function startSpew() {
    stopSpew();
    if (reducedMotion) return;
    spewTimer = window.setInterval(spewFreshWords, SPEW_EVERY_MS);
  }

  function stopSpew() {
    if (spewTimer) {
      window.clearInterval(spewTimer);
      spewTimer = null;
    }
  }

  function startConveyors() {
    frameEl = document.getElementById('wordPullFrame');
    if (!frameEl) return;
    clearBelts();
    reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    BELT_DEFS.forEach(function (def) {
      const belt = buildBelt(def);
      if (reducedMotion) belt.strip.style.animation = 'none';
      frameEl.appendChild(belt.track);
      belts.push(belt);
    });

    running = true;
    document.body.classList.add('studio-word-pull-live');
    startSpew();
  }

  function stopConveyors() {
    running = false;
    stopSpew();
    clearBelts();
    document.body.classList.remove('studio-word-pull-live');
  }

  function boot() {
    markNav();
    if (inputEl) delete inputEl.dataset.wordPullBound;
    bindLog();
    startConveyors();
    if (document.getElementById('wordPullDays') || document.getElementById('wordPullInput')) {
      whenReady().then(loadLog);
    }
  }

  window.studioInitWordPullPage = function () {
    stopConveyors();
    boot();
  };

  window.studioFlushWordPullLog = function () {
    const cs = cloud();
    if (cs && cs.flush) return cs.flush(LOG_KEY);
    return Promise.resolve();
  };

  window.addEventListener('pagehide', function () {
    if (window.studioFlushWordPullLog) window.studioFlushWordPullLog();
  });

  if (document.getElementById('wordPullFrame')) boot();
})();
