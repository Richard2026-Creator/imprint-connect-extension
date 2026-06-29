// =====================================================================
// IMPRINT Connect — db.js
// A small Promise-based IndexedDB wrapper that persists the user's
// Library locally (Projects -> Rooms -> saved Items). Nothing leaves
// the browser.
//
// Stores:
//   projects: { id, name, client, createdAt, rooms: [string] }
//   items:    { id, projectId, room, imageUrl, thumbnailUrl, pinUrl,
//               title, category, style, status, addedAt }  (index: projectId)
// =====================================================================

const DB_NAME = 'imprint-connect';
const DB_VERSION = 1;
let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('items')) {
        const items = db.createObjectStore('items', { keyPath: 'id' });
        items.createIndex('projectId', 'projectId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(storeNames, mode) {
  return openDB().then(db => {
    const t = db.transaction(storeNames, mode);
    return t;
  });
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

// ----- Projects -----

async function listProjects() {
  const t = await tx('projects', 'readonly');
  const all = await reqToPromise(t.objectStore('projects').getAll());
  return all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

async function getProject(id) {
  const t = await tx('projects', 'readonly');
  return reqToPromise(t.objectStore('projects').get(id));
}

async function createProject(name, client) {
  const project = {
    id: uid('proj'),
    name: (name || 'Untitled Project').trim(),
    client: (client || '').trim(),
    createdAt: Date.now(),
    rooms: []
  };
  const t = await tx('projects', 'readwrite');
  await reqToPromise(t.objectStore('projects').put(project));
  return project;
}

async function updateProject(project) {
  const t = await tx('projects', 'readwrite');
  await reqToPromise(t.objectStore('projects').put(project));
  return project;
}

async function deleteProject(id) {
  // Remove the project and all of its items.
  const items = await listItems(id);
  const t = await tx(['projects', 'items'], 'readwrite');
  t.objectStore('projects').delete(id);
  const itemStore = t.objectStore('items');
  items.forEach(it => itemStore.delete(it.id));
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve(true);
    t.onerror = () => reject(t.error);
  });
}

async function addRoom(projectId, roomName) {
  const name = (roomName || '').trim();
  if (!name) return null;
  const project = await getProject(projectId);
  if (!project) return null;
  if (!project.rooms.some(r => r.toLowerCase() === name.toLowerCase())) {
    project.rooms.push(name);
    await updateProject(project);
  }
  return project;
}

// ----- Items -----

async function listItems(projectId) {
  const t = await tx('items', 'readonly');
  const idx = t.objectStore('items').index('projectId');
  const all = await reqToPromise(idx.getAll(projectId));
  return all.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
}

// Add scanned pins to a project. Skips images already present (by imageUrl).
// Returns { added, skipped }.
async function addItems(projectId, pins, room) {
  const existing = await listItems(projectId);
  const seen = new Set(existing.map(it => it.imageUrl));
  let added = 0, skipped = 0;
  const t = await tx('items', 'readwrite');
  const store = t.objectStore('items');
  const now = Date.now();
  pins.forEach((p, i) => {
    if (seen.has(p.imageUrl)) { skipped++; return; }
    seen.add(p.imageUrl);
    added++;
    store.put({
      id: uid('item'),
      projectId,
      room: (room || '').trim(),
      imageUrl: p.imageUrl,
      thumbnailUrl: p.thumbnailUrl || p.imageUrl,
      pinUrl: p.pinUrl || '',
      title: p.title || '',
      caption: '',
      category: '',
      style: '',
      status: '',
      addedAt: now + i
    });
  });
  await new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  return { added, skipped };
}

async function updateItem(item) {
  const t = await tx('items', 'readwrite');
  await reqToPromise(t.objectStore('items').put(item));
  return item;
}

async function deleteItem(id) {
  const t = await tx('items', 'readwrite');
  await reqToPromise(t.objectStore('items').delete(id));
  return true;
}

// Remove duplicate items within a project (same imageUrl), keeping the
// earliest-added one. Returns the number removed.
async function dedupeProject(projectId) {
  const items = await listItems(projectId);
  const seen = new Set();
  const dupes = [];
  for (const it of items) {
    if (seen.has(it.imageUrl)) dupes.push(it.id);
    else seen.add(it.imageUrl);
  }
  if (dupes.length) {
    const t = await tx('items', 'readwrite');
    const store = t.objectStore('items');
    dupes.forEach(id => store.delete(id));
    await new Promise((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }
  return dupes.length;
}
