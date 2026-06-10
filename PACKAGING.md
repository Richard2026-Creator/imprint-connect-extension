# Packaging & Publishing Guide

## 1. Generate the icons
1. Open `make-icons.html` in your browser (double-click it).
2. Click "Generate & Download Icons" — three files download: `icon16.png`, `icon48.png`, `icon128.png`.
3. Create a folder named `icons` inside your extension folder.
4. Move the three PNG files into that `icons` folder.

Your folder should now look like:
```
pinterest-extension/
├── manifest.json
├── popup.html
├── popup.js
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── PRIVACY.md
├── STORE_LISTING.md
└── PACKAGING.md
```

## 2. Test it locally
1. Go to chrome://extensions
2. Enable Developer mode
3. Click "Load unpacked" and select the folder
4. Confirm the icon now shows and the popup still works on a Pinterest board

## 3. Create the upload ZIP
Select ONLY these items and zip them (do not zip the parent folder itself):
- manifest.json
- popup.html
- popup.js
- icons/ (folder)

You can leave the .md docs out of the upload ZIP — they are for you, not the store.

On Windows: select the files + the icons folder, right-click → Send to → Compressed (zipped) folder.

## 4. Publish to the Chrome Web Store
1. Go to https://chrome.google.com/webstore/devconsole
2. Sign in and pay the one-time $5 developer registration fee (first time only).
3. Click "New item" and upload your ZIP.
4. Fill in the listing using the text in STORE_LISTING.md.
5. Add screenshots (1280x800 or 640x400). A screenshot of the popup showing the pin grid works well.
6. Host PRIVACY.md somewhere public (e.g. a GitHub repo or GitHub Pages) and paste its URL into the "Privacy policy" field. A privacy policy URL is required.
7. Under "Privacy practices", declare that you do NOT collect user data, and justify each permission:
   - activeTab/scripting: read pin image URLs from the board the user is viewing
   - downloads: save the ZIP file
   - host permissions: read the board page and fetch pin images
8. Submit for review. Review typically takes a few days.

## Notes
- The same code also works in Microsoft Edge (Edge Add-ons store) and, with minor manifest tweaks, Firefox.
- Increment the "version" in manifest.json each time you upload an update.
