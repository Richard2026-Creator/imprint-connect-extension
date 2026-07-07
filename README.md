# IMPRINT Connect

A Chrome extension that helps interior designers curate Pinterest inspiration into a **local project library**, tag images by room/category/style/status, and export a clean, client-ready image pack — complete with a branded source & credits sheet and color palette.

It runs entirely in your browser using your existing Pinterest session — no servers, no accounts, no tracking. Your library is stored locally on your device.

## Features

- **Side panel** that stays open while you browse Pinterest (no fragile popup).
- **Projects & rooms** — organize saved inspiration per client/project and per room.
- **Scan a board** you're viewing, pick the pins you want, and add them to a project.
- **Tag** every image by room, category, style, and status (proposed/approved/ordered).
- **Search, filter, and de-duplicate** your library.
- **Export a Library Pack** (ZIP): images in an `images/` folder + `manifest.csv` + a branded `source-sheet.pdf` with source links and color palette.
- **Local color palette extraction** per image and per project — no API, no cost.
- Premium, editorial IMPRINT-branded interface.

## Install (from source, for development)

1. Download or clone this repository.
2. Generate the icons: open `make-icons.html` in your browser, choose your logo, and download the three PNGs into an `icons/` folder (`icon16.png`, `icon48.png`, `icon128.png`).
3. Go to `chrome://extensions`.
4. Enable **Developer mode** (top-right).
5. Click **Load unpacked** and select this folder.

## Usage

1. Click the IMPRINT Connect toolbar icon to open the **side panel**.
2. Create or select a **Project** (and optionally enter a client name).
3. Open a Pinterest board, then click **Scan Current Board**.
4. In the scan results, deselect anything you don't want, optionally type a **room**, and click **Add Selected To Library**.
5. Tag images and use the **search/filter** controls to organize.
6. Click **Export** to download a Library Pack of the currently shown images.

### What's in the export

The ZIP is named after the project (`imprint-<project-name>.zip`) and contains:

```
source-sheet.pdf    Branded source & credits sheet — source links and color palette, ready to open or print
manifest.csv        Spreadsheet of every image: title, room/category/style/status, source link, colors
images/             The images, named sequentially (0001.jpg, 0002.png, ...)
```

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Extension configuration (Manifest V3) |
| `background.js` | Service worker; opens the side panel on icon click |
| `sidepanel.html` | Side panel interface and styling |
| `sidepanel.js` | Library UI logic (projects, scan-to-add, tagging, filters, export) |
| `core.js` | Reusable logic: board scanning, color extraction, ZIP/manifest/PDF source-sheet builders |
| `db.js` | Local IndexedDB library (projects & items) |
| `jspdf.umd.min.js` | Vendored jsPDF library used to build the source-sheet PDF locally |
| `make-icons.html` | Helper to generate icon PNGs from a logo |
| `icons/` | Extension icons (16/48/128px) |
| `PRIVACY.md` | Privacy policy |
| `STORE_LISTING.md` | Chrome Web Store listing copy |
| `PACKAGING.md` | Packaging and publishing guide |

## Privacy

IMPRINT Connect collects no personal data and transmits nothing to any server. Your project library is stored locally in your browser (IndexedDB). See [PRIVACY.md](PRIVACY.md).

## Disclaimer

This is an independent tool and is not affiliated with, endorsed by, or sponsored by Pinterest. Please respect content creators' rights and Pinterest's terms of service when downloading images.
