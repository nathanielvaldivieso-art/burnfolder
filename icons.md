# burnfolder.com Iconography Framework

This file documents all SVG icons used on the site for easy reference and consistent usage.

---

## Cart Icon (Minimal Outline)
```html
<svg viewBox="0 0 32 32" width="32" height="32"><circle cx="16" cy="16" r="15" fill="none" stroke="#000" stroke-width="1.5"/><rect x="10" y="13" width="12" height="7" rx="2" fill="none" stroke="#000" stroke-width="1.5"/><circle cx="13" cy="22" r="1.2" fill="#000"/><circle cx="19" cy="22" r="1.2" fill="#000"/></svg>
```

---

## Remove (X) Icon
```html
<svg viewBox="0 0 20 20" width="20" height="20"><line x1="5" y1="5" x2="15" y2="15" stroke="#000" stroke-width="2"/><line x1="15" y1="5" x2="5" y2="15" stroke="#000" stroke-width="2"/></svg>
```

---

## Checkout Arrow Icon
```html
<svg viewBox="0 0 24 24" width="24" height="24"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="#000" stroke-width="2"/></svg>
```

---

## Usage
- Copy the SVG code into your HTML where you want the icon.
- Adjust `width` and `height` as needed.
- For buttons, use `<button class="icon-btn">...</button>` for consistent styling.

---

## Example Button with Icon
```html
<button class="icon-btn" title="Remove">
  <svg viewBox="0 0 20 20" width="20" height="20"><line x1="5" y1="5" x2="15" y2="15" stroke="#000" stroke-width="2"/><line x1="15" y1="5" x2="5" y2="15" stroke="#000" stroke-width="2"/></svg>
</button>
```

---

## Add more icons as needed and keep this file updated for reference.
