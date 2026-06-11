# IMPRINT Connect — Project Status & Context

This file captures the state of the project so a new Kiro session can pick up quickly.

## What this is
A Chrome extension ("IMPRINT Connect") that scans the Pinterest board the user is
viewing, lets them select images, and downloads them as a ZIP. Runs entirely in the
browser using the user's existing Pinterest login. No server, no accounts, no tracking.

## Current status (as of last session)
- **Published** to the Chrome Web Store as an **Unlisted** item (shareable via link).
- Publisher: registered as **Non-trader**, individual.
- GitHub repo: https://github.com/Richard2026-Creator/imprint-connect-extension (branch: main)
- Official URL on the listing: useimprint.design
- Privacy policy URL used on store: the repo's PRIVACY.md
- Manifest version is at **1.1** in the repo (v1.0 was the first published build).

## Architecture (why it's an extension, not a website)
A plain website cannot read a Pinterest tab (cross-origin), use the user's Pinterest
login, or fetch i.pinimg.com images (no CORS). Only an extension has these privileges.
Earlier attempts at a Node/Puppeteer server hit Pinterest login walls and bot detection,
so the extension approach is the correct and final design.

## Files
- `manifest.json` — MV3 config. name "IMPRINT Connect", icons in icons/.
- `popup.html` — UI. Premium editorial card: cream (#F9F8F6) bg, charcoal text,
  muted gold (#B08D4F) accent only, Playfair Display (heading) + Inter (everything).
  2-column square image grid. Logo image shown in header (IMPRINT Connect Logo.png).
- `popup.js` — scan/select/ZIP logic. Element IDs the JS depends on: scanBtn, allBtn,
  noneBtn, dlBtn, count, status, grid. Pin tiles use class "pin"/"pin selected".
- `make-icons.html` — pick a logo image, exports icon16/48/128 PNGs (zoom factor ~1.2).
- `make-screenshot.html` — centers a popup screenshot on a 1280x800 branded canvas for
  the store screenshot requirement.
- `icons/` — icon16.png, icon48.png, icon128.png.
- `IMPRINT Connect Logo.png` — header logo (circular "I" mark).

## Key behaviours / decisions
- Scanner scrolls the board and harvests pin image URLs continuously (Pinterest
  recycles off-screen pins, so collect-while-scrolling is required).
- v1.1 added logic to ignore Pinterest's "More ideas" suggested pins: it finds that
  section's heading and only keeps pins above it, and stops scrolling there.
- User also found a manual workaround: clicking "Organise" on a Pinterest board shows
  only their own pinned images.
- ZIP is built in pure JS (STORE method, no compression lib).

## Gotchas learned
- Don't run the "Load unpacked" dev version and the Web Store version at the same time —
  they conflict. Turning OFF Developer mode fixed a stuck store install.
- Works on Chrome (any OS) + Chromium browsers (Edge, Brave, Opera). NOT Safari, NOT
  mobile Chrome.
- Host permission triggers an in-depth store review (slower approval) — expected.

## To publish an update
1. Edit files, bump "version" in manifest.json.
2. Zip ONLY: manifest.json, popup.html, popup.js, IMPRINT Connect Logo.png, icons/ folder
   (manifest.json must be at the top level of the zip, not in a subfolder).
3. Dev Dashboard → item → Package → Upload new package → Submit for review.

## User preferences (important)
- User is a non-developer/novice. Give plain-English, succinct, ONE-STEP-AT-A-TIME
  instructions. Wait for confirmation before the next step. Don't explain "why" unless
  asked — focus on "how". When changing code, provide the FULL file to paste, not
  "find this line" edits.
