(function (root) {
  'use strict';

  function parseDateKey(str) {
    const m = String(str || '')
      .trim()
      .match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
    if (!m) return null;
    const month = Number(m[1]);
    const day = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const probe = new Date(year, month - 1, day);
    if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) {
      return null;
    }
    return { month: month, day: day, year: year };
  }

  function isValidDateKey(str) {
    return !!parseDateKey(str);
  }

  function todayKey() {
    const now = new Date();
    return now.getMonth() + 1 + '.' + now.getDate() + '.' + String(now.getFullYear()).slice(-2);
  }

  function formatHint() {
    return 'use date like ' + todayKey();
  }

  root.BurnfolderStudioDates = {
    parseDateKey: parseDateKey,
    isValidDateKey: isValidDateKey,
    todayKey: todayKey,
    formatHint: formatHint
  };
})(typeof window !== 'undefined' ? window : globalThis);
