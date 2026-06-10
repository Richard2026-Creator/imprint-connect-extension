// --- State ---
let pins = [];
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
    const card = document.createElement('div');
    card.className = 'card' + (selected.has(i) ? ' selected' : '');
    card.innerHTML = `<div class="chk"></div><img src="${pin.thumbnailUrl}" referrerpolicy="no-referrer" loading="lazy">`;
    card.addEventListener('click', () => {
      if (selected.has(i)) selected.delete(i); else selected.add(i);
      card.classList.toggle('selected');
      updateCount();
    });
    els.grid.appendChild(card);
  });
  updateCount();
}

// --- This function is injected into the Pinterest tab and runs there ---
// It scrolls the board and accumulates pin image URLs (Pinterest recycles
// off-screen pins, so we must collect continuously while scrolling).
async function scrollAndCollect(maxPins) {
  const collected = new Map();

  function harvest() {
    let nodes = Array.from(document.querySelectorAll('[data-test-id="pin"], [data-test-id="pinWrapper"]'));
    if (nodes.length === 0) nodes = Array.from(document.querySelectorAll('a[href*="/pin/"]'));
    nodes.forEach((node) => {
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
      if (!collected.has(originalUrl)) {
        collected.set(originalUrl, { imageUrl: originalUrl, thumbnailUrl: src, title: img.alt || '' });
      }
    });
  }

  harvest();
  let stable = 0;
  for (let i = 0; i < 500; i++) {
    const before = collected.size;
    if (before >= maxPins) break;
    window.scrollBy(0, window.innerHeight * 1.5);
    await new Promise(r => setTimeout(r, 1200));
    harvest();
    if (collected.size === before) {
      stable++;
      if (stable >= 6) break; // reached the bottom
    } else {
      stable = 0;
    }
  }
  return Array.from(collected.values()).slice(0, maxPins);
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
    pins = (results && results[0] && results[0].result) ? results[0].result : [];
    if (pins.length === 0) {
      setStatus('No pins found. Make sure you are viewing a board page (the grid of pins is visible).', true);
    } else {
      pins.forEach((_, i) => selected.add(i));
      setStatus(`Found ${pins.length} pins. Click any pin to toggle it, then Download ZIP.`, false);
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
  document.querySelectorAll('.card').forEach(c => c.classList.add('selected'));
  updateCount();
});

els.none.addEventListener('click', () => {
  selected.clear();
  document.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));
  updateCount();
});

// --- Download as ZIP ---
els.dl.addEventListener('click', async () => {
  const chosen = pins.filter((_, i) => selected.has(i));
  if (!chosen.length) return;

  els.dl.disabled = true;
  const files = [];

  for (let i = 0; i < chosen.length; i++) {
    setStatus(`Downloading image ${i + 1} of ${chosen.length}...`, false, true);
    const pin = chosen[i];
    let data = await tryFetch(pin.imageUrl);
    if (!data || data.length < 1000) data = await tryFetch(pin.thumbnailUrl);
    if (data && data.length > 500) {
      const ext = guessExt(pin.imageUrl);
      files.push({ name: `pin_${String(i + 1).padStart(4, '0')}${ext}`, data });
    }
  }

  if (!files.length) {
    setStatus('Could not download any images.', true);
    els.dl.disabled = false;
    return;
  }

  setStatus('Building ZIP...', false, true);
  const blob = buildZip(files);
  const url = URL.createObjectURL(blob);

  chrome.downloads.download({ url, filename: 'pinterest-board.zip', saveAs: true }, () => {
    setStatus(`Done. Saved ${files.length} images to a ZIP.`, false);
    els.dl.disabled = false;
    // Revoke a bit later so the download has time to read the blob
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
