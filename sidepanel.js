// =====================================================================
// IMPRINT Connect — sidepanel.js
// Wires the persistent Library (db.js) and the export/scan logic
// (core.js) to the side-panel UI.
// =====================================================================

const CATEGORIES = ['Lighting', 'Furniture', 'Textiles', 'Flooring', 'Wall & Paint', 'Decor', 'Window', 'Kitchen', 'Bath', 'Outdoor', 'Art', 'Other'];
const STYLES = ['Modern', 'Contemporary', 'Mid-Century', 'Japandi', 'Scandinavian', 'Traditional', 'Transitional', 'Industrial', 'Coastal', 'Bohemian', 'Minimalist', 'Farmhouse', 'Art Deco', 'Other'];
const STATUSES = ['Proposed', 'Approved', 'Ordered', 'Rejected'];
const ROOMS = [
  'Entrance Hall', 'Hallway', 'Living Room', 'Family Room', 'Study / Home Office', 'Dining Room',
  'Kitchen', 'Open-Plan Kitchen / Dining / Living Area', 'Bedroom', 'Primary Bedroom / Main Bedroom',
  'Guest Bedroom', 'Bathroom', 'Ensuite Bathroom', 'Guest WC', 'Cloakroom', 'Dressing Room',
  'Laundry Room', 'Utility Room', 'Staircase', 'Landing', 'Conservatory / Sunroom',
  'Attic / Loft Room', 'Basement', 'Storage Room', 'Other Room'
];
const ADD_NEW = '__add__';   // sentinel value for the "Add new…" option

// The IMPRINT wordmark, recreated as crisp markup (used when no custom logo).
const LOCKUP_HTML = '<div class="logo-lockup"><div class="imprint">IMPRINT<span class="tm">&#8482;</span></div><div class="rule"></div><div class="connect">Connect</div></div>';

// --- State ---
let currentProject = null;
let items = [];                 // items for the current project
let scanResults = [];           // pins from the latest scan
const scanSelected = new Set(); // indices selected in the scan panel
let brandLogo = '';             // user's custom logo as a data URL (optional)
let customCategories = [];      // user-added categories (global)
let customStyles = [];          // user-added styles (global)
const selectedIds = new Set();  // library items selected for batch tagging
let bulkMode = false;           // true = bulk-tag mode (select + batch bar)

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
  scanAllBtn: el('scanAllBtn'),
  scanNoneBtn: el('scanNoneBtn'),
  addToLibraryBtn: el('addToLibraryBtn'),
  cancelScanBtn: el('cancelScanBtn'),
  filters: el('filters'),
  searchInput: el('searchInput'),
  filterType: el('filterType'),
  filterRoom: el('filterRoom'),
  filterCategory: el('filterCategory'),
  filterStyle: el('filterStyle'),
  filterStatus: el('filterStatus'),
  itemCount: el('itemCount'),
  dedupeBtn: el('dedupeBtn'),
  filterToggle: el('filterToggle'),
  filterFields: el('filterFields'),
  bulkToggle: el('bulkToggle'),
  namingMode: el('namingMode'),
  items: el('items'),
  batchBar: el('batchBar'),
  batchCount: el('batchCount'),
  batchControls: el('batchControls'),
  batchSelectAll: el('batchSelectAll'),
  batchClear: el('batchClear'),
  batchDone: el('batchDone'),
  batchType: el('batchType'),
  batchRoom: el('batchRoom'),
  batchStyle: el('batchStyle'),
  batchCategory: el('batchCategory'),
  batchStatus: el('batchStatus'),
  batchDelete: el('batchDelete'),
  modal: el('modal'),
  modalTitle: el('modalTitle'),
  modalBody: el('modalBody'),
  modalOk: el('modalOk'),
  modalCancel: el('modalCancel'),
  logo: el('logo'),
  settingsBtn: el('settingsBtn'),
  brandModal: el('brandModal'),
  brandPreview: el('brandPreview'),
  brandFile: el('brandFile'),
  brandRemove: el('brandRemove'),
  brandClose: el('brandClose')
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

// ---------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------
async function init() {
  const stored = await chrome.storage.local.get(['namingMode', 'brandLogo', 'customCategories', 'customStyles']);
  if (stored && stored.namingMode) ui.namingMode.value = stored.namingMode;
  brandLogo = (stored && stored.brandLogo) || '';
  customCategories = (stored && stored.customCategories) || [];
  customStyles = (stored && stored.customStyles) || [];
  applyBrand();

  let projects = await listProjects();
  if (projects.length === 0) {
    const p = await createProject('My First Project', '');
    projects = [p];
  }
  renderProjectSelect(projects);
  await selectProject(projects[0].id);
}

// ---------------------------------------------------------------------
// Branding (logo lockup + optional user logo for client PDFs)
// ---------------------------------------------------------------------
function applyBrand() {
  ui.logo.innerHTML = brandLogo
    ? `<img class="brand-img" src="${brandLogo}" alt="Brand logo">`
    : LOCKUP_HTML;
  renderBrandPreview();
}

function renderBrandPreview() {
  ui.brandPreview.innerHTML = brandLogo
    ? `<img src="${brandLogo}" alt="">`
    : '<span class="none">Using the IMPRINT mark</span>';
}

function openBrand() {
  renderBrandPreview();
  ui.brandModal.style.display = 'flex';
}

async function onBrandFile() {
  const file = ui.brandFile.files && ui.brandFile.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    setStatus('Logo is too large (max 2 MB). Try a smaller PNG.', true);
    return;
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  brandLogo = dataUrl;
  await chrome.storage.local.set({ brandLogo });
  applyBrand();
  ui.brandFile.value = '';
}

async function removeBrand() {
  brandLogo = '';
  await chrome.storage.local.remove('brandLogo');
  applyBrand();
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
  selectedIds.clear();
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
  const { added, skipped } = await addItems(currentProject.id, chosen, '');
  currentProject = await getProject(currentProject.id);
  hideScanPanel();
  await loadItems();
  const skipMsg = skipped ? ` (${skipped} already in library)` : '';
  setStatus(`Added ${added} image${added === 1 ? '' : 's'}${skipMsg}. Tag them below or export.`, false);
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

// Full room choices for assigning: the standard list + any custom rooms
// this project has accumulated.
function roomOptionList() {
  const list = ROOMS.slice();
  const lower = list.map(r => r.toLowerCase());
  const extra = new Set();
  (currentProject.rooms || []).forEach(r => { if (r && !lower.includes(r.toLowerCase())) extra.add(r); });
  items.forEach(it => { if (it.room && !lower.includes(it.room.toLowerCase())) extra.add(it.room); });
  return list.concat(Array.from(extra).sort((a, b) => a.localeCompare(b)));
}

// Build the <option> list for an item's tag dropdown, including a blank
// placeholder and (except for status) an "Add new…" option at the end.
function fieldOptions(field, selected) {
  let values;
  if (field === 'room') values = roomOptionList();
  else if (field === 'category') values = CATEGORIES.concat(customCategories);
  else if (field === 'style') values = STYLES.concat(customStyles);
  else values = STATUSES;
  if (selected && !values.includes(selected)) values = values.concat(selected);

  const blankLabel = field === 'room' ? 'No room specified' : field.charAt(0).toUpperCase() + field.slice(1);
  let html = `<option value="">${esc(blankLabel)}</option>`;
  html += values.map(v => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v)}</option>`).join('');
  if (field !== 'status') html += `<option value="${ADD_NEW}">+ Add ${field}…</option>`;
  return html;
}

// Persist a newly typed value: rooms per-project, categories/styles globally.
async function addCustomValue(field, val) {
  if (field === 'room') {
    await addRoom(currentProject.id, val);
    currentProject = await getProject(currentProject.id);
  } else if (field === 'category') {
    if (!CATEGORIES.includes(val) && !customCategories.includes(val)) {
      customCategories.push(val);
      await chrome.storage.local.set({ customCategories });
    }
  } else if (field === 'style') {
    if (!STYLES.includes(val) && !customStyles.includes(val)) {
      customStyles.push(val);
      await chrome.storage.local.set({ customStyles });
    }
  }
}

function populateFilters() {
  const rooms = roomList();
  const keep = {
    room: ui.filterRoom.value, category: ui.filterCategory.value,
    style: ui.filterStyle.value, status: ui.filterStatus.value
  };
  ui.filterRoom.innerHTML = `<option value="">All rooms</option><option value="__none__">Unassigned</option>`
    + rooms.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
  ui.filterCategory.innerHTML = `<option value="">All categories</option>` + CATEGORIES.concat(customCategories).map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  ui.filterStyle.innerHTML = `<option value="">All styles</option>` + STYLES.concat(customStyles).map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  ui.filterStatus.innerHTML = `<option value="">Any status</option>` + STATUSES.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  ui.filterRoom.value = keep.room || '';
  ui.filterCategory.value = keep.category || '';
  ui.filterStyle.value = keep.style || '';
  ui.filterStatus.value = keep.status || '';

  // Batch-apply dropdowns (placeholder + values).
  ui.batchRoom.innerHTML = `<option value="">Set room…</option>` + roomOptionList().map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
  ui.batchStyle.innerHTML = `<option value="">Set style…</option>` + STYLES.concat(customStyles).map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  ui.batchCategory.innerHTML = `<option value="">Set category…</option>` + CATEGORIES.concat(customCategories).map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  ui.batchStatus.innerHTML = `<option value="">Set status…</option>` + STATUSES.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
}

function filteredItems() {
  const q = ui.searchInput.value.trim().toLowerCase();
  const type = ui.filterType.value;
  const room = ui.filterRoom.value;
  const cat = ui.filterCategory.value;
  const sty = ui.filterStyle.value;
  const sta = ui.filterStatus.value;
  return items.filter(it => {
    const kind = it.kind === 'product' ? 'product' : 'inspiration';
    if (type && kind !== type) return false;
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

// The relevant tag dropdowns for an item, based on its type. Status applies
// to both types, so it's always shown regardless of Inspiration/Product:
//   Inspiration -> Room + Style + Status ;  Product (FF&E) -> Category + Status + Room
function tagSelectsHtml(it) {
  if (it.kind === 'product') {
    return `
      <select data-field="category">${fieldOptions('category', it.category)}</select>
      <select data-field="status">${fieldOptions('status', it.status)}</select>
      <select data-field="room">${fieldOptions('room', it.room)}</select>`;
  }
  return `
    <select data-field="room">${fieldOptions('room', it.room)}</select>
    <select data-field="style">${fieldOptions('style', it.style)}</select>
    <select data-field="status">${fieldOptions('status', it.status)}</select>`;
}

function renderBatchBar() {
  const existing = new Set(items.map(i => i.id));
  for (const id of Array.from(selectedIds)) if (!existing.has(id)) selectedIds.delete(id);
  if (!bulkMode) { ui.batchBar.style.display = 'none'; return; }
  ui.batchBar.style.display = 'block';
  const n = selectedIds.size;
  ui.batchCount.textContent = n ? `${n} selected` : 'Tap images to select';
  ui.batchControls.style.display = n ? 'flex' : 'none';
}

function renderItems() {
  const hasItems = items.length > 0;
  ui.filters.style.display = hasItems ? 'flex' : 'none';
  ui.bulkToggle.style.display = hasItems ? '' : 'none';

  if (!hasItems) {
    bulkMode = false;
    ui.bulkToggle.textContent = 'Bulk tag';
    selectedIds.clear();
    renderBatchBar();
    ui.items.innerHTML = `
      <div class="empty">
        <div class="editorial">Your library is empty.</div>
        Open a Pinterest board, then click <b>Scan Current Board</b> to start curating.
      </div>`;
    return;
  }

  const list = filteredItems();
  ui.itemCount.textContent = `${list.length} of ${items.length} shown`;
  renderBatchBar();

  if (list.length === 0) {
    ui.items.innerHTML = `<div class="empty">No images match these filters.</div>`;
    return;
  }

  ui.items.innerHTML = '';
  list.forEach(it => ui.items.appendChild(bulkMode ? bulkCard(it) : fullCard(it)));
}

function displayName(it) {
  return (it.caption || '').trim() || autoLabel(it.title);
}

function tagsText(it) {
  const kind = it.kind === 'product' ? 'Product' : 'Inspiration';
  const bits = it.kind === 'product' ? [it.category, it.status, it.room] : [it.room, it.style];
  return [kind].concat(bits.filter(Boolean)).join('  ·  ');
}

// Compact, fully-clickable card used in Bulk mode.
function bulkCard(it) {
  const card = document.createElement('div');
  card.className = 'item bulk' + (selectedIds.has(it.id) ? ' sel' : '');
  card.innerHTML = `
    <div class="thumb-wrap">
      <img class="thumb" src="${esc(it.thumbnailUrl)}" referrerpolicy="no-referrer" loading="lazy" alt="">
      <div class="pick"></div>
    </div>
    <div class="body">
      <div class="bulk-name">${esc(displayName(it))}</div>
      <div class="bulk-tags">${esc(tagsText(it))}</div>
    </div>`;
  card.addEventListener('click', () => {
    if (selectedIds.has(it.id)) selectedIds.delete(it.id); else selectedIds.add(it.id);
    card.classList.toggle('sel');
    renderBatchBar();
  });
  return card;
}

// Full editing card used in Individual mode (no checkbox; edit in place).
function fullCard(it) {
  const kind = it.kind === 'product' ? 'product' : 'inspiration';
  const card = document.createElement('div');
  card.className = 'item';
  const captionVal = esc((it.caption || '').trim() || autoLabel(it.title));
  const srcLink = it.pinUrl
    ? `<a class="src" href="${esc(it.pinUrl)}" target="_blank" rel="noopener">Source &rarr;</a>`
    : `<span class="src" style="color:var(--muted-light)">No source</span>`;
  card.innerHTML = `
    <img class="thumb" src="${esc(it.thumbnailUrl)}" referrerpolicy="no-referrer" loading="lazy" alt="">
    <div class="body">
      <div class="caption-label">Name</div>
      <input class="caption" type="text" value="${captionVal}" placeholder="Type a name..." spellcheck="false">
      <div class="seg item-type">
        <button type="button" data-kind="inspiration"${kind === 'inspiration' ? ' class="active"' : ''}>Inspiration</button>
        <button type="button" data-kind="product"${kind === 'product' ? ' class="active"' : ''}>Product</button>
      </div>
      <div class="tagselects">${tagSelectsHtml(it)}</div>
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

  card.querySelectorAll('.item-type button').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newKind = btn.dataset.kind;
      if (newKind === kind) return;
      it.kind = newKind;
      await updateItem(it);
      renderItems();
    });
  });

  card.querySelectorAll('.tagselects select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const field = sel.dataset.field;
      if (sel.value === ADD_NEW) {
        const labels = { room: 'Add Room', category: 'Add Category', style: 'Add Style' };
        const name = await showPrompt(labels[field] || 'Add', 'Type a name', 'Add');
        if (!name || !name.trim()) { sel.value = it[field] || ''; return; }
        const val = name.trim();
        await addCustomValue(field, val);
        it[field] = val;
        await updateItem(it);
        populateFilters();
        renderItems();
        return;
      }
      it[field] = sel.value;
      await updateItem(it);
    });
  });

  card.querySelector('.del').addEventListener('click', async () => {
    await deleteItem(it.id);
    items = items.filter(x => x.id !== it.id);
    selectedIds.delete(it.id);
    renderProjectMeta();
    renderItems();
    ui.exportBtn.disabled = items.length === 0;
  });

  return card;
}

// ---- Batch tagging ----
async function applyToSelected(field, value) {
  if (!selectedIds.size) return;
  for (const it of items) {
    if (selectedIds.has(it.id)) { it[field] = value; await updateItem(it); }
  }
  renderItems();
}

async function applyKindToSelected(kind) {
  if (!selectedIds.size) return;
  for (const it of items) {
    if (selectedIds.has(it.id)) { it.kind = kind; await updateItem(it); }
  }
  renderItems();
}

async function deleteSelected() {
  if (!selectedIds.size) return;
  const ok = await showConfirm('Delete Images', `Remove ${selectedIds.size} selected image(s) from this project?`, 'Delete');
  if (!ok) return;
  for (const id of Array.from(selectedIds)) await deleteItem(id);
  items = items.filter(x => !selectedIds.has(x.id));
  selectedIds.clear();
  renderProjectMeta();
  renderItems();
  ui.exportBtn.disabled = items.length === 0;
}

function setBulkMode(on) {
  bulkMode = on;
  selectedIds.clear();
  ui.bulkToggle.textContent = on ? 'Done' : 'Bulk tag';
  renderItems();
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
    url: '',
    logo: brandLogo || ''
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
ui.filterToggle.addEventListener('click', () => {
  const open = ui.filterFields.style.display !== 'none';
  ui.filterFields.style.display = open ? 'none' : 'flex';
  ui.filterToggle.textContent = open ? 'Filters' : 'Hide filters';
});
ui.namingMode.addEventListener('change', () => {
  chrome.storage.local.set({ namingMode: ui.namingMode.value });
});
ui.settingsBtn.addEventListener('click', openBrand);
ui.brandFile.addEventListener('change', onBrandFile);
ui.brandRemove.addEventListener('click', removeBrand);
ui.brandClose.addEventListener('click', () => { ui.brandModal.style.display = 'none'; });
ui.brandModal.addEventListener('click', (e) => { if (e.target === ui.brandModal) ui.brandModal.style.display = 'none'; });
ui.batchClear.addEventListener('click', () => { selectedIds.clear(); renderItems(); });
ui.bulkToggle.addEventListener('click', () => setBulkMode(!bulkMode));
ui.batchDone.addEventListener('click', () => setBulkMode(false));
ui.batchSelectAll.addEventListener('click', () => { filteredItems().forEach(it => selectedIds.add(it.id)); renderItems(); });
ui.batchType.querySelectorAll('button').forEach(b => {
  b.addEventListener('click', () => applyKindToSelected(b.dataset.kind));
});
ui.batchRoom.addEventListener('change', () => { const v = ui.batchRoom.value; if (v) { applyToSelected('room', v); ui.batchRoom.value = ''; } });
ui.batchStyle.addEventListener('change', () => { const v = ui.batchStyle.value; if (v) { applyToSelected('style', v); ui.batchStyle.value = ''; } });
ui.batchCategory.addEventListener('change', () => { const v = ui.batchCategory.value; if (v) { applyToSelected('category', v); ui.batchCategory.value = ''; } });
ui.batchStatus.addEventListener('change', () => { const v = ui.batchStatus.value; if (v) { applyToSelected('status', v); ui.batchStatus.value = ''; } });
ui.batchDelete.addEventListener('click', deleteSelected);
[ui.searchInput, ui.filterType, ui.filterRoom, ui.filterCategory, ui.filterStyle, ui.filterStatus].forEach(elm => {
  elm.addEventListener('input', renderItems);
  elm.addEventListener('change', renderItems);
});

init().catch(e => setStatus('Failed to load library: ' + e.message, true));
