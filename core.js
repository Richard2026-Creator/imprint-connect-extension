// =====================================================================
// IMPRINT Connect — core.js
// Reusable, UI-agnostic logic shared by the side panel:
//   - Pinterest board scanning (injected into the page)
//   - Local color-palette extraction (Canvas API)
//   - Library Pack export (images/ + manifest.csv/json + source sheet)
//   - Minimal STORE-method ZIP builder
// Everything runs locally in the browser. No servers, no libraries, no cost.
// =====================================================================

// ---------------------------------------------------------------------
// Injected into the Pinterest tab. Scrolls the board and accumulates pin
// image URLs + provenance, ignoring the "More ideas" suggestions section.
// Must be fully self-contained (it is serialized by chrome.scripting).
// ---------------------------------------------------------------------
async function scrollAndCollect(maxPins) {
  const collected = new Map();

  function getBoardName() {
    const h = document.querySelector('h1');
    const ht = h && h.textContent ? h.textContent.trim() : '';
    if (ht) return ht;
    const t = (document.title || '').split('|')[0].trim();
    return t || 'Pinterest Board';
  }

  function getBoundaryY() {
    const headingMatch = /^(more ideas|more like this|more to explore|ideas you might love|inspired by|related ideas)/i;
    let marker = document.querySelector('[data-test-id="board-feed-related-pins"], [data-test-id="moreIdeas"], [data-test-id="more-ideas-header"]');
    if (marker) return marker.getBoundingClientRect().top + window.scrollY;
    const headings = document.querySelectorAll('h1, h2, h3, h4, [role="heading"]');
    for (const h of headings) {
      const t = (h.textContent || '').trim();
      if (headingMatch.test(t)) return h.getBoundingClientRect().top + window.scrollY;
    }
    return Infinity;
  }

  function harvest(boundaryY) {
    let nodes = Array.from(document.querySelectorAll('[data-test-id="pin"], [data-test-id="pinWrapper"]'));
    if (nodes.length === 0) nodes = Array.from(document.querySelectorAll('a[href*="/pin/"]'));
    nodes.forEach((node) => {
      const top = node.getBoundingClientRect().top + window.scrollY;
      if (top >= boundaryY) return;

      const img = node.querySelector('img');
      if (!img) return;
      let src = img.src || img.getAttribute('data-src') || '';
      if (!src.includes('pinimg.com')) return;
      if (/\/(30x30|45x45|50x50|60x60|75x75|140x140)\//.test(src)) return;
      let best = src;
      const srcset = img.getAttribute('srcset');
      if (srcset) {
        const parts = srcset.split(',').map(s => s.trim().split(' ')[0]).filter(u => u.includes('pinimg.com'));
        if (parts.length) best = parts[parts.length - 1];
      }
      const originalUrl = best.replace(/\/\d+x\d*\//, '/originals/');

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
    const boundaryY = getBoundaryY();
    if (boundaryY !== Infinity && (window.scrollY + window.innerHeight) >= boundaryY) break;
    window.scrollBy(0, window.innerHeight * 1.5);
    await new Promise(r => setTimeout(r, 1200));
    harvest(getBoundaryY());
    if (collected.size === before) {
      stable++;
      if (stable >= 6) break;
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

// ---------------------------------------------------------------------
// Small string / file helpers
// ---------------------------------------------------------------------
function esc(s) {
  return (s == null ? '' : String(s)).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function slug(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function cleanTitle(s) {
  let t = (s || '').trim();
  t = t.replace(/^this\s+(may\s+contain|contains|might\s+contain)\s*:?\s*/i, '');
  t = t.replace(/^(may\s+contain|image\s+may\s+contain)\s*:?\s*/i, '');
  t = t.trim();
  if (t) t = t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

// A tidy, human-friendly auto label for filenames / captions. Strips
// Pinterest's auto-caption noise and superfluous lead-ins ("an image of",
// "photo of", "there is a", a leading article), trims to a few words, and
// Title-Cases the result. e.g. "this may contain: an image of a cozy
// living room with wall art" -> "Cozy Living Room With Wall Art".
function autoLabel(s) {
  let t = cleanTitle(s);
  t = t.replace(/^(an?\s+)?(image|images|photo|photograph|picture|pic|close[\s-]?up|snapshot|view|rendering|render)\s+(of\s+)?/i, '');
  t = t.replace(/^there\s+(is|are)\s+/i, '');
  t = t.replace(/^(a|an|the)\s+/i, '');
  t = t.trim();
  if (!t) return '';
  const words = t.split(/\s+/).slice(0, 8);
  t = words.join(' ');
  t = t.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return t;
}

// Make a string safe to use as a file name (removes characters Windows /
// macOS disallow, collapses whitespace, caps the length).
function fileSafe(s) {
  return (s || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim();
}

function guessExt(u) {
  const m = (u || '').match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i);
  return m ? '.' + m[1].toLowerCase() : '.jpg';
}

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

function textBytes(str) {
  return new TextEncoder().encode(str);
}

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

// ---------------------------------------------------------------------
// Color extraction (Canvas API, fully local)
// ---------------------------------------------------------------------
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

function quantize(imageData, maxColors) {
  const d = imageData.data;
  const buckets = new Map();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 125) continue;
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

function mergePalette(paletteList, maxColors) {
  const clusters = [];
  paletteList.forEach((palette) => {
    (palette || []).forEach((color, rank) => {
      const weight = (palette.length - rank);
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

// ---------------------------------------------------------------------
// Manifest builders
// ---------------------------------------------------------------------
function csvCell(v) {
  const s = (v == null ? '' : String(v));
  return '"' + s.replace(/"/g, '""') + '"';
}

function buildCsv(records) {
  const header = ['index', 'filename', 'title', 'type', 'room', 'category', 'style', 'status', 'pin_url', 'image_url', 'colors'];
  const rows = [header.map(csvCell).join(',')];
  for (const r of records) {
    rows.push([
      csvCell(r.index),
      csvCell(r.filename),
      csvCell(r.title),
      csvCell(r.kind === 'product' ? 'Product' : 'Inspiration'),
      csvCell(r.room),
      csvCell(r.category),
      csvCell(r.style),
      csvCell(r.status),
      csvCell(r.pinUrl),
      csvCell(r.imageUrl),
      csvCell((r.colors || []).map(c => c.hex).join(' | '))
    ].join(','));
  }
  return rows.join('\r\n');
}

function buildJson(records, boardPalette, exportedAt, board) {
  return JSON.stringify({
    project: board.name,
    source: board.url || '',
    exportedAt,
    palette: boardPalette,
    imageCount: records.length,
    images: records.map(r => ({
      index: r.index,
      filename: r.filename,
      title: r.title,
      type: r.kind === 'product' ? 'Product' : 'Inspiration',
      room: r.room,
      category: r.category,
      style: r.style,
      status: r.status,
      pinUrl: r.pinUrl,
      imageUrl: r.imageUrl,
      colors: r.colors
    }))
  }, null, 2);
}

// ---------------------------------------------------------------------
// Branded Source & Credits sheet (self-contained HTML, print-to-PDF)
// ---------------------------------------------------------------------
function swatchRow(colors) {
  if (!colors || !colors.length) return '';
  return '<div class="swatches">' + colors.map(c =>
    `<span class="sw" style="background:${esc(c.hex)}" title="${esc(c.hex)}"></span><span class="hex">${esc(c.hex)}</span>`
  ).join('') + '</div>';
}

function tagLine(r) {
  const bits = [r.room, r.category, r.style, r.status].filter(Boolean);
  if (!bits.length) return '';
  return `<div class="tags">${bits.map(b => `<span class="tag">${esc(b)}</span>`).join('')}</div>`;
}

function buildCreditsHtml(records, boardPalette, exportedAt, board) {
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
          ${tagLine(r)}
          ${link}
          ${swatchRow(r.colors)}
        </div>
      </div>`;
  }).join('');

  const boardSwatches = boardPalette.map(c =>
    `<div class="bp"><span class="bpsw" style="background:${esc(c.hex)}"></span><span class="bphex">${esc(c.hex)}</span></div>`
  ).join('');

  const brandBlock = board.logo
    ? `<div class="brandmark"><img src="${board.logo}" alt=""></div>`
    : `<div class="brandmark"><div class="lockup"><div class="imprint">IMPRINT<span class="tm">&#8482;</span></div><div class="rule"></div><div class="connect">Connect</div></div></div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(board.name)} — Source Sheet | IMPRINT Connect</title>
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
  .tags{display:flex;flex-wrap:wrap;gap:5px;margin:2px 0;}
  .tag{font-size:8.5px;letter-spacing:1px;text-transform:uppercase;color:var(--gold);border:1px solid var(--gold-soft);border-radius:999px;padding:2px 8px;}
  .src{font-size:11px;color:var(--gold);text-decoration:none;}
  .src:hover{text-decoration:underline;}
  .src.muted{color:var(--muted);}
  .swatches{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:4px;}
  .sw{width:16px;height:16px;border-radius:4px;border:1px solid rgba(0,0,0,0.08);}
  .hex{font-size:9px;color:var(--muted);margin-right:6px;letter-spacing:.5px;}
  .toolbar{position:sticky;top:0;text-align:right;margin-bottom:18px;}
  .print{background:var(--charcoal);color:#F4F1EC;border:0;border-radius:999px;padding:10px 20px;font-size:11px;letter-spacing:2px;text-transform:uppercase;cursor:pointer;}
  .foot{margin-top:36px;font-size:9px;letter-spacing:1.6px;text-transform:uppercase;color:var(--muted);text-align:center;}
  .brandmark{margin-bottom:20px;}
  .brandmark img{max-height:64px;max-width:280px;width:auto;display:block;}
  .lockup{display:inline-flex;flex-direction:column;align-items:flex-start;}
  .lockup .imprint{font-family:'Playfair Display',Georgia,serif;font-weight:600;font-size:30px;letter-spacing:6px;color:var(--charcoal);line-height:1;}
  .lockup .imprint .tm{font-size:11px;vertical-align:super;letter-spacing:0;}
  .lockup .rule{align-self:stretch;height:2px;background:var(--gold);margin:6px 0;}
  .lockup .connect{font-family:'Inter',sans-serif;font-size:11px;font-weight:500;letter-spacing:9px;text-transform:uppercase;color:var(--charcoal-soft);align-self:center;}
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
    ${brandBlock}
    <div class="eyebrow">Source &amp; Credits Sheet</div>
    <h1>${esc(board.name)}</h1>
    <div class="sub">${records.length} images &middot; Exported ${esc(dateStr)}${board.url ? ` &middot; <a href="${esc(board.url)}" target="_blank" rel="noopener" style="color:var(--gold);text-decoration:none;">Source</a>` : ''}</div>

    ${boardPalette.length ? `<div class="eyebrow" style="margin-top:26px;">Palette</div><div class="board-palette">${boardSwatches}</div>` : ''}

    <hr>
    <div class="grid">${cards}</div>

    <div class="foot">Generated locally by IMPRINT Connect &middot; Not affiliated with Pinterest &middot; Verify usage rights before reuse</div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------
// Library Pack export: fetch images, extract colors, bundle a clean ZIP.
//   items: [{ imageUrl, thumbnailUrl, pinUrl, title, room, category, style, status }]
//   board: { name, url }
//   onProgress(done, total) optional
// Returns { blob, count, palette } or null if nothing could be downloaded.
// ---------------------------------------------------------------------
async function buildLibraryPack(items, board, options) {
  options = options || {};
  const naming = options.naming || 'numbered';   // 'numbered' | 'auto' | 'custom'
  const onProgress = options.onProgress;
  const files = [];
  const records = [];
  let seq = 0;

  for (let i = 0; i < items.length; i++) {
    if (onProgress) onProgress(i + 1, items.length);
    const it = items[i];

    let data = await tryFetch(it.imageUrl);
    if (!data || data.length < 1000) data = await tryFetch(it.thumbnailUrl);
    if (!data || data.length <= 500) continue;

    seq++;
    const ext = sniffExt(data, it.imageUrl);
    const pad = String(seq).padStart(4, '0');

    // The caption shown in the panel / source sheet (user name wins).
    const displayTitle = (it.caption || '').trim() || autoLabel(it.title);

    // The descriptive part of the file name, per the chosen naming mode.
    let label = '';
    if (naming === 'auto') label = autoLabel(it.title);
    else if (naming === 'custom') label = (it.caption || '').trim() || autoLabel(it.title);
    const safe = fileSafe(label);
    const path = `images/${pad}${safe ? ' - ' + safe : ''}${ext}`;
    files.push({ name: path, data });

    let colors = [];
    let thumb = '';
    try {
      const ic = await decodeToCanvas(data, 200);
      if (ic) {
        const imgData = ic.ctx.getImageData(0, 0, ic.canvas.width, ic.canvas.height);
        colors = quantize(imgData, 5);
        thumb = ic.canvas.toDataURL('image/jpeg', 0.7);
      }
    } catch (e) { /* best-effort */ }

    records.push({
      index: seq,
      filename: path,
      title: displayTitle,
      kind: it.kind || 'inspiration',
      room: it.room || '',
      category: it.category || '',
      style: it.style || '',
      status: it.status || '',
      pinUrl: it.pinUrl || '',
      imageUrl: it.imageUrl || '',
      colors,
      thumb
    });
  }

  if (!files.length) return null;

  const palette = mergePalette(records.map(r => r.colors), 8);
  const exportedAt = new Date().toISOString();
  files.push({ name: 'manifest.csv', data: textBytes(buildCsv(records)) });
  files.push({ name: 'manifest.json', data: textBytes(buildJson(records, palette, exportedAt, board)) });
  files.push({ name: 'source-sheet.html', data: textBytes(buildCreditsHtml(records, palette, exportedAt, board)) });

  return { blob: buildZip(files), count: records.length, palette };
}

// ---------------------------------------------------------------------
// Minimal ZIP builder (STORE method, no compression)
// ---------------------------------------------------------------------
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
    dv.setUint16(8, 0, true);
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
    cv.setUint16(10, 0, true);
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
