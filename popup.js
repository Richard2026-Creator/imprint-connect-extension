// --- State ---
let pins = [];           // [{ imageUrl, thumbnailUrl, title, pinUrl }]
let boardName = '';
let boardUrl = '';
const selected = new Set();

const els = {
  scan: document.getElementById('scanBtn'),
  all: document.getElementById('allBtn'),
  none: document.getElementById('noneBtn'),
  dl: document.getElementById('dlBtn'),
  count: document.getElementById('count'),
  status: document.getElementById('status'),
  grid: document.getElementById('grid')
};

function setStatus(msg, isError, spinner) {
  els.status.className = isError ? 'error' : '';
  els.status.innerHTML = (spinner ? '<span class="spinner"></span>' : '') + (msg || '');
}

function updateCount() {
  els.count.textContent = pins.length ? `${selected.size} of ${pins.length} selected` : '';
  els.dl.disabled = selected.size === 0;
}

function renderGrid() {
  els.grid.innerHTML = '';
  pins.forEach((pin, i) => {
    const cell = document.createElement('div');
    cell.className = 'pin' + (selected.has(i) ? ' selected' : '');
    cell.innerHTML = `<div class="chk"></div><img src="${pin.thumbnailUrl}" referrerpolicy="no-referrer" loading="lazy" alt="">`;
    cell.addEventListener('click', () => {
      if (selected.has(i)) selected.delete(i); else selected.add(i);
      cell.classList.toggle('selected');
      updateCount();
    });
    els.grid.appendChild(cell);
  });
  updateCount();
}

// --- This function is injected into the Pinterest tab and runs there ---
// It scrolls the board and accumulates pin image URLs (Pinterest recycles
// off-screen pins, so we must collect continuously while scrolling).
//
// Pinterest appends a "More ideas" / "More like this" section of SUGGESTED
// pins below the actual board. We only want pins saved to the board, so we
// find the position of that section and ignore anything at or below it, and
// stop scrolling once we reach it.
async function scrollAndCollect(maxPins) {
  const collected = new Map();

  // Best-effort board name + url for provenance.
  function getBoardName() {
    const h = document.querySelector('h1');
    const ht = h && h.textContent ? h.textContent.trim() : '';
    if (ht) return ht;
    const t = (document.title || '').split('|')[0].trim();
    return t || 'Pinterest Board';
  }

  // Find the vertical document position where the suggestions section begins.
  // Returns Infinity if no boundary is found yet (still within the board).
  function getBoundaryY() {
    const headingMatch = /^(more ideas|more like this|more to explore|ideas you might love|inspired by|related ideas)/i;
    // 1) Explicit Pinterest test ids for the related/more section
    let marker = document.querySelector('[data-test-id="board-feed-related-pins"], [data-test-id="moreIdeas"], [data-test-id="more-ideas-header"]');
    if (marker) return marker.getBoundingClientRect().top + window.scrollY;
    // 2) Any heading element whose text starts with a known suggestions label
    const headings = document.querySelectorAll('h1, h2, h3, h4, [role="heading"]');
    for (const h of headings) {
      const t = (h.textContent || '').trim();
      if (headingMatch.test(t)) {
        return h.getBoundingClientRect().top + window.scrollY;
      }
    }
    return Infinity;
  }

  function harvest(boundaryY) {
    let nodes = Array.from(document.querySelectorAll('[data-test-id="pin"], [data-test-id="pinWrapper"]'));
    if (nodes.length === 0) nodes = Array.from(document.querySelectorAll('a[href*="/pin/"]'));
    nodes.forEach((node) => {
      // Skip pins that sit at or below the suggestions boundary
      const top = node.getBoundingClientRect().top + window.scrollY;
      if (top >= boundaryY) return;

      const img = node.querySelector('img');
      if (!img) return;
      let src = img.src || img.getAttribute('data-src') || '';
      if (!src.includes('pinimg.com')) return;
      if (/\/(30x30|45x45|50x50|60x60|75x75|140x140)\//.test(src)) return; // skip avatars/icons
      let best = src;
      const srcset = img.getAttribute('srcset');
      if (srcset) {
        const parts = srcset.split(',').map(s => s.trim().split(' ')[0]).filter(u => u.includes('pinimg.com'));
        if (parts.length) best = parts[parts.length - 1];
      }
      const originalUrl = best.replace(/\/\d+x\d*\//, '/originals/');

      // Provenance: the pin's own Pinterest URL (where it was saved from).
      let pinUrl = '';
      const anchor = node.matches && node.matches('a[href*="/pin/"]') ? node : node.querySelector('a[href*="/pin/"]');
      if (anchor) {
        const href = anchor.getAttribute('href') || '';
        try { pinUrl = new URL(href, location.origin).href; } catch (e) { pinUrl = href; }
      }

      if (!collected.has(originalUrl)) {
        collected.set(originalUrl, {
          imageUrl: originalUrl,
          thumbnailUrl: src,
          title: (img.alt || '').trim(),
          pinUrl
        });
      }
    });
  }

  harvest(getBoundaryY());
  let stable = 0;
  for (let i = 0; i < 500; i++) {
    const before = collected.size;
    if (before >= maxPins) break;

    // If the suggestions section is already loaded and we've scrolled to it,
    // stop — everything below is Pinterest's recommendations, not the board.
    const boundaryY = getBoundaryY();
    if (boundaryY !== Infinity && (window.scrollY + window.innerHeight) >= boundaryY) {
      break;
    }

    window.scrollBy(0, window.innerHeight * 1.5);
    await new Promise(r => setTimeout(r, 1200));
    harvest(getBoundaryY());

    if (collected.size === before) {
      stable++;
      if (stable >= 6) break; // reached the bottom
    } else {
      stable = 0;
    }
  }

  return {
    boardName: getBoardName(),
    boardUrl: location.href,
    pins: Array.from(collected.values()).slice(0, maxPins)
  };
}

// --- Scan button ---
els.scan.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/pinterest\.com\//.test(tab.url || '')) {
    setStatus('Open a Pinterest board in this tab first, then click Scan board.', true);
    return;
  }

  els.scan.disabled = true;
  pins = [];
  selected.clear();
  els.grid.innerHTML = '';
  setStatus('Scanning and scrolling the board... this can take 20-60 seconds. Keep this popup open.', false, true);

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrollAndCollect,
      args: [1000]
    });
    const out = (results && results[0] && results[0].result) ? results[0].result : {};
    pins = out.pins || [];
    boardName = out.boardName || 'Pinterest Board';
    boardUrl = out.boardUrl || (tab.url || '');
    if (pins.length === 0) {
      setStatus('No pins found. Make sure you are viewing a board page (the grid of pins is visible).', true);
    } else {
      pins.forEach((_, i) => selected.add(i));
      setStatus(`Found ${pins.length} pins on "${boardName}". Click any pin to toggle it, then Download.`, false);
      renderGrid();
    }
  } catch (e) {
    setStatus('Scan failed: ' + e.message, true);
  } finally {
    els.scan.disabled = false;
  }
});

els.all.addEventListener('click', () => {
  pins.forEach((_, i) => selected.add(i));
  document.querySelectorAll('.pin').forEach(c => c.classList.add('selected'));
  updateCount();
});

els.none.addEventListener('click', () => {
  selected.clear();
  document.querySelectorAll('.pin').forEach(c => c.classList.remove('selected'));
  updateCount();
});

// --- Download as ZIP (images + provenance manifest + branded credits sheet) ---
els.dl.addEventListener('click', async () => {
  const chosen = pins.filter((_, i) => selected.has(i));
  if (!chosen.length) return;

  els.dl.disabled = true;
  const files = [];
  const records = [];   // metadata for manifest + credits
  let seq = 0;          // sequential, gap-free numbering for saved images

  for (let i = 0; i < chosen.length; i++) {
    setStatus(`Processing image ${i + 1} of ${chosen.length}...`, false, true);
    const pin = chosen[i];

    let data = await tryFetch(pin.imageUrl);
    if (!data || data.length < 1000) data = await tryFetch(pin.thumbnailUrl);
    if (!data || data.length <= 500) continue;

    // Clean, predictable names inside an images/ subfolder. Real descriptions
    // live in the manifest + source sheet, so filenames stay tidy.
    seq++;
    const ext = sniffExt(data, pin.imageUrl);
    const path = `images/${String(seq).padStart(4, '0')}${ext}`;
    files.push({ name: path, data });

    // Local color + thumbnail extraction (no network, no libraries).
    let colors = [];
    let thumb = '';
    try {
      const ic = await decodeToCanvas(data, 200);
      if (ic) {
        const imgData = ic.ctx.getImageData(0, 0, ic.canvas.width, ic.canvas.height);
        colors = quantize(imgData, 5);
        thumb = ic.canvas.toDataURL('image/jpeg', 0.7);
      }
    } catch (e) { /* color/thumbnail extraction is best-effort */ }

    records.push({
      index: seq,
      filename: path,
      title: cleanTitle(pin.title),
      pinUrl: pin.pinUrl || '',
      imageUrl: pin.imageUrl || '',
      colors,
      thumb
    });
  }

  if (!files.length) {
    setStatus('Could not download any images.', true);
    els.dl.disabled = false;
    return;
  }

  setStatus('Building palette and source sheet...', false, true);
  const boardPalette = mergePalette(records.map(r => r.colors), 8);
  const exportedAt = new Date().toISOString();

  // Provenance + creative artifacts bundled alongside the images.
  files.push({ name: 'manifest.csv', data: textBytes(buildCsv(records)) });
  files.push({ name: 'manifest.json', data: textBytes(buildJson(records, boardPalette, exportedAt)) });
  files.push({ name: 'source-sheet.html', data: textBytes(buildCreditsHtml(records, boardPalette, exportedAt)) });

  setStatus('Building ZIP...', false, true);
  const blob = buildZip(files);
  const url = URL.createObjectURL(blob);
  const zipName = `imprint-${slug(boardName) || 'board'}.zip`;

  chrome.downloads.download({ url, filename: zipName, saveAs: true }, () => {
    setStatus(`Done. Saved ${records.length} images with source sheet, palette & manifest.`, false);
    els.dl.disabled = false;
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
});

async function tryFetch(u) {
  try {
    const res = await fetch(u);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch (e) {
    return null;
  }
}

function guessExt(u) {
  const m = (u || '').match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i);
  return m ? '.' + m[1].toLowerCase() : '.jpg';
}

// Determine the real image extension from the file's magic bytes, falling
// back to the URL. Fixes cases where a WebP/PNG is served from a .jpg-looking
// URL (or no extension at all).
function sniffExt(bytes, url) {
  const b = bytes;
  if (b && b.length > 12) {
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return '.png';
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return '.jpg';
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return '.gif';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return '.webp';
  }
  return guessExt(url);
}

// Tidy Pinterest's auto-generated alt text into a readable caption.
function cleanTitle(s) {
  let t = (s || '').trim();
  t = t.replace(/^this\s+(may\s+contain|contains|might\s+contain)\s*:?\s*/i, '');
  t = t.replace(/^(may\s+contain|image\s+may\s+contain)\s*:?\s*/i, '');
  t = t.trim();
  if (t) t = t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

function textBytes(str) {
  return new TextEncoder().encode(str);
}

// Filename-safe slug from a pin title / board name.
function slug(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

// --- Color extraction (Canvas API, fully local) ---

// Decode raw image bytes into a downscaled canvas for sampling.
async function decodeToCanvas(bytes, maxSize) {
  if (typeof createImageBitmap !== 'function') return null;
  const blob = new Blob([bytes]);
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, maxSize / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  return { canvas, ctx };
}

function colorDist(a, b) {
  const dr = a.rgb[0] - b.rgb[0];
  const dg = a.rgb[1] - b.rgb[1];
  const db = a.rgb[2] - b.rgb[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// Quantize an ImageData into up to `maxColors` representative colors.
// Buckets by 4 bits/channel, averages real pixels per bucket, then greedily
// picks the most frequent buckets that are visually distinct from each other.
function quantize(imageData, maxColors) {
  const d = imageData.data;
  const buckets = new Map();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 125) continue; // skip transparent pixels
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    let bk = buckets.get(key);
    if (!bk) { bk = { c: 0, r: 0, g: 0, b: 0 }; buckets.set(key, bk); }
    bk.c++; bk.r += r; bk.g += g; bk.b += b;
  }
  const arr = [...buckets.values()].map(bk => ({
    count: bk.c,
    rgb: [Math.round(bk.r / bk.c), Math.round(bk.g / bk.c), Math.round(bk.b / bk.c)]
  }));
  arr.sort((a, b) => b.count - a.count);

  const picked = [];
  for (const cand of arr) {
    if (picked.length >= maxColors) break;
    if (picked.some(p => colorDist(p, cand) < 42)) continue;
    picked.push(cand);
  }
  return picked.map(p => ({ hex: rgbToHex(p.rgb[0], p.rgb[1], p.rgb[2]), rgb: p.rgb }));
}

// Merge per-image palettes into one board-level scheme. Colors that recur
// across multiple images (within a distance threshold) rank highest.
function mergePalette(paletteList, maxColors) {
  const clusters = []; // { rgb, weight }
  paletteList.forEach((palette, imgIdx) => {
    (palette || []).forEach((color, rank) => {
      const weight = (palette.length - rank); // top colors weigh more
      const existing = clusters.find(c => colorDist(c, color) < 42);
      if (existing) {
        existing.weight += weight;
      } else {
        clusters.push({ rgb: color.rgb.slice(), hex: color.hex, weight });
      }
    });
  });
  clusters.sort((a, b) => b.weight - a.weight);
  return clusters.slice(0, maxColors).map(c => ({ hex: c.hex, rgb: c.rgb }));
}

// --- Manifest builders ---

function csvCell(v) {
  const s = (v == null ? '' : String(v));
  return '"' + s.replace(/"/g, '""') + '"';
}

function buildCsv(records) {
  const header = ['index', 'filename', 'title', 'pin_url', 'image_url', 'colors'];
  const rows = [header.map(csvCell).join(',')];
  for (const r of records) {
    rows.push([
      csvCell(r.index),
      csvCell(r.filename),
      csvCell(r.title),
      csvCell(r.pinUrl),
      csvCell(r.imageUrl),
      csvCell((r.colors || []).map(c => c.hex).join(' | '))
    ].join(','));
  }
  return rows.join('\r\n');
}

function buildJson(records, boardPalette, exportedAt) {
  return JSON.stringify({
    board: boardName,
    boardUrl,
    exportedAt,
    palette: boardPalette,
    imageCount: records.length,
    images: records.map(r => ({
      index: r.index,
      filename: r.filename,
      title: r.title,
      pinUrl: r.pinUrl,
      imageUrl: r.imageUrl,
      colors: r.colors
    }))
  }, null, 2);
}

// --- Branded Source & Credits sheet (self-contained HTML, print-to-PDF) ---

function esc(s) {
  return (s == null ? '' : String(s)).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function swatchRow(colors) {
  if (!colors || !colors.length) return '';
  return '<div class="swatches">' + colors.map(c =>
    `<span class="sw" style="background:${esc(c.hex)}" title="${esc(c.hex)}"></span><span class="hex">${esc(c.hex)}</span>`
  ).join('') + '</div>';
}

function buildCreditsHtml(records, boardPalette, exportedAt) {
  const dateStr = new Date(exportedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  const cards = records.map(r => {
    const thumb = r.thumb
      ? `<img class="thumb" src="${r.thumb}" alt="">`
      : `<div class="thumb noimg">No preview</div>`;
    const link = r.pinUrl
      ? `<a class="src" href="${esc(r.pinUrl)}" target="_blank" rel="noopener">View source on Pinterest &rarr;</a>`
      : `<span class="src muted">Source link unavailable</span>`;
    return `
      <div class="item">
        ${thumb}
        <div class="meta">
          <div class="t">${esc(r.title || 'Untitled')}</div>
          <div class="fn">${esc(r.filename)}</div>
          ${link}
          ${swatchRow(r.colors)}
        </div>
      </div>`;
  }).join('');

  const boardSwatches = boardPalette.map(c =>
    `<div class="bp"><span class="bpsw" style="background:${esc(c.hex)}"></span><span class="bphex">${esc(c.hex)}</span></div>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(boardName)} — Source Sheet | IMPRINT Connect</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Playfair+Display:ital,wght@0,500;0,600;1,500&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#F9F8F6; --card:#FFFDFB; --charcoal:#2B2926; --muted:#908A80;
    --gold:#B08D4F; --gold-soft:#C9B48A; --line:#ECE7DF;
  }
  *{margin:0;padding:0;box-sizing:border-box;}
  body{background:var(--bg);color:var(--charcoal);font-family:'Inter',-apple-system,'Segoe UI',sans-serif;padding:48px 32px;}
  .wrap{max-width:920px;margin:0 auto;}
  .eyebrow{font-size:10px;letter-spacing:2.6px;text-transform:uppercase;color:var(--muted);font-weight:500;}
  h1{font-family:'Playfair Display',Georgia,serif;font-style:italic;font-weight:500;font-size:34px;margin:8px 0 4px;}
  .sub{color:var(--muted);font-size:13px;}
  .board-palette{display:flex;flex-wrap:wrap;gap:14px;margin:24px 0 8px;}
  .bp{display:flex;flex-direction:column;align-items:center;gap:6px;}
  .bpsw{width:54px;height:54px;border-radius:10px;border:1px solid rgba(0,0,0,0.06);}
  .bphex{font-size:10px;letter-spacing:1px;color:var(--muted);}
  hr{border:0;height:1px;background:var(--line);margin:28px 0;}
  .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:20px;}
  .item{display:flex;gap:16px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;}
  .thumb{width:120px;height:120px;min-width:120px;object-fit:cover;border-radius:10px;background:#eee;}
  .thumb.noimg{display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;}
  .meta{display:flex;flex-direction:column;gap:6px;min-width:0;}
  .t{font-weight:600;font-size:13px;line-height:1.35;}
  .fn{font-size:10px;color:var(--muted);font-family:ui-monospace,Menlo,monospace;}
  .src{font-size:11px;color:var(--gold);text-decoration:none;}
  .src:hover{text-decoration:underline;}
  .src.muted{color:var(--muted);}
  .swatches{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:4px;}
  .sw{width:16px;height:16px;border-radius:4px;border:1px solid rgba(0,0,0,0.08);}
  .hex{font-size:9px;color:var(--muted);margin-right:6px;letter-spacing:.5px;}
  .toolbar{position:sticky;top:0;text-align:right;margin-bottom:18px;}
  .print{background:var(--charcoal);color:#F4F1EC;border:0;border-radius:999px;padding:10px 20px;font-size:11px;letter-spacing:2px;text-transform:uppercase;cursor:pointer;}
  .foot{margin-top:36px;font-size:9px;letter-spacing:1.6px;text-transform:uppercase;color:var(--muted);text-align:center;}
  @media print{
    body{background:#fff;padding:0;}
    .toolbar{display:none;}
    .item{break-inside:avoid;}
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="toolbar"><button class="print" onclick="window.print()">Save as PDF</button></div>
    <div class="eyebrow">IMPRINT Connect &middot; Source &amp; Credits Sheet</div>
    <h1>${esc(boardName)}</h1>
    <div class="sub">${records.length} images &middot; Exported ${esc(dateStr)}${boardUrl ? ` &middot; <a href="${esc(boardUrl)}" target="_blank" rel="noopener" style="color:var(--gold);text-decoration:none;">Original board</a>` : ''}</div>

    ${boardPalette.length ? `<div class="eyebrow" style="margin-top:26px;">Board Palette</div><div class="board-palette">${boardSwatches}</div>` : ''}

    <hr>
    <div class="grid">${cards}</div>

    <div class="foot">Generated locally by IMPRINT Connect &middot; Not affiliated with Pinterest &middot; Verify usage rights before reuse</div>
  </div>
</body>
</html>`;
}

// --- Minimal ZIP builder (STORE method, no compression) ---
// Images are already compressed (JPEG/PNG), so storing is fine and avoids
// needing any compression library in the browser.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function buildZip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const data = f.data;
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0, true);
    dv.setUint16(8, 0, true);   // method 0 = store
    dv.setUint16(10, 0, true);
    dv.setUint16(12, 0, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    parts.push(local, data);

    const c = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);  // method 0 = store
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    c.set(nameBytes, 46);
    central.push(c);

    offset += local.length + data.length;
  }

  const centralSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
