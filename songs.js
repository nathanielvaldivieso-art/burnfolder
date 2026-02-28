// ── Song catalog ──────────────────────────────────────────────────────────────
// To add a new track: find the page key (matches the HTML filename without .html)
// and add your entry. The music page automatically shows all songs in order.
// ──────────────────────────────────────────────────────────────────────────────

window.songsByPage = {

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
window.allSongs = Object.entries(window.songsByPage).flatMap(([page, tracks]) =>
  tracks.map(t => ({ ...t, page }))
);
