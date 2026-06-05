'use strict';

const vm = require('vm');
const publish = require('../../../shared/publish-artifacts.js');

const HEADER = `// ── Entry data ────────────────────────────────────────────────────────────────
// New entries can live here as blocks. The editor generates matching objects.
// Dated pages render from this data when a matching key exists.
// ──────────────────────────────────────────────────────────────────────────────

`;

function parseEntriesJs(source) {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(String(source || ''), ctx, { timeout: 2000 });
  return {
    entryDataByDate: Object.assign({}, ctx.window.entryDataByDate || {}),
    entryOrder: Array.isArray(ctx.window.entryOrder) ? ctx.window.entryOrder.slice() : [],
    musicFeaturedRelease: ctx.window.musicFeaturedRelease
      ? Object.assign({}, ctx.window.musicFeaturedRelease)
      : null
  };
}

function mergeEntry(parsed, date, blocks, republish) {
  if (!republish && parsed.entryDataByDate[date]) {
    const err = new Error('An entry for "' + date + '" already exists. Republish is not enabled.');
    err.code = 'ENTRY_EXISTS';
    throw err;
  }

  const cleanedBlocks = publish
    .stripEditorIds(blocks || [])
    .map(publish.cleanBlockForData);

  parsed.entryDataByDate[date] = { date: date, blocks: cleanedBlocks };
  parsed.entryOrder = [date].concat(parsed.entryOrder.filter(function (d) {
    return d !== date;
  }));

  Object.keys(parsed.entryDataByDate).forEach(function (key) {
    if (parsed.entryOrder.indexOf(key) < 0) {
      parsed.entryOrder.push(key);
    }
  });

  return parsed;
}

function serializeEntriesJs(parsed) {
  const keys = parsed.entryOrder.filter(function (key) {
    return parsed.entryDataByDate[key];
  });

  const body = keys
    .map(function (key) {
      return publish.buildEntryDataSnippet({
        date: key,
        blocks: parsed.entryDataByDate[key].blocks || []
      });
    })
    .join('\n');

  let out =
    HEADER +
    'window.entryDataByDate = {\n' +
    body +
    '\n};\n\n' +
    'window.entryOrder = ' +
    JSON.stringify(keys) +
    ';\n';

  if (parsed.musicFeaturedRelease) {
    out +=
      '\n// Featured on music.html — track order/cover from this album; playback picks newest\n' +
      '// version of each song sitewide (e.g. singles from later entries). Entry pages keep\n' +
      '// the album block as posted. Set useLatestVersions: false to freeze the music page.\n' +
      'window.musicFeaturedRelease = ' +
      JSON.stringify(parsed.musicFeaturedRelease, null, 2) +
      ';\n';
  }

  return out;
}

module.exports = {
  parseEntriesJs: parseEntriesJs,
  mergeEntry: mergeEntry,
  serializeEntriesJs: serializeEntriesJs
};
