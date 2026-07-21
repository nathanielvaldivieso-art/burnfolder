/* Photonegative skin hotspots — assign links here.
   Edit `href` / `label` per button. Empty href = hover works, click does nothing.

   Logic (pixel-exact):
     hit   = white paint from "{n} hit box.jpg"  → pointer target
     trace = white pen from "{n}.jpg" inside that hit → lights on hover
*/
(function (global) {
  'use strict';

  global.BurnfolderSkinHotspots = [
    {
      id: "3",
      label: "Album: photonegative",
      href: "album.html?album=photonegative",
      trace: "IMAGES/skins/photonegative-trace-3.png",
      hit: "IMAGES/skins/photonegative-hit-3.png",
      attrs: {}
    },
    {
      id: "8",
      label: "Button 8 (mid log)",
      href: "",
      trace: "IMAGES/skins/photonegative-trace-8.png",
      hit: "IMAGES/skins/photonegative-hit-8.png",
      attrs: {}
    },
    {
      id: "7",
      label: "Visual",
      href: "content.html",
      trace: "IMAGES/skins/photonegative-trace-7.png",
      hit: "IMAGES/skins/photonegative-hit-7.png",
      attrs: {}
    },
    {
      id: "1",
      label: "Archive",
      href: "archive.html",
      trace: "IMAGES/skins/photonegative-trace-1.png",
      hit: "IMAGES/skins/photonegative-hit-1.png",
      attrs: {}
    },
    {
      id: "4",
      label: "Shop",
      href: "shop.html",
      trace: "IMAGES/skins/photonegative-trace-4.png",
      hit: "IMAGES/skins/photonegative-hit-4.png",
      attrs: {}
    },
    {
      id: "5",
      label: "Button 5 (center trunk)",
      href: "",
      trace: "IMAGES/skins/photonegative-trace-5.png",
      hit: "IMAGES/skins/photonegative-hit-5.png",
      attrs: {}
    },
    {
      id: "9",
      label: "Button 9 (trunk)",
      href: "",
      trace: "IMAGES/skins/photonegative-trace-9.png",
      hit: "IMAGES/skins/photonegative-hit-9.png",
      attrs: {}
    },
    {
      id: "6",
      label: "Button 6 (left stump)",
      href: "",
      trace: "IMAGES/skins/photonegative-trace-6.png",
      hit: "IMAGES/skins/photonegative-hit-6.png",
      attrs: {}
    },
    {
      id: "10",
      label: "Button 10 (far-left trunk)",
      href: "",
      trace: "IMAGES/skins/photonegative-trace-10.png",
      hit: "IMAGES/skins/photonegative-hit-10.png",
      attrs: {}
    },
    {
      id: "2",
      label: "Button 2 (left log)",
      href: "",
      trace: "IMAGES/skins/photonegative-trace-2.png",
      hit: "IMAGES/skins/photonegative-hit-2.png",
      attrs: {}
    },
    {
      id: "music",
      label: "Audio",
      href: "audio.html",
      trace: "IMAGES/skins/photonegative-trace-music.png",
      hit: "IMAGES/skins/photonegative-hit-music.png",
      attrs: {}
    }
  ];
})(typeof window !== 'undefined' ? window : globalThis);
