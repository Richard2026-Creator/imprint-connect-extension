# IMPRINT Connect

A Chrome extension that lets IMPRINT users curate and download images from any Pinterest board they are viewing, packaged as a single ZIP file.

It runs entirely in your browser using your existing Pinterest session — no servers, no accounts, no tracking.

## Features

- Scan the Pinterest board you are currently viewing (public or private boards you have access to)
- Review pins in a refined 2-column curated grid
- Select all, deselect all, or pick individual images
- Download the selected images as a ZIP file
- Premium, editorial IMPRINT-branded interface

## Install (from source, for development)

1. Download or clone this repository.
2. Generate the icons: open `make-icons.html` in your browser, choose your logo, and download the three PNGs into an `icons/` folder (`icon16.png`, `icon48.png`, `icon128.png`).
3. Go to `chrome://extensions`.
4. Enable **Developer mode** (top-right).
5. Click **Load unpacked** and select this folder.

## Usage

1. Open a Pinterest board in your browser.
2. Click the IMPRINT Connect extension icon.
3. Click **Scan Board** and keep the popup open while it scrolls and collects pins.
4. Select the images you want.
5. Click **Download ZIP**.

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Extension configuration (Manifest V3) |
| `popup.html` | Popup interface and styling |
| `popup.js` | Scanning, selection, and ZIP logic |
| `make-icons.html` | Helper to generate icon PNGs from a logo |
| `icons/` | Extension icons (16/48/128px) |
| `PRIVACY.md` | Privacy policy |
| `STORE_LISTING.md` | Chrome Web Store listing copy |
| `PACKAGING.md` | Packaging and publishing guide |

## Privacy

IMPRINT Connect collects no personal data and transmits nothing to any server. See [PRIVACY.md](PRIVACY.md).

## Disclaimer

This is an independent tool and is not affiliated with, endorsed by, or sponsored by Pinterest. Please respect content creators' rights and Pinterest's terms of service when downloading images.
