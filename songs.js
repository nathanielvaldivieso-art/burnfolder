// ── Song catalog ──────────────────────────────────────────────────────────────
// To add a new track: find the page key (matches the HTML filename without .html)
// and add your entry. The music page automatically shows all songs in order.
// ──────────────────────────────────────────────────────────────────────────────

window.songsByPage = {

  "5.8.26": [
    { title: "fire escape 4.26.26", playbackId: "cllmgZolsMRmP00YSKm02wXgLJ1DfUzfQtCuSjSdx6Mmc" }
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
    { title: "fire escape", playbackId: "ph01iN9TPgERZhYIUPQpQqk6ZXNQEXaMxzK01n7Yb9JhE" }
  ],

  "11.28.25": [
    { title: "sometimes", playbackId: "b1WrV600XLm8GHFoe3yiPiD2CvotHD5LH8pvkXSJl00LM" }
  ]

};

// Flat list for the music page (newest first — follows key order above)
// Excludes archive entries from the flat list
window.allSongs = Object.entries(window.songsByPage)
  .filter(([page]) => page !== 'archive')
  .flatMap(([page, tracks]) => tracks.map(t => ({ ...t, page })));

// ── Journal entries ────────────────────────────────────────────────────────────
// Single source of truth for the index entry list and spa-router.
// Newest first. Add new date keys here when creating new entry pages.
// ──────────────────────────────────────────────────────────────────────────────
window.journalEntries = ["5.8.26", "4.30.26", "2.25.26", "11.29.25", "11.28.25"];

// ── Video catalog ──────────────────────────────────────────────────────────────
// To add a new video: add an entry below with the page key matching the HTML
// filename without .html. Multiple videos per page: add more objects to the array.
// ──────────────────────────────────────────────────────────────────────────────
window.videosByPage = {

  "4.30.26": [
    { title: "DAY 4.30.26", playbackId: "t8VCau3D5102Mw9ioP00xjurc3rcMWD3FoBBA017SxPJVs" }
  ]

};

// Flat list for the video page (newest first — follows key order above)
window.allVideos = Object.entries(window.videosByPage).flatMap(([page, videos]) =>
  videos.map(v => ({ ...v, page })));
