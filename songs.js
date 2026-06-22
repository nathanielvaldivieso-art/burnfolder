// ── Song catalog ──────────────────────────────────────────────────────────────
// To add a new track: find the page key (matches the HTML filename without .html)
// and add your entry. The music page automatically shows all songs in order.
// ──────────────────────────────────────────────────────────────────────────────

function getSongsFromEntry(entry) {
  return (entry.blocks || []).flatMap(block => {
    if (block.type === 'audio' && block.title && block.playbackId) {
      return [{ title: block.title, playbackId: block.playbackId }];
    }

    if (block.type === 'album' && Array.isArray(block.tracks)) {
      return block.tracks
        .filter(track => track.title && track.playbackId)
        .map(track => ({
          title: track.title,
          playbackId: track.playbackId,
          album: block.title || undefined,
          coverArt: block.coverArt || undefined
        }));
    }

    return [];
  });
}

const entrySongsByPage = Object.fromEntries(
  Object.entries(window.entryDataByDate || {}).map(([date, entry]) => [date, getSongsFromEntry(entry)])
);

const manualSongsByPage = {

  "5.8.26": [
    { title: "FIRE ESCAPE 4.26.26", playbackId: "cllmgZolsMRmP00YSKm02wXgLJ1DfUzfQtCuSjSdx6Mmc" }
  ],

  "4.30.26": [
    { title: "IT DOESNT MATTER 4.30.26", playbackId: "JHKhUfJRYIXINeEu01aloxfNbgW7ehN44VtrAUDbFaqQ" }
  ],

  "archive": [
    { title: "time bomb", playbackId: "Ajl003VQh54gI01OHR00QRHDNJa8rgekhi7BSUCwI9TCZw", section: "fight" }
  ],

  "2.25.26": [
    { title: "sometimes (2.24.26)", playbackId: "pk48o00XLPHdkNxXxf89G02Erq197XzcryTXudmhYgyCA" }
  ],

  "11.29.25": [
    { title: "FIRE ESCAPE 11.29.25", playbackId: "ph01iN9TPgERZhYIUPQpQqk6ZXNQEXaMxzK01n7Yb9JhE" }
  ],

  "11.28.25": [
    { title: "sometimes 11.28.25", playbackId: "b1WrV600XLm8GHFoe3yiPiD2CvotHD5LH8pvkXSJl00LM" }
  ]

};

function manualSongsNotInEntries() {
  const out = {};
  Object.keys(manualSongsByPage).forEach(function (date) {
    if (date === 'archive') {
      out[date] = manualSongsByPage[date];
      return;
    }
    if (!window.entryDataByDate || !window.entryDataByDate[date]) {
      out[date] = manualSongsByPage[date];
    }
  });
  return out;
}

window.songsByPage = {
  ...manualSongsNotInEntries(),
  ...entrySongsByPage
};

// Flat list for the music page (newest first — follows key order above)
// Excludes archive entries from the flat list
window.allSongs = Object.entries(window.songsByPage)
  .filter(([page]) => page !== 'archive')
  .flatMap(([page, tracks]) => tracks.map(t => ({ ...t, page })));

// ── Journal entries ────────────────────────────────────────────────────────────
// Derived from entries.js order; legacy dates kept only until migrated.
// ──────────────────────────────────────────────────────────────────────────────
const dataEntryOrder = Array.isArray(window.entryOrder) ? window.entryOrder : Object.keys(window.entryDataByDate || {});
const legacyJournalDates = ["5.8.26", "4.30.26", "2.25.26", "11.29.25", "11.28.25"].filter(function (date) {
  return dataEntryOrder.indexOf(date) < 0 && (!window.entryDataByDate || !window.entryDataByDate[date]);
});
window.journalEntries = Array.from(new Set([].concat(dataEntryOrder, legacyJournalDates)));

function getVideosFromEntry(entry) {
  return (entry.blocks || []).flatMap(block => {
    if (block.type === 'video' && block.playbackId && String(block.playbackId).trim()) {
      return [{
        title: (block.title && String(block.title).trim()) || entry.date || 'video',
        playbackId: String(block.playbackId).trim()
      }];
    }
    return [];
  });
}

const entryVideosByPage = Object.fromEntries(
  Object.entries(window.entryDataByDate || {}).map(([date, entry]) => [date, getVideosFromEntry(entry)])
);

// Legacy pages not in entries.js — entry block videos override on matching keys
const manualVideosByPage = {
  "4.30.26": [
    { title: "DAY 4.30.26", playbackId: "t8VCau3D5102Mw9ioP00xjurc3rcMWD3FoBBA017SxPJVs" }
  ]
};

function manualVideosNotInEntries() {
  const out = {};
  Object.keys(manualVideosByPage).forEach(function (date) {
    if (!window.entryDataByDate || !window.entryDataByDate[date]) {
      out[date] = manualVideosByPage[date];
    }
  });
  return out;
}

window.videosByPage = {
  ...manualVideosNotInEntries(),
  ...entryVideosByPage
};

function buildAllVideos(videosByPage) {
  const order = window.journalEntries || [];
  const seen = new Set();
  const result = [];
  function addPage(page) {
    if (seen.has(page)) return;
    seen.add(page);
    const videos = videosByPage[page];
    if (!videos || !videos.length) return;
    videos.forEach(v => result.push({ ...v, page }));
  }
  order.forEach(addPage);
  Object.keys(videosByPage).forEach(addPage);
  return result;
}

// Flat list for the video page (newest first — follows journalEntries order)
window.allVideos = buildAllVideos(window.videosByPage);
