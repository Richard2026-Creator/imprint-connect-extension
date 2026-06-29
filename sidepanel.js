// =====================================================================
// IMPRINT Connect — sidepanel.js
// Wires the persistent Library (db.js) and the export/scan logic
// (core.js) to the side-panel UI.
// =====================================================================

const CATEGORIES = ['Lighting', 'Furniture', 'Textiles', 'Flooring', 'Wall & Paint', 'Decor', 'Window', 'Kitchen', 'Bath', 'Outdoor', 'Art', 'Other'];
const STYLES = ['Modern', 'Contemporary', 'Mid-Century', 'Japandi', 'Scandinavian', 'Traditional', 'Transitional', 'Industrial', 'Coastal', 'Bohemian', 'Minimalist', 'Farmhouse', 'Art Deco', 'Other'];
const STATUSES = ['Proposed', 'Approved', 'Ordered', 'Rejected'];

// --- State ---
let currentProject = null;
let items = [];                 // items for the current project
let scanResults = [];           // pins from the latest scan
const scanSelected = new Set(); // indices selected in the scan panel

const el = (id) => document.getElementById(id);
const ui = {
  projectSelect: el('projectSelect'),
  newProjectBtn: el('newProjectBtn'),
  deleteProjectBtn: el('deleteProjectBtn'),
  projectMeta: el('projectMeta'),
  scanBtn: el('scanBtn'),
  exportBtn: el('exportBtn'),
  status: el('status'),
  scanPanel: el('scanPanel'),
  scanTitle: el('scanTitle'),
  scanCount: el('scanCount'),
  scanGrid: el('scanGrid'),
  scanRoom: el('scanRoom'),
  roomOptions: el('roomOptions'),
  scanAllBtn: el('scanAllBtn'),
  scanNoneBtn: el('scanNoneBtn'),
  addToLibraryBtn: el('addToLibraryBtn'),
  cancelScanBtn: el('cancelScanBtn'),
  filters: el('filters'),
  searchInput: el('searchInput'),
  filterRoom: el('filterRoom'),
  filterCategory: el('filterCategory'),
  filterStyle: el('filterStyle'),
  filterStatus: el('filterStatus'),
  itemCount: el('itemCount'),
  dedupeBtn: el('dedupeBtn'),
  namingMode: el('namingMode'),
  items: el('items'),
  modal: el('modal'),
  modalTitle: el('modalTitle'),
  modalBody: el('modalBody'),
  modalOk: el('modalOk'),
  modalCancel: el('modalCancel')
};

function setStatus(msg, isError, spinner) {
  ui.status.className = isError ? 'error' : '';
  ui.status.innerHTML = (spinner ? '<span class="spinner"></span>' : '') + (msg || '');
}

// ---------------------------------------------------------------------
// Branded modal dialogs (replace window.prompt / window.confirm)
// ---------------------------------------------------------------------
let modalResolve = null;

function closeModal(value) {
  ui.modal.style.display = 'none';
  ui.modalBody.innerHTML = '';
  const r = modalResolve;
  modalResolve = null;
  if (r) r(value);
}

// Resolves to the entered string, or null if cancelled.
function showPrompt(title, placeholder, okLabel) {
  return new Promise((resolve) => {
    modalResolve = resolve;
    ui.modalTitle.textContent = title;
    ui.modalBody.innerHTML = `<input type="text" id="modalInput" placeholder="${esc(placeholder || '')}">`;
    ui.modalOk.textContent = okLabel || 'Create';
    ui.modalCancel.style.display = '';
    ui.modal.style.display = 'flex';
    const input = el('modalInput');
    input.focus();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') closeModal(input.value);
      else if (e.key === 'Escape') closeModal(null);
    });
  });
}

// Resolves to true (confirmed) or false (cancelled).
function showConfirm(title, message, okLabel) {
  return new Promise((resolve) => {
    modalResolve = resolve;
    ui.modalTitle.textContent = title;
    ui.modalBody.innerHTML = `<div class="modal-msg">${esc(message)}</div>`;
    ui.modalOk.textContent = okLabel || 'Confirm';
    ui.modalCancel.style.display = '';
    ui.modal.style.display = 'flex';
  });
}

ui.modalOk.addEventListener('click', () => {
  const input = el('modalInput');
  closeModal(input ? input.value : true);
});
ui.modalCancel.addEventListener('click', () => {
  closeModal(el('modalInput') ? null : false);
});
ui.modal.addEventListener('click', (e) => {
  if (e.target === ui.modal) closeModal(el('modalInput') ? null : false);
});

function optionsHtml(values, selected, blankLabel) {
  const blank = `<option value="">${esc(blankLabel || '—')}</option>`;
  const opts = values.map(v => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v)}</option>`).join('');
  return blank + opts;
}

// ---------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------
async function init() {
  const stored = await chrome.storage.local.get('namingMode');
  if (stored && stored.namingMode) ui.namingMode.value = stored.namingMode;

  let projects = await listProjects();
  if (projects.length === 0) {
    const p = await createProject('My First Project', '');
    projects = [p];
  }
  renderProjectSelect(projects);
  await selectProject(projects[0].id);
}

function renderProjectSelect(projects) {
  ui.projectSelect.innerHTML = projects
    .map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)
    .join('');
}

async function selectProject(id) {
  currentProject = await getProject(id);
  if (!currentProject) return;
  ui.projectSelect.value = id;
  renderProjectMeta();
  hideScanPanel();
  await loadItems();
}

function renderProjectMeta() {
  if (!currentProject) { ui.projectMeta.textContent = ''; return; }
  const parts = [];
  parts.push(`<b>${items.length}</b> images`);
  if (currentProject.rooms.length) parts.push(`<b>${currentProject.rooms.length}</b> rooms`);
  ui.projectMeta.innerHTML = parts.join(' &middot; ');
}

async function newProject() {
  const name = await showPrompt('New Project', 'e.g. Julie – Living Rooms', 'Create');
  if (name === null) return;
  const p = await createProject((name || '').trim() || 'Untitled Project', '');
  renderProjectSelect(await listProjects());
  await selectProject(p.id);
  setStatus(`Created project "${esc(p.name)}".`, false);
}

async function removeProject() {
  if (!currentProject) return;
  const ok = await showConfirm('Delete Project', `Delete "${currentProject.name}" and all ${items.length} saved images? This cannot be undone.`, 'Delete');
  if (!ok) return;
  await deleteProject(currentProject.id);
  let projects = await listProjects();
  if (projects.length === 0) projects = [await createProject('My First Project', '')];
  renderProjectSelect(projects);
  await selectProject(projects[0].id);
  setStatus('Project deleted.', false);
}

// ---------------------------------------------------------------------
// Scanning a board
// ---------------------------------------------------------------------
async function scanCurrentBoard() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/pinterest\.com\//.test(tab.url || '')) {
    setStatus('Open a Pinterest board in the active tab, then click Scan.', true);
    return;
  }
  ui.scanBtn.disabled = true;
  setStatus('Scanning and scrolling the board... this can take 20-60 seconds.', false, true);
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrollAndCollect,
      args: [1000]
    });
    const out = (results && results[0] && results[0].result) ? results[0].result : {};
    scanResults = out.pins || [];
    if (scanResults.length === 0) {
      setStatus('No pins found. Make sure a board grid is visible.', true);
    } else {
      scanSelected.clear();
      scanResults.forEach((_, i) => scanSelected.add(i));
      ui.scanTitle.textContent = `Found ${scanResults.length} pins on "${out.boardName || 'this board'}"`;
      if (!ui.scanRoom.value) ui.scanRoom.value = '';
      renderScanGrid();
      ui.scanPanel.style.display = 'block';
      setStatus('', false);
    }
  } catch (e) {
    setStatus('Scan failed: ' + e.message, true);
  } finally {
    ui.scanBtn.disabled = false;
  }
}

function renderScanGrid() {
  ui.scanCount.textContent = `${scanSelected.size} of ${scanResults.length} selected`;
  ui.scanGrid.innerHTML = '';
  scanResults.forEach((pin, i) => {
    const div = document.createElement('div');
    div.className = 'scan-pin' + (scanSelected.has(i) ? ' selected' : '');
    div.innerHTML = `<div class="chk"></div><img src="${esc(pin.thumbnailUrl)}" referrerpolicy="no-referrer" loading="lazy" alt="">`;
    div.addEventListener('click', () => {
      if (scanSelected.has(i)) scanSelected.delete(i); else scanSelected.add(i);
      div.classList.toggle('selected');
      ui.scanCount.textContent = `${scanSelected.size} of ${scanResults.length} selected`;
    });
    ui.scanGrid.appendChild(div);
  });
}

function hideScanPanel() {
  ui.scanPanel.style.display = 'none';
  scanResults = [];
  scanSelected.clear();
}

async function addSelectedToLibrary() {
  if (!currentProject) return;
  const chosen = scanResults.filter((_, i) => scanSelected.has(i));
  if (!chosen.length) { setStatus('Select at least one pin to add.', true); return; }
  const room = ui.scanRoom.value.trim();
  if (room) await addRoom(currentProject.id, room);
  const { added, skipped } = await addItems(currentProject.id, chosen, room);
  currentProject = await getProject(currentProject.id);
  hideScanPanel();
  ui.scanRoom.value = '';
  await loadItems();
  const skipMsg = skipped ? ` (${skipped} already in library)` : '';
  setStatus(`Added ${added} image${added === 1 ? '' : 's'}${room ? ` to ${esc(room)}` : ''}${skipMsg}.`, false);
}

// ---------------------------------------------------------------------
// Items + filters
// ---------------------------------------------------------------------
async function loadItems() {
  items = await listItems(currentProject.id);
  populateFilters();
  renderProjectMeta();
  renderItems();
  ui.exportBtn.disabled = items.length === 0;
}

function roomList() {
  const rooms = new Set(currentProject.rooms || []);
  items.forEach(it => { if (it.room) rooms.add(it.room); });
  return Array.from(rooms).sort((a, b) => a.localeCompare(b));
}

function populateFilters() {
  const rooms = roomList();
  ui.roomOptions.innerHTML = rooms.map(r => `<option value="${esc(r)}">`).join('');

  const keep = {
    room: ui.filterRoom.value, category: ui.filterCategory.value,
    style: ui.filterStyle.value, status: ui.filterStatus.value
  };
  ui.filterRoom.innerHTML = `<option value="">All rooms</option><option value="__none__">Unassigned</option>`
    + rooms.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
  ui.filterCategory.innerHTML = `<option value="">All categories</option>` + CATEGORIES.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  ui.filterStyle.innerHTML = `<option value="">All styles</option>` + STYLES.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  ui.filterStatus.innerHTML = `<option value="">Any status</option>` + STATUSES.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  ui.filterRoom.value = keep.room || '';
  ui.filterCategory.value = keep.category || '';
  ui.filterStyle.value = keep.style || '';
  ui.filterStatus.value = keep.status || '';
}

function filteredItems() {
  const q = ui.searchInput.value.trim().toLowerCase();
  const room = ui.filterRoom.value;
  const cat = ui.filterCategory.value;
  const sty = ui.filterStyle.value;
  const sta = ui.filterStatus.value;
  return items.filter(it => {
    const hay = ((it.caption || '') + ' ' + autoLabel(it.title) + ' ' + (it.title || '')).toLowerCase();
    if (q && !hay.includes(q)) return false;
    if (room === '__none__') { if (it.room) return false; }
    else if (room && it.room !== room) return false;
    if (cat && it.category !== cat) return false;
    if (sty && it.style !== sty) return false;
    if (sta && it.status !== sta) return false;
    return true;
  });
}

function renderItems() {
  const hasItems = items.length > 0;
  ui.filters.style.display = hasItems ? 'flex' : 'none';

  if (!hasItems) {
    ui.items.innerHTML = `
      <div class="empty">
        <div class="editorial">Your library is empty.</div>
        Open a Pinterest board, then click <b>Scan Current Board</b> to start curating.
      </div>`;
    return;
  }

  const list = filteredItems();
  ui.itemCount.textContent = `${list.length} of ${items.length} shown`;

  if (list.length === 0) {
    ui.items.innerHTML = `<div class="empty">No images match these filters.</div>`;
    return;
  }

  ui.items.innerHTML = '';
  const rooms = roomList();
  list.forEach(it => {
    const card = document.createElement('div');
    card.className = 'item';
    const captionVal = esc((it.caption || '').trim() || autoLabel(it.title));
    const srcLink = it.pinUrl
      ? `<a class="src" href="${esc(it.pinUrl)}" target="_blank" rel="noopener">Source &rarr;</a>`
      : `<span class="src" style="color:var(--muted-light)">No source</span>`;
    card.innerHTML = `
      <img class="thumb" src="${esc(it.thumbnailUrl)}" referrerpolicy="no-referrer" loading="lazy" alt="">
      <div class="body">
        <input class="caption" type="text" value="${captionVal}" placeholder="Add a name..." spellcheck="false">
        <div class="tagselects">
          <select data-field="room">${optionsHtml(rooms, it.room, 'Room')}</select>
          <select data-field="category">${optionsHtml(CATEGORIES, it.category, 'Category')}</select>
          <select data-field="style">${optionsHtml(STYLES, it.style, 'Style')}</select>
          <select data-field="status">${optionsHtml(STATUSES, it.status, 'Status')}</select>
        </div>
        <div class="row2">
          ${srcLink}
          <button class="del" title="Remove">&times;</button>
        </div>
      </div>`;

    const cap = card.querySelector('.caption');
    cap.addEventListener('change', async () => {
      it.caption = cap.value.trim();
      await updateItem(it);
    });
    card.querySelectorAll('select').forEach(sel => {
      sel.addEventListener('change', async () => {
        it[sel.dataset.field] = sel.value;
        await updateItem(it);
      });
    });
    card.querySelector('.del').addEventListener('click', async () => {
      await deleteItem(it.id);
      items = items.filter(x => x.id !== it.id);
      renderProjectMeta();
      renderItems();
      ui.exportBtn.disabled = items.length === 0;
    });

    ui.items.appendChild(card);
  });
}

async function runDedupe() {
  const removed = await dedupeProject(currentProject.id);
  await loadItems();
  setStatus(removed ? `Removed ${removed} duplicate${removed === 1 ? '' : 's'}.` : 'No duplicates found.', false);
}

// ---------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------
async function exportLibrary() {
  const list = filteredItems();
  if (!list.length) { setStatus('Nothing to export with the current filters.', true); return; }

  ui.exportBtn.disabled = true;
  const roomFilter = ui.filterRoom.value && ui.filterRoom.value !== '__none__' ? ui.filterRoom.value : '';
  const board = {
    name: currentProject.name + (roomFilter ? ` — ${roomFilter}` : ''),
    url: ''
  };

  try {
    const pack = await buildLibraryPack(list, board, {
      naming: ui.namingMode.value,
      onProgress: (done, total) => setStatus(`Processing image ${done} of ${total}...`, false, true)
    });
    if (!pack) {
      setStatus('Could not download any images. The source URLs may have expired.', true);
      ui.exportBtn.disabled = false;
      return;
    }
    setStatus('Building ZIP...', false, true);
    const url = URL.createObjectURL(pack.blob);
    const zipName = `imprint-${slug(board.name) || 'library'}.zip`;
    chrome.downloads.download({ url, filename: zipName, saveAs: false }, () => {
      setStatus(`Exported ${pack.count} images to Downloads (with source sheet, palette & manifest).`, false);
      ui.exportBtn.disabled = false;
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    });
  } catch (e) {
    setStatus('Export failed: ' + e.message, true);
    ui.exportBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------
ui.projectSelect.addEventListener('change', () => selectProject(ui.projectSelect.value));
ui.newProjectBtn.addEventListener('click', newProject);
ui.deleteProjectBtn.addEventListener('click', removeProject);
ui.scanBtn.addEventListener('click', scanCurrentBoard);
ui.exportBtn.addEventListener('click', exportLibrary);
ui.scanAllBtn.addEventListener('click', () => { scanResults.forEach((_, i) => scanSelected.add(i)); renderScanGrid(); });
ui.scanNoneBtn.addEventListener('click', () => { scanSelected.clear(); renderScanGrid(); });
ui.addToLibraryBtn.addEventListener('click', addSelectedToLibrary);
ui.cancelScanBtn.addEventListener('click', () => { hideScanPanel(); setStatus('', false); });
ui.dedupeBtn.addEventListener('click', runDedupe);
ui.namingMode.addEventListener('change', () => {
  chrome.storage.local.set({ namingMode: ui.namingMode.value });
});
[ui.searchInput, ui.filterRoom, ui.filterCategory, ui.filterStyle, ui.filterStatus].forEach(elm => {
  elm.addEventListener('input', renderItems);
  elm.addEventListener('change', renderItems);
});

init().catch(e => setStatus('Failed to load library: ' + e.message, true));
