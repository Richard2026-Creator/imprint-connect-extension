// =====================================================================
// IMPRINT Connect — core.js
// Reusable, UI-agnostic logic shared by the side panel:
//   - Pinterest board scanning (injected into the page)
//   - Local color-palette extraction (Canvas API)
//   - Library Pack export (images/ + manifest.csv + PDF source sheet,
//     the latter via the vendored jsPDF library — see jspdf.umd.min.js)
//   - Minimal STORE-method ZIP builder
// Everything runs locally in the browser. No servers, no accounts, no cost.
// =====================================================================

// ---------------------------------------------------------------------
// Injected into the Pinterest tab, one round per call, so the side panel
// can show a live pin count and let the user cancel between rounds (a
// single blocking call couldn't be interrupted or report progress).
// State is kept on `window` between calls since each injected function
// runs in a fresh, self-contained scope. Ignores the "More ideas"
// suggestions section. Must be fully self-contained (serialized by
// chrome.scripting).
// ---------------------------------------------------------------------
function scanInit() {
  window.__imprintScan = { collected: new Map(), stable: 0, calls: 0 };
  return true;
}

async function scanStep(maxPins) {
  const state = window.__imprintScan || (window.__imprintScan = { collected: new Map(), stable: 0, calls: 0 });

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

      if (!state.collected.has(originalUrl)) {
        state.collected.set(originalUrl, {
          imageUrl: originalUrl,
          thumbnailUrl: src,
          title: (img.alt || '').trim(),
          pinUrl
        });
      }
    });
  }

  const before = state.collected.size;
  let boundaryY = getBoundaryY();
  const atBoundaryAlready = boundaryY !== Infinity && (window.scrollY + window.innerHeight) >= boundaryY;

  if (state.calls === 0) {
    // First call: harvest whatever is already on screen, no scroll yet.
    harvest(boundaryY);
  } else if (before < maxPins && !atBoundaryAlready) {
    window.scrollBy(0, window.innerHeight * 1.5);
    await new Promise(r => setTimeout(r, 1200));
    boundaryY = getBoundaryY();
    harvest(boundaryY);
  }
  state.calls++;

  if (state.collected.size === before) state.stable++; else state.stable = 0;
  const reachedBoundary = boundaryY !== Infinity && (window.scrollY + window.innerHeight) >= boundaryY;
  const done = state.collected.size >= maxPins || reachedBoundary || state.stable >= 6;

  return {
    boardName: getBoardName(),
    boardUrl: location.href,
    pins: Array.from(state.collected.values()).slice(0, maxPins),
    done
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

// ---------------------------------------------------------------------
// Branded Source & Credits sheet as a real PDF (jsPDF, vendored locally —
// runs entirely in the browser, no server, no ongoing cost).
// ---------------------------------------------------------------------
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

// Normalizes any user-uploaded logo format (PNG/JPEG/WEBP/SVG) to a PNG
// data URL jsPDF can embed reliably, rasterized large enough to stay
// crisp when placed in the PDF. Returns the source's aspect ratio too,
// so the caller can fit it into a max box without stretching it.
function logoToPngDataUrl(dataUrl, maxPixels) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxPixels / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve({ dataUrl: canvas.toDataURL('image/png'), aspect: img.naturalWidth / img.naturalHeight });
    };
    img.onerror = () => reject(new Error('Could not read logo image'));
    img.src = dataUrl;
  });
}

// Truncates text to fit one line (with an ellipsis), using the PDF's own
// font metrics so it never overflows into the next column.
function fitLine(doc, text, maxWidth) {
  const s = text || '';
  if (!s || doc.getTextWidth(s) <= maxWidth) return s;
  let t = s;
  while (t.length > 1 && doc.getTextWidth(t + '…') > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

async function buildSourceSheetPdf(records, boardPalette, exportedAt, board) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const CHARCOAL = hexToRgb('#2B2926');
  const MUTED = hexToRgb('#908A80');
  const GOLD = hexToRgb('#B08D4F');
  const LINE = hexToRgb('#ECE7DF');

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentW = pageW - margin * 2;
  let y = margin;

  // --- Brand block ---
  if (board.logo) {
    try {
      const logo = await logoToPngDataUrl(board.logo, 600);
      const maxW = 60, maxH = 18;
      let w = maxW, h = maxW / logo.aspect;
      if (h > maxH) { h = maxH; w = maxH * logo.aspect; }
      doc.addImage(logo.dataUrl, 'PNG', margin, y, w, h);
      y += h + 6;
    } catch (e) {
      y += 2;
    }
  } else {
    doc.setFont('times', 'italic');
    doc.setFontSize(20);
    doc.setTextColor(...CHARCOAL);
    doc.text('IMPRINT Connect', margin, y + 8);
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.6);
    doc.line(margin, y + 11, margin + 46, y + 11);
    y += 18;
  }

  // --- Eyebrow / title / subheading ---
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text('SOURCE & CREDITS SHEET', margin, y);
  y += 7;

  doc.setFont('times', 'italic');
  doc.setFontSize(18);
  doc.setTextColor(...CHARCOAL);
  doc.text(fitLine(doc, board.name || 'Untitled Project', contentW), margin, y);
  y += 6;

  const dateStr = new Date(exportedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(`${records.length} images  ·  Exported ${dateStr}`, margin, y);
  y += 8;

  // --- Palette ---
  if (boardPalette && boardPalette.length) {
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text('PALETTE', margin, y);
    y += 4;
    let sx = margin;
    boardPalette.forEach(c => {
      const [r, g, b] = hexToRgb(c.hex);
      doc.setFillColor(r, g, b);
      doc.roundedRect(sx, y, 10, 10, 1.5, 1.5, 'F');
      doc.setFontSize(6.5);
      doc.setTextColor(...MUTED);
      doc.text(c.hex, sx + 5, y + 13, { align: 'center' });
      sx += 14;
    });
    y += 18;
  }

  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  // --- Item rows ---
  const rowH = 32;
  const thumbSize = 26;

  function newPage() {
    doc.addPage();
    y = margin;
  }

  for (const r of records) {
    if (y + rowH > pageH - margin) newPage();

    if (r.thumb && r.thumbW && r.thumbH) {
      const scale = Math.min(thumbSize / r.thumbW, thumbSize / r.thumbH);
      const w = r.thumbW * scale, h = r.thumbH * scale;
      doc.addImage(r.thumb, 'JPEG', margin + (thumbSize - w) / 2, y + (thumbSize - h) / 2, w, h);
    } else {
      doc.setFillColor(...LINE);
      doc.roundedRect(margin, y, thumbSize, thumbSize, 2, 2, 'F');
    }

    const textX = margin + thumbSize + 5;
    const textW = pageW - margin - textX;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...CHARCOAL);
    doc.text(fitLine(doc, r.title || 'Untitled', textW), textX, y + 5);

    doc.setFont('courier', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(fitLine(doc, r.filename, textW), textX, y + 10);

    const tags = [r.room, r.category, r.style, r.status].filter(Boolean).join('   ·   ');
    if (tags) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...GOLD);
      doc.text(fitLine(doc, tags, textW), textX, y + 15);
    }

    doc.setFontSize(8.5);
    if (r.pinUrl) {
      doc.setTextColor(...GOLD);
      doc.textWithLink('View source on Pinterest →', textX, y + 20, { url: r.pinUrl });
    } else {
      doc.setTextColor(...MUTED);
      doc.text('Source link unavailable', textX, y + 20);
    }

    if (r.colors && r.colors.length) {
      let sx = textX;
      r.colors.slice(0, 6).forEach(c => {
        const [cr, cg, cb] = hexToRgb(c.hex);
        doc.setFillColor(cr, cg, cb);
        doc.rect(sx, y + 23, 3.5, 3.5, 'F');
        sx += 5;
      });
    }

    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.2);
    doc.line(margin, y + rowH - 2, pageW - margin, y + rowH - 2);

    y += rowH;
  }

  // --- Footer + page numbers on every page ---
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(
      `Generated locally by IMPRINT Connect  ·  Not affiliated with Pinterest  ·  Verify usage rights before reuse  ·  Page ${p} of ${totalPages}`,
      pageW / 2, pageH - 8, { align: 'center' }
    );
  }

  return new Uint8Array(doc.output('arraybuffer'));
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
    let thumbW = 0, thumbH = 0;
    try {
      const ic = await decodeToCanvas(data, 200);
      if (ic) {
        const imgData = ic.ctx.getImageData(0, 0, ic.canvas.width, ic.canvas.height);
        colors = quantize(imgData, 5);
        thumb = ic.canvas.toDataURL('image/jpeg', 0.7);
        thumbW = ic.canvas.width;
        thumbH = ic.canvas.height;
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
      thumb,
      thumbW,
      thumbH
    });
  }

  if (!files.length) return null;

  const palette = mergePalette(records.map(r => r.colors), 8);
  const exportedAt = new Date().toISOString();
  files.push({ name: 'manifest.csv', data: textBytes(buildCsv(records)) });
  const pdfBytes = await buildSourceSheetPdf(records, palette, exportedAt, board);
  files.push({ name: 'source-sheet.pdf', data: pdfBytes });

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
