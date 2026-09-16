# Project notes for future agents

## Dev server

Run the local Netlify dev server with:

```bash
npm run dev
```

This starts `http://localhost:8888` and loads all Netlify functions in `.netlify/functions`. Static files are served from the project root.

## Menu version archive

Page: `/studio/menus.html`

This is a lightweight backup/revert tool for the site menu design. Each public section (home, audio, archive, video, shop, about, contact) has its own numbered version list.

### Workflow

1. Open `/studio/menus.html` and pick a section tab.
2. Click **new version** to save the currently active version's CSS/config as the next numbered backup (e.g. `home version 1`). If no version is active yet, it creates an empty one.
3. Click **preview** on any version to open the real public page in a new window with that version's CSS injected for review.
4. Click the active indicator on a version (● / ○) to make it the active version for that section. This updates the `siteMenuDesigns` cloud state.
5. Click the small **×** to delete a version.

### Data model

Cloud key: `siteMenuDesigns`

```json
{
  "sections": {
    "home": [{ "id": "...", "name": "home version 1", "section": "home", "data": { "notes": "", "cssOverrides": "", "config": {} }, "createdAt": "...", "updatedAt": "..." }]
  },
  "active": { "home": "version-id-or-null" },
  "updatedAt": "..."
}
```

### Important caveats

- Activating a version only updates the `siteMenuDesigns` cloud blob. The public site does **not** automatically load and apply the active version's CSS yet. Preview works via a query-string injection handled in `shared/site-menu.js`.
- To make activation publish to the live site, the public `site-menu.js` would need to fetch the active version (currently owner-only) or the version CSS would need to be written to a public location on activation.

## Code locations

- `/studio/menus.html` — archive UI
- `/studio/js/menus-page.js` — version logic
- `/studio/css/studio.css` — archive styles
- `/shared/site-menu.js` — public menu component and preview CSS injection
