import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, getDocs, writeBatch, serverTimestamp, runTransaction } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// Muted-but-specific folder tones, derived from the Vesatile palette
const FOLDER_COLORS = ['#3B5244','#8B3A3A','#A8842C','#4A6274','#6E5A7E','#31606B','#9C6B4E','#7A8581'];

/* ── BYOK: the AI runs on the user's own Anthropic key ──
   The key lives only in this device's localStorage and in request headers to
   api.anthropic.com — never in Firestore, never on Afterword's servers. */
const API_KEY_STORAGE = 'afterword_api_key_v1';
const AI_MODEL_STORAGE = 'afterword_ai_model';
const AI_MODELS = ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'];
const DEFAULT_AI_MODEL = AI_MODELS[0];
const ANTHROPIC_VERSION = '2023-06-01';

function getApiKey() {
  try { return localStorage.getItem(API_KEY_STORAGE) || ''; } catch(e) { return ''; }
}

function getAiModel() {
  try {
    const m = localStorage.getItem(AI_MODEL_STORAGE);
    return AI_MODELS.includes(m) ? m : DEFAULT_AI_MODEL;
  } catch(e) { return DEFAULT_AI_MODEL; }
}

function anthropicHeaders(key) {
  return {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': ANTHROPIC_VERSION,
    // Anthropic's official opt-in for browser-direct calls. Safe here because
    // the key is the user's own, entered by them, stored only on their device.
    'anthropic-dangerous-direct-browser-access': 'true'
  };
}

// Single entry point for all Claude calls. Throws Error with a code message:
// 'no-key' | 'auth' | 'rate' | 'network' | 'upstream'.
async function callClaude({ system, messages, maxTokens = 2000 }) {
  const key = getApiKey();
  if (!key) throw new Error('no-key');
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: anthropicHeaders(key),
      body: JSON.stringify({ model: getAiModel(), max_tokens: maxTokens, system, messages })
    });
  } catch(e) { throw new Error('network'); }
  if (res.status === 401 || res.status === 403) throw new Error('auth');
  if (res.status === 429) throw new Error('rate');
  if (!res.ok) throw new Error('upstream');
  const data = await res.json();
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}

const firebaseConfig = {
  apiKey: "AIzaSyD0y_PBPCN-yjyYXZv-y4NDSSUJRZlMIB0",
  authDomain: "afterword-53cd7.firebaseapp.com",
  projectId: "afterword-53cd7",
  storageBucket: "afterword-53cd7.firebasestorage.app",
  messagingSenderId: "827868119462",
  appId: "1:827868119462:web:81fe16adc3d5aabd11cf67"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const googleProvider = new GoogleAuthProvider();
let currentUser = null;

// Conflict detection (Masterplan Phase 2.2): the server `updatedAt` each note
// had when this client last loaded/saved it. On save we compare against the
// live server value inside a transaction; a mismatch means another device wrote
// in between, so we warn instead of silently clobbering. `conflictNote` holds
// the user's pending version while the conflict modal is open.
let noteVersions = {};
let conflictNote = null;

// Firestore Timestamps: prefer isEqual, fall back to millis; treat missing as unequal.
function tsEqual(a, b) {
  if (!a || !b) return a === b;
  if (typeof a.isEqual === 'function') { try { return a.isEqual(b); } catch(e) {} }
  const am = a.toMillis ? a.toMillis() : a;
  const bm = b.toMillis ? b.toMillis() : b;
  return am === bm;
}

const DEFAULT_DATA = {
  folders: [
    { id: 'f1', name: 'Q2 Planning', color: '#3B5244' },
    { id: 'f2', name: 'Product Redesign', color: '#8B3A3A' },
    { id: 'f3', name: 'Client Onboarding', color: '#A8842C' }
  ],
  notes: [
    {
      id: 'n1', folderId: 'f1', title: 'Q2 Planning Kickoff',
      date: '2026-03-25', attendees: 'Amir, Sara, Dev',
      body: 'Reviewed Q1 results — revenue hit 94% of target. Main gap was enterprise deals slipping to Q2.\n\nAgreed to push launch of feature X to mid-April to align with sales pipeline. Sara flagged dependency on design sign-off.\n\nDiscussed budget reallocation: moving 15% from ads to content.',
      actions: [
        { id: 'a1', text: 'Share updated roadmap with team', assignee: 'Amir', done: true },
        { id: 'a2', text: 'Get design sign-off on feature X', assignee: 'Sara', done: false },
        { id: 'a3', text: 'Model budget reallocation impact', assignee: 'Dev', done: false }
      ]
    },
    {
      id: 'n2', folderId: 'f2', title: 'Design Review — Homepage',
      date: '2026-03-22', attendees: 'Sara, Jess',
      body: 'Reviewed three homepage concepts. Went with option B — cleaner hero and stronger CTA hierarchy.\n\nFeedback: reduce font sizes on mobile, test with colour-blind users.',
      actions: [
        { id: 'a4', text: 'Update hero copy', assignee: 'Jess', done: false },
        { id: 'a5', text: 'Accessibility audit', assignee: 'Sara', done: false }
      ]
    },
    {
      id: 'n3', folderId: 'f3', title: 'Acme Corp — Kickoff',
      date: '2026-03-20', attendees: 'Tom, Client (Acme)',
      body: 'Introductions done. Client confirmed timeline: go-live by end of April.\n\nKey concern: data migration from legacy system. Need to scope separately.',
      actions: [
        { id: 'a6', text: 'Send welcome pack', assignee: 'Tom', done: true },
        { id: 'a7', text: 'Scope data migration', assignee: 'Tom', done: false }
      ]
    }
  ]
};

// Per-note data model (Masterplan Phase 2.1). Folders live in a single
// `meta/main` doc; each note is its own `notes/{noteId}` doc with an
// `updatedAt` server timestamp. The legacy `users/{uid}` blob doc is retained
// as a one-release backup after migration (marked with `migratedAt`), never
// written to again. New Firestore paths need matching security rules deployed
// before this ships — see afterword-security §1.
const SCHEMA_VERSION = 2;

function userDocRef(uid) { return doc(db, 'users', uid); }            // legacy blob (backup only)
function metaRef(uid) { return doc(db, 'users', uid, 'meta', 'main'); }
function notesColRef(uid) { return collection(db, 'users', uid, 'notes'); }
function noteRef(uid, id) { return doc(db, 'users', uid, 'notes', id); }

// Write the whole dataset into the per-note store (used for migration, seeding,
// and import). Notes go in chunked batches because writeBatch caps at 500 ops.
async function writeAllPerNote(uid, data) {
  await setDoc(metaRef(uid), { folders: data.folders, schemaVersion: SCHEMA_VERSION });
  for (let i = 0; i < data.notes.length; i += 400) {
    const batch = writeBatch(db);
    data.notes.slice(i, i + 400).forEach(n => {
      batch.set(noteRef(uid, n.id), { ...n, updatedAt: serverTimestamp(), schemaVersion: SCHEMA_VERSION });
    });
    await batch.commit();
  }
}

async function loadUserData(uid) {
  try {
    const [metaSnap, notesSnap] = await Promise.all([getDoc(metaRef(uid)), getDocs(notesColRef(uid))]);

    // Per-note store already exists (native or previously migrated) — source of truth.
    if (metaSnap.exists() || notesSnap.size > 0) {
      const clean = sanitizeData({
        folders: metaSnap.exists() ? metaSnap.data().folders : [],
        notes: notesSnap.docs.map(d => ({ ...d.data(), id: d.id }))
      });
      state.folders = clean.folders;
      state.notes = clean.notes;
      noteVersions = {};
      notesSnap.docs.forEach(d => { noteVersions[d.id] = d.data().updatedAt || null; });
      return;
    }

    // No per-note store yet — migrate a legacy blob if present, else seed defaults.
    const legacySnap = await getDoc(userDocRef(uid));
    if (legacySnap.exists() && (legacySnap.data().notes || legacySnap.data().folders)) {
      const clean = sanitizeData(legacySnap.data());
      await writeAllPerNote(uid, clean);
      // Keep the blob one release as a backup; mark it so we never re-migrate.
      await setDoc(userDocRef(uid), { migratedAt: serverTimestamp() }, { merge: true });
      state.folders = clean.folders;
      state.notes = clean.notes;
      return;
    }

    // Brand-new user — seed defaults into the per-note store.
    const seeded = sanitizeData(DEFAULT_DATA);
    await writeAllPerNote(uid, seeded);
    state.folders = seeded.folders;
    state.notes = seeded.notes;
  } catch(e) {
    console.warn('Failed to load notes from Firestore', e);
    showToast('⚠ Could not load your notes — check your connection');
  }
}

// Tracks the most recent in-flight write so sign-out can await it (see
// signOutUser) — a note must never be abandoned mid-save on account switch.
let pendingSave = null;
function trackSave(promise) {
  pendingSave = promise;
  promise.finally(() => { if (pendingSave === promise) pendingSave = null; });
  return promise;
}

// Returns { ok } on success, { ok:false, conflict:true } if the note changed on
// another device since we loaded it, or { ok:false } on a plain write failure.
async function saveNoteDoc(note) {
  if (!currentUser) return { ok: false };
  const ref = noteRef(currentUser.uid, note.id);
  const expected = noteVersions[note.id];
  return trackSave((async () => {
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        // Only a note we've seen before can conflict; new notes (no expected
        // version) and first-write races just proceed.
        if (snap.exists() && expected && !tsEqual(snap.data().updatedAt, expected)) {
          const err = new Error('conflict'); err.code = 'conflict'; throw err;
        }
        tx.set(ref, { ...note, updatedAt: serverTimestamp(), schemaVersion: SCHEMA_VERSION });
      });
      await refreshNoteVersion(ref, note.id);
      return { ok: true };
    } catch(e) {
      if (e && e.code === 'conflict') return { ok: false, conflict: true };
      console.warn('Failed to save note to Firestore', e);
      return { ok: false };
    }
  })());
}

// Unconditional write — used when the user chooses to overwrite a conflicting note.
async function forceSaveNoteDoc(note) {
  if (!currentUser) return false;
  const ref = noteRef(currentUser.uid, note.id);
  return trackSave((async () => {
    try {
      await setDoc(ref, { ...note, updatedAt: serverTimestamp(), schemaVersion: SCHEMA_VERSION });
      await refreshNoteVersion(ref, note.id);
      return true;
    } catch(e) {
      console.warn('Failed to force-save note to Firestore', e);
      return false;
    }
  })());
}

// After a write, re-read the resolved server timestamp so the next save in this
// session compares against the value we actually wrote (not a stale one).
async function refreshNoteVersion(ref, id) {
  try {
    const fresh = await getDoc(ref);
    noteVersions[id] = fresh.exists() ? (fresh.data().updatedAt || null) : null;
  } catch(e) { noteVersions[id] = null; }
}

async function deleteNoteDoc(id) {
  if (!currentUser) return false;
  return trackSave((async () => {
    try {
      await deleteDoc(noteRef(currentUser.uid, id));
      return true;
    } catch(e) {
      console.warn('Failed to delete note from Firestore', e);
      return false;
    }
  })());
}

async function saveMeta() {
  if (!currentUser) return false;
  return trackSave((async () => {
    try {
      await setDoc(metaRef(currentUser.uid), { folders: state.folders, schemaVersion: SCHEMA_VERSION });
      return true;
    } catch(e) {
      console.warn('Failed to save folders to Firestore', e);
      return false;
    }
  })());
}

async function signInWithGoogle() {
  const errorEl = document.getElementById('signinError');
  if (errorEl) errorEl.textContent = '';
  try {
    await signInWithPopup(auth, googleProvider);
  } catch(e) {
    console.warn('Sign-in failed', e);
    if (errorEl) errorEl.textContent = 'Sign-in failed. Please try again.';
  }
}

async function signOutUser() {
  const signOutBtn = document.getElementById('signOutBtn');
  if (signOutBtn) {
    signOutBtn.disabled = true;
    signOutBtn.title = 'Signing out…';
  }
  // The user's Anthropic key must not survive into another person's session
  // on a shared machine — clear it before anything else can go wrong.
  try {
    localStorage.removeItem(API_KEY_STORAGE);
    localStorage.removeItem(AI_MODEL_STORAGE);
  } catch(e) {}
  // Flush any unsaved edit, then wait for it (and any in-flight save) to land.
  commitPendingEdits();
  if (pendingSave) await pendingSave;
  await signOut(auth);
  // Force a full reload so no in-memory state from this account can ever
  // survive into the next signed-in session, regardless of what state
  // exists in module-level variables.
  location.reload();
}

let state = {
  folders: [],
  notes: [],
  activeFolder: null,
  activeNote: null,
  isNew: false,
  searchQuery: '',
  aiOpen: false
};

let editActions = [];
let actionCounter = 100;

// Autosave + dirty tracking (Masterplan Phase 2.3). `editSeq` increments on
// every user edit to the open note; `savedSeq` is the value last persisted.
// The note is dirty when they differ — that drives the beforeunload guard and
// prevents a slow save from clearing edits the user made while it was in flight.
let editSeq = 0;
let savedSeq = 0;
let autosaveTimer = null;
const AUTOSAVE_DELAY = 2000;

function scheduleAutosave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => { autosaveTimer = null; persistCurrentNote(false); }, AUTOSAVE_DELAY);
}

function cancelAutosave() {
  if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null; }
}

// Called from every editor input; marks the open note dirty and (re)arms autosave.
function markDirty() {
  if (!state.activeNote) return;
  editSeq++;
  setStatus('Unsaved…', 'muted');
  scheduleAutosave();
}

// Flush a pending dirty edit before navigating away from the open note, so
// switching notes/folders never drops unsaved work. Reads the current form
// synchronously (before repopulation) then lets the write finish in the
// background; the completion is ignored if the editor has moved on.
function commitPendingEdits() {
  if (editSeq !== savedSeq && state.activeNote) {
    cancelAutosave();
    persistCurrentNote(false);
  }
}

function render() {
  renderFolders();
  renderNoteList();
  renderTopbar();
}

function renderFolders() {
  const el = document.getElementById('folderList');
  const allCount = state.notes.length;
  let html = `<div class="folder-item ${!state.activeFolder ? 'active' : ''}" onclick="selectFolder(null)">
    <div class="folder-dot" style="background:var(--muted)"></div>
    <span class="folder-name">All notes</span>
    <span class="folder-count">${allCount}</span>
  </div>`;
  state.folders.forEach(f => {
    const count = state.notes.filter(n => n.folderId === f.id).length;
    html += `<div class="folder-item ${state.activeFolder === f.id ? 'active' : ''}" onclick="selectFolder('${f.id}')">
      <div class="folder-dot" style="background:${esc(f.color)}"></div>
      <span class="folder-name">${esc(f.name)}</span>
      <span class="folder-count">${count}</span>
    </div>`;
  });
  el.innerHTML = html;
}

function renderTopbar() {
  const f = state.folders.find(x => x.id === state.activeFolder);
  document.getElementById('topbarTitle').textContent = f ? f.name : 'All notes';
  const badge = document.getElementById('topbarBadge');
  const filtered = getFilteredNotes();
  badge.textContent = filtered.length + (filtered.length === 1 ? ' note' : ' notes');
}

function getFilteredNotes() {
  let notes = state.notes;
  if (state.activeFolder) notes = notes.filter(n => n.folderId === state.activeFolder);
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    notes = notes.filter(n =>
      n.title.toLowerCase().includes(q) ||
      n.body.toLowerCase().includes(q) ||
      n.attendees.toLowerCase().includes(q) ||
      n.actions.some(a => a.text.toLowerCase().includes(q))
    );
  }
  return notes.slice().sort((a,b) => b.date.localeCompare(a.date));
}

function renderNoteList() {
  const notes = getFilteredNotes();
  const el = document.getElementById('noteCards');
  if (!notes.length) {
    el.innerHTML = `<div class="empty-list"><div class="empty-glyph">◆</div><p>${state.searchQuery ? 'No notes match your search' : 'No notes here yet'}</p></div>`;
    return;
  }
  el.innerHTML = notes.map(n => {
    const f = state.folders.find(x => x.id === n.folderId);
    const open = n.actions.filter(a => !a.done).length;
    return `<div class="note-card ${state.activeNote === n.id ? 'active' : ''}" onclick="selectNote('${n.id}')">
      <div class="note-card-title">${esc(n.title)}</div>
      <div class="note-card-meta">${formatDate(n.date)}${f ? ' · <span class="meta-proj"><i style="background:'+esc(f.color)+'"></i>'+esc(f.name)+'</span>' : ''}${open ? ' · <span class="meta-open">'+open+' open</span>' : ''}</div>
      <div class="note-card-preview">${esc(n.body)}</div>
    </div>`;
  }).join('');
}

function selectFolder(id) {
  commitPendingEdits();
  state.activeFolder = id;
  state.activeNote = null;
  state.isNew = false;
  closeSidebar();
  showEmpty();
  render();
}

function selectNote(id) {
  commitPendingEdits();
  state.activeNote = id;
  state.isNew = false;
  const note = state.notes.find(n => n.id === id);
  editActions = note.actions.map(a => ({...a}));
  populateForm(note);
  showForm();
  mobileShowDetail();
  render();
}

function newNote() {
  commitPendingEdits();
  state.activeNote = 'new';
  state.isNew = true;
  editActions = [];
  const today = new Date().toISOString().slice(0,10);
  populateForm({ title:'', date: today, attendees:'', folderId: state.activeFolder || '', body:'', actions:[] });
  showForm(true);
  mobileShowDetail();
  document.getElementById('deleteBtn').style.display = 'none';
  render();
}

function populateForm(note) {
  document.getElementById('noteTitle').value = note.title;
  document.getElementById('noteDate').value = note.date;
  document.getElementById('noteAttendees').value = note.attendees;
  document.getElementById('noteBody').value = note.body;
  populateFolderSelect('noteFolder', note.folderId);
  renderActions();
  checkAssignPrompt(note.folderId);
  document.getElementById('saveHint').textContent = '';
  document.getElementById('deleteBtn').style.display = state.isNew ? 'none' : 'inline-block';
  // Opening a note is a clean slate — reset dirty tracking and clear status.
  editSeq = 0;
  savedSeq = 0;
  cancelAutosave();
  setStatus('');
}

function populateFolderSelect(id, selected) {
  const el = document.getElementById(id);
  el.innerHTML = `<option value="">— none —</option>` +
    state.folders.map(f => `<option value="${f.id}" ${f.id === selected ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
}

function checkAssignPrompt(folderId) {
  const prompt = document.getElementById('assignPrompt');
  if (!folderId) {
    prompt.style.display = 'flex';
    populateFolderSelect('assignSelect', '');
  } else {
    prompt.style.display = 'none';
  }
}

function onFolderSelectChange() {
  const val = document.getElementById('noteFolder').value;
  checkAssignPrompt(val);
  markDirty();
}

function assignFolder() {
  const val = document.getElementById('assignSelect').value;
  if (val) {
    document.getElementById('noteFolder').value = val;
    document.getElementById('assignPrompt').style.display = 'none';
    markDirty();
  }
}

function renderActions() {
  const el = document.getElementById('actionList');
  el.innerHTML = editActions.map((a,i) => `
    <div class="action-row">
      <div class="action-checkbox ${a.done ? 'checked' : ''}" onclick="toggleAction(${i})"></div>
      <input class="action-input ${a.done ? 'done' : ''}" value="${esc(a.text)}" placeholder="Action item..." oninput="editAction(${i},'text',this.value)" />
      <input class="action-assignee" value="${esc(a.assignee||'')}" placeholder="Owner" oninput="editAction(${i},'assignee',this.value)" />
      <button class="action-remove" onclick="removeAction(${i})">×</button>
    </div>`).join('');
}

function addAction() {
  editActions.push({ id: 'a'+(++actionCounter), text:'', assignee:'', done:false });
  renderActions();
  markDirty();
  const inputs = document.querySelectorAll('.action-input');
  if (inputs.length) inputs[inputs.length-1].focus();
}

function toggleAction(i) {
  editActions[i].done = !editActions[i].done;
  renderActions();
  markDirty();
  if (editActions[i].done) {
    const box = document.querySelectorAll('#actionList .action-checkbox')[i];
    if (box) box.classList.add('pop');
  }
}

function editAction(i, field, val) {
  editActions[i][field] = val;
  markDirty();
}

function removeAction(i) {
  editActions.splice(i,1);
  renderActions();
  markDirty();
}

// Explicit Save button — an immediate flush of the open note.
async function saveNote() {
  await persistCurrentNote(true);
}

// Single write path for both the Save button (manual=true) and autosave
// (manual=false). Manual saves nag on validation and toast the result; autosave
// stays quiet and only updates the save-status indicator.
async function persistCurrentNote(manual) {
  cancelAutosave();
  if (!state.activeNote) return { ok: false };

  const title = document.getElementById('noteTitle').value.trim();
  const folderId = document.getElementById('noteFolder').value;

  // A note needs a title and a project before it can be saved.
  if (!title || !folderId) {
    if (manual) {
      if (!title) { showHint('Please add a title.'); return { ok: false }; }
      document.getElementById('assignPrompt').style.display = 'flex';
      showHint('Please assign a project first.');
      return { ok: false };
    }
    setStatus('Unsaved — add a title and project', 'muted');
    return { ok: false };
  }

  const seq = editSeq;
  const wasNew = state.isNew;
  const note = {
    id: wasNew ? 'n'+(Date.now()) : state.activeNote,
    folderId,
    title,
    date: document.getElementById('noteDate').value,
    attendees: document.getElementById('noteAttendees').value.trim(),
    body: document.getElementById('noteBody').value.trim(),
    actions: editActions.map(a => ({...a}))
  };

  // Commit to in-memory state synchronously (before any await) so a note switch
  // or a second autosave sees the assigned id and not-new status.
  if (wasNew) {
    state.notes.push(note);
    state.activeNote = note.id;
    state.isNew = false;
    document.getElementById('deleteBtn').style.display = 'inline-block';
  } else {
    const idx = state.notes.findIndex(n => n.id === note.id);
    if (idx >= 0) state.notes[idx] = note;
  }
  const noteId = note.id;

  setStatus('Saving…');
  const result = await saveNoteDoc(note);
  // If the editor moved to a different note mid-save, leave its status alone.
  const stillOpen = state.activeNote === noteId;

  if (result.conflict) {
    if (manual) { setStatus(''); showConflictModal(note); }
    else if (stillOpen) setStatus('⚠ Changed on another device — press Save', 'error');
    render();
    return result;
  }
  if (result.ok) {
    if (stillOpen && editSeq === seq) { savedSeq = seq; setStatus('Saved ✓'); }
    else if (stillOpen) setStatus('Unsaved…', 'muted'); // newer edits arrived during the save
    if (manual) showToast('Note saved');
  } else {
    if (stillOpen) setStatus(navigator.onLine ? '⚠ Save failed' : '⚠ Offline', 'error');
    if (manual) showToast('⚠ Save failed — check your connection');
  }
  render();
  return result;
}

function showConflictModal(note) {
  conflictNote = note;
  document.getElementById('conflictModal').classList.add('show');
}

// Keep the user's version — write it unconditionally over the other device's.
async function overwriteConflictNote() {
  closeModal('conflictModal');
  const note = conflictNote;
  conflictNote = null;
  if (!note) return;
  const ok = await forceSaveNoteDoc(note);
  if (ok) {
    savedSeq = editSeq; // the user's version is now the saved one
    setStatus('Saved ✓');
    showToast('Note saved — overwrote the other version');
  } else {
    setStatus(navigator.onLine ? '⚠ Save failed' : '⚠ Offline', 'error');
    showToast('⚠ Save failed — check your connection');
  }
  render();
}

// Discard the user's edits and load the version saved on the other device.
async function reloadConflictNote() {
  closeModal('conflictModal');
  const note = conflictNote;
  conflictNote = null;
  if (!note || !currentUser) return;
  try {
    const ref = noteRef(currentUser.uid, note.id);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const server = sanitizeData({ folders: [], notes: [{ ...snap.data(), id: snap.id }] }).notes[0];
      noteVersions[note.id] = snap.data().updatedAt || null;
      const idx = state.notes.findIndex(n => n.id === note.id);
      if (idx >= 0) state.notes[idx] = server; else state.notes.push(server);
      if (state.activeNote === note.id) {
        editActions = server.actions.map(a => ({ ...a }));
        populateForm(server);
      }
      showToast('Loaded the version from the other device');
    } else {
      // Deleted elsewhere — drop it locally too.
      delete noteVersions[note.id];
      state.notes = state.notes.filter(n => n.id !== note.id);
      if (state.activeNote === note.id) { state.activeNote = null; showEmpty(); }
      showToast('That note was deleted on the other device');
    }
    render();
  } catch(e) {
    console.warn('Failed to reload conflicting note', e);
    showToast('⚠ Could not reload — check your connection');
  }
}

function requestDeleteNote() {
  if (!state.activeNote || state.activeNote === 'new') return;
  document.getElementById('deleteModal').classList.add('show');
}

async function confirmDeleteNote() {
  closeModal('deleteModal');
  if (!state.activeNote || state.activeNote === 'new') return;
  const id = state.activeNote;
  state.notes = state.notes.filter(n => n.id !== id);
  state.activeNote = null;
  const ok = await deleteNoteDoc(id);
  showEmpty();
  showToast(ok ? 'Note deleted' : '⚠ Delete failed to sync — check your connection');
  render();
}

function openResetModal() {
  document.getElementById('resetModal').classList.add('show');
}

// Wipe every note doc + meta and reseed the default example set (Phase 2.4).
// The legacy blob backup at users/{uid} is left untouched.
async function resetAppData() {
  closeModal('resetModal');
  if (!currentUser) return;
  const uid = currentUser.uid;
  try {
    setStatus('Resetting…');
    // Delete all existing note docs (chunked — writeBatch caps at 500 ops).
    const snap = await getDocs(notesColRef(uid));
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = writeBatch(db);
      snap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    // Reseed defaults (overwrites meta + writes the default notes).
    await writeAllPerNote(uid, sanitizeData(DEFAULT_DATA));
    // Reload local state from the fresh store.
    resetLocalState();
    await loadUserData(uid);
    render();
    setStatus('');
    showToast('App reset to the starting example set');
  } catch(e) {
    console.warn('Reset failed', e);
    setStatus(navigator.onLine ? '⚠ Reset failed' : '⚠ Offline', 'error');
    showToast('⚠ Reset failed — check your connection');
  }
}

function handleSearch() {
  state.searchQuery = document.getElementById('searchInput').value;
  render();
}

function showForm(isNew) {
  document.getElementById('detailEmpty').style.display = 'none';
  document.getElementById('detailForm').style.display = 'flex';
  document.getElementById('aiPanel').style.display = 'block';
  const sheet = document.getElementById('sheet');
  sheet.classList.remove('rise');
  void sheet.offsetWidth; // restart the rise animation
  sheet.classList.add('rise');
}

function showEmpty() {
  document.getElementById('detailEmpty').style.display = 'flex';
  document.getElementById('detailForm').style.display = 'none';
  document.getElementById('aiPanel').style.display = 'none';
}

function showHint(msg) {
  const el = document.getElementById('saveHint');
  el.textContent = msg;
  el.style.color = 'var(--danger)';
  setTimeout(() => el.textContent = '', 3000);
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}

function openAddFolder() {
  document.getElementById('folderNameInput').value = '';
  document.getElementById('folderModal').classList.add('show');
  setTimeout(() => document.getElementById('folderNameInput').focus(), 100);
}

async function confirmAddFolder() {
  const name = document.getElementById('folderNameInput').value.trim();
  if (!name) return;
  const color = FOLDER_COLORS[state.folders.length % FOLDER_COLORS.length];
  const folder = { id: 'f'+(Date.now()), name, color };
  state.folders.push(folder);
  const ok = await saveMeta();
  closeModal('folderModal');
  render();
  showToast(ok ? 'Project "'+name+'" created' : '⚠ Created locally, but failed to sync');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('show');
}

function toggleAi() {
  state.aiOpen = !state.aiOpen;
  document.getElementById('aiBody').classList.toggle('open', state.aiOpen);
  document.getElementById('aiChevron').classList.toggle('open', state.aiOpen);
}

const AI_ERROR_MESSAGES = {
  'no-key': 'Add your Anthropic API key in AI settings first.',
  'auth': 'Your API key was rejected — update it in AI settings.',
  'rate': "You've hit your Anthropic rate limit — wait a moment and try again.",
  'network': 'Could not reach Anthropic — check your connection.',
  'upstream': 'Anthropic is busy right now — try again shortly.'
};

async function askAi() {
  const q = document.getElementById('aiInput').value.trim();
  if (!q) return;
  const btn = document.getElementById('aiBtn');
  const resp = document.getElementById('aiResponse');
  btn.disabled = true;
  resp.textContent = 'Thinking…';

  const notesContext = state.notes.map(n => {
    const f = state.folders.find(x => x.id === n.folderId);
    return `Meeting: "${n.title}" | Date: ${n.date} | Project: ${f ? f.name : 'None'} | Attendees: ${n.attendees}\nNotes: ${n.body}\nActions: ${n.actions.map(a => (a.done?'[done]':'[open]')+' '+a.text+(a.assignee?' ('+a.assignee+')':'')).join('; ')}`;
  }).join('\n\n---\n\n');

  try {
    const answer = await callClaude({
      system: `You are a helpful assistant for a personal meeting notes app. Answer the user's question based only on their meeting notes below. Be concise and specific. If you can't find the answer in the notes, say so.\n\n--- NOTES ---\n${notesContext}`,
      messages: [{ role: 'user', content: q }]
    });
    resp.textContent = answer || 'No answer found.';
    document.getElementById('aiInput').value = '';
  } catch(e) {
    resp.textContent = AI_ERROR_MESSAGES[e.message] || 'Something went wrong — try again.';
  }
  btn.disabled = false;
}

/* ── AI settings (BYOK) ── */
function renderKeyStatus() {
  const el = document.getElementById('keyStatus');
  const removeBtn = document.getElementById('removeKeyBtn');
  const key = getApiKey();
  // textContent on purpose — the (masked) key must never go through innerHTML
  el.textContent = key ? 'Saved on this device: sk-ant-…' + key.slice(-4) : 'No key saved on this device';
  el.classList.toggle('has-key', !!key);
  removeBtn.style.display = key ? '' : 'none';
}

function setKeyHint(msg, cls) {
  const el = document.getElementById('keyHint');
  el.textContent = msg || '';
  el.className = 'key-hint' + (cls ? ' ' + cls : '');
}

function openSettings() {
  renderKeyStatus();
  setKeyHint('');
  document.getElementById('apiKeyInput').value = '';
  document.getElementById('modelSelect').value = getAiModel();
  document.getElementById('settingsModal').classList.add('show');
}

// Verifies a key without generating anything — count_tokens is near-free.
// Returns 'valid' | 'rejected' | 'unknown' (couldn't verify, e.g. offline).
async function validateApiKey(key) {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
      method: 'POST',
      headers: anthropicHeaders(key),
      body: JSON.stringify({ model: DEFAULT_AI_MODEL, messages: [{ role: 'user', content: 'ping' }] })
    });
    if (res.ok) return 'valid';
    if (res.status === 401 || res.status === 403) return 'rejected';
    return 'unknown';
  } catch(e) { return 'unknown'; }
}

async function saveApiKey() {
  const input = document.getElementById('apiKeyInput');
  const btn = document.getElementById('saveKeyBtn');
  const key = input.value.trim();
  if (!key) { setKeyHint('Paste your API key first.', 'err'); return; }
  btn.disabled = true;
  btn.textContent = 'Checking…';
  const verdict = await validateApiKey(key);
  btn.disabled = false;
  btn.textContent = 'Save key';
  if (verdict === 'rejected') {
    setKeyHint('Anthropic rejected this key — check it and try again.', 'err');
    return;
  }
  try { localStorage.setItem(API_KEY_STORAGE, key); } catch(e) {
    setKeyHint('Could not store the key on this device.', 'err');
    return;
  }
  input.value = '';
  setKeyHint(verdict === 'valid' ? 'Key looks valid ✓' : 'Saved — could not verify it right now.', verdict === 'valid' ? 'ok' : '');
  renderKeyStatus();
  updateAiPanel();
  showToast('API key saved on this device');
}

function removeApiKey() {
  try { localStorage.removeItem(API_KEY_STORAGE); } catch(e) {}
  renderKeyStatus();
  setKeyHint('');
  updateAiPanel();
  showToast('API key removed from this device');
}

function saveModelPref() {
  const val = document.getElementById('modelSelect').value;
  if (AI_MODELS.includes(val)) {
    try { localStorage.setItem(AI_MODEL_STORAGE, val); } catch(e) {}
  }
}

// Swap the AI panel between its ready state and the add-a-key prompt.
function updateAiPanel() {
  const hasKey = !!getApiKey();
  document.getElementById('aiKeyPrompt').style.display = hasKey ? 'none' : 'flex';
  document.getElementById('aiResponse').style.display = hasKey ? '' : 'none';
  document.getElementById('aiInputRow').style.display = hasKey ? '' : 'none';
}

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d+'T00:00:00');
  return dt.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// type: undefined = brand green (saving/saved), 'muted' = neutral (unsaved),
// 'error' = brick red (offline/failed/conflict).
function setStatus(msg, type) {
  const el = document.getElementById('syncStatus');
  el.textContent = msg;
  el.classList.remove('status-muted', 'status-error');
  if (type === 'muted') el.classList.add('status-muted');
  else if (type === 'error') el.classList.add('status-error');
}

// Coerce data arriving from outside the current session (a Firestore load or an
// imported JSON file) into the known shape with safe values. Ids and colors
// render straight into innerHTML/onclick/style, so an attacker-controlled one is
// an XSS vector under BYOK (key-theft stakes) — those get regenerated/replaced
// rather than trusted. See afterword-security §3 and Masterplan Phase 1.2.
const ID_RE = /^[a-zA-Z0-9_-]+$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function safeId(v, prefix) {
  return (typeof v === 'string' && ID_RE.test(v))
    ? v
    : prefix + Date.now() + Math.random().toString(36).slice(2, 8);
}

function sanitizeData(data) {
  const rawFolders = Array.isArray(data && data.folders) ? data.folders : [];
  const rawNotes = Array.isArray(data && data.notes) ? data.notes : [];
  const folders = rawFolders.map((f, i) => ({
    id: safeId(f && f.id, 'f'),
    name: String((f && f.name) || ''),
    color: (f && typeof f.color === 'string' && COLOR_RE.test(f.color))
      ? f.color
      : FOLDER_COLORS[i % FOLDER_COLORS.length]
  }));
  const notes = rawNotes.map(n => ({
    id: safeId(n && n.id, 'n'),
    folderId: (n && typeof n.folderId === 'string' && ID_RE.test(n.folderId)) ? n.folderId : '',
    title: String((n && n.title) || ''),
    date: String((n && n.date) || ''),
    attendees: String((n && n.attendees) || ''),
    body: String((n && n.body) || ''),
    actions: Array.isArray(n && n.actions) ? n.actions.map(a => ({
      id: safeId(a && a.id, 'a'),
      text: String((a && a.text) || ''),
      assignee: String((a && a.assignee) || ''),
      done: !!(a && a.done)
    })) : []
  }));
  return { folders, notes };
}

function exportData() {
  const payload = { folders: state.folders, notes: state.notes, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0,10);
  a.href = url;
  a.download = 'afterword-backup-' + date + '.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Backup exported');
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function(ev) {
    try {
      const parsed = JSON.parse(ev.target.result);
      if (!parsed.folders || !parsed.notes) throw new Error('Invalid format');

      // Imported files are attacker-controlled input — validate before merging.
      const clean = sanitizeData(parsed);

      const existingFolderIds = new Set(state.folders.map(f => f.id));
      const existingNoteIds = new Set(state.notes.map(n => n.id));

      const newFolders = clean.folders.filter(f => !existingFolderIds.has(f.id));
      const newNotes = clean.notes.filter(n => !existingNoteIds.has(n.id));
      const updatedNotes = clean.notes.filter(n => existingNoteIds.has(n.id));

      state.folders = [...state.folders, ...newFolders];
      updatedNotes.forEach(imported => {
        const idx = state.notes.findIndex(n => n.id === imported.id);
        if (idx >= 0) state.notes[idx] = imported;
      });
      state.notes = [...state.notes, ...newNotes];

      state.activeNote = null;
      state.activeFolder = null;
      // Persist only the folders (meta) and the notes that actually changed.
      let ok = true;
      if (currentUser) {
        try {
          await writeAllPerNote(currentUser.uid, { folders: state.folders, notes: [...newNotes, ...updatedNotes] });
        } catch(e) { console.warn('Import sync failed', e); ok = false; }
      } else {
        ok = false;
      }
      showEmpty();
      render();

      const summary = [];
      if (newNotes.length) summary.push(newNotes.length + ' new note' + (newNotes.length > 1 ? 's' : ''));
      if (updatedNotes.length) summary.push(updatedNotes.length + ' updated');
      if (newFolders.length) summary.push(newFolders.length + ' new project' + (newFolders.length > 1 ? 's' : ''));
      showToast((ok ? 'Imported: ' : '⚠ Imported locally (sync failed): ') + (summary.length ? summary.join(', ') : 'nothing new'));
    } catch(err) {
      showToast('Import failed: invalid file');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
}

function isMobile() { return window.innerWidth <= 700; }

function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('show');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('show');
}

function toggleSidebarCollapse() {
  const collapsed = document.getElementById('sidebar').classList.toggle('collapsed');
  const btn = document.getElementById('sidebarCollapseBtn');
  btn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  btn.setAttribute('aria-label', btn.title);
  try { localStorage.setItem('afterword_sidebar_collapsed', collapsed ? '1' : '0'); } catch(e) {}
}

function mobileShowNotes() {
  document.getElementById('noteList').classList.remove('hidden');
  document.getElementById('detailPanel').classList.add('hidden');
  document.getElementById('mobileNotesBtn').classList.add('active');
  document.getElementById('mobileNewBtn').classList.remove('active');
}

function mobileShowDetail() {
  if (!isMobile()) return;
  document.getElementById('noteList').classList.add('hidden');
  document.getElementById('detailPanel').classList.remove('hidden');
  document.getElementById('mobileNotesBtn').classList.remove('active');
}

function mobileBack() {
  commitPendingEdits();
  mobileShowNotes();
  state.activeNote = null;
  showEmpty();
  render();
}

/* ── Theme ── */
function syncThemeIcons() {
  const dark = document.documentElement.dataset.theme === 'dark';
  document.getElementById('iconMoon').style.display = dark ? 'none' : 'block';
  document.getElementById('iconSun').style.display = dark ? 'block' : 'none';
}

function toggleTheme() {
  const root = document.documentElement;
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  try { localStorage.setItem('afterword_theme', next); } catch(e) {}
  syncThemeIcons();
  const btn = document.getElementById('themeToggle');
  btn.classList.remove('spun');
  void btn.offsetWidth;
  btn.classList.add('spun');
}

syncThemeIcons();
updateAiPanel();
try {
  if (localStorage.getItem('afterword_sidebar_collapsed') === '1') {
    document.getElementById('sidebar').classList.add('collapsed');
    document.getElementById('sidebarCollapseBtn').title = 'Expand sidebar';
  }
} catch(e) {}

const noteCardsEl = document.getElementById('noteCards');

function resetLocalState() {
  state.folders = [];
  state.notes = [];
  state.activeFolder = null;
  state.activeNote = null;
  state.isNew = false;
  state.searchQuery = '';
  editActions = [];
  noteVersions = {};
  conflictNote = null;
  editSeq = 0;
  savedSeq = 0;
  cancelAutosave();
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = '';
  showEmpty();
  render();
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  const screen = document.getElementById('signinScreen');
  const lede = document.getElementById('signinLede');
  const googleBtn = document.getElementById('signinGoogleBtn');
  const signOutBtn = document.getElementById('signOutBtn');

  if (user) {
    screen.style.display = 'none';
    signOutBtn.style.display = '';
    signOutBtn.title = 'Sign out (' + (user.email || '') + ')';
    // Wipe out whatever the previous account left in state/the detail panel
    // before loading this account's own data — belt-and-suspenders on top
    // of the sign-out reset below, so no stale note can ever survive a
    // sign-out/sign-in cycle regardless of event timing.
    resetLocalState();
    await loadUserData(user.uid);
    render();
    if (isMobile()) mobileShowNotes();
    // stagger the note list in on first paint only
    noteCardsEl.classList.add('intro');
    setTimeout(() => noteCardsEl.classList.remove('intro'), 1000);
  } else {
    screen.style.display = 'flex';
    lede.textContent = 'Sign in to access your notes.';
    googleBtn.style.display = '';
    signOutBtn.style.display = 'none';
    resetLocalState();
  }
});

// Warn before leaving with an unsaved (or still-saving) edit in the editor.
window.addEventListener('beforeunload', (e) => {
  if (editSeq !== savedSeq) { e.preventDefault(); e.returnValue = ''; }
});

// Expose functions to global scope (required for onclick attributes with type="module")
window.selectFolder = selectFolder;
window.markDirty = markDirty;
window.selectNote = selectNote;
window.newNote = newNote;
window.saveNote = saveNote;
window.requestDeleteNote = requestDeleteNote;
window.confirmDeleteNote = confirmDeleteNote;
window.overwriteConflictNote = overwriteConflictNote;
window.reloadConflictNote = reloadConflictNote;
window.openResetModal = openResetModal;
window.resetAppData = resetAppData;
window.addAction = addAction;
window.toggleAction = toggleAction;
window.editAction = editAction;
window.removeAction = removeAction;
window.openAddFolder = openAddFolder;
window.confirmAddFolder = confirmAddFolder;
window.closeModal = closeModal;
window.assignFolder = assignFolder;
window.onFolderSelectChange = onFolderSelectChange;
window.handleSearch = handleSearch;
window.toggleAi = toggleAi;
window.askAi = askAi;
window.exportData = exportData;
window.importData = importData;
window.openSidebar = openSidebar;
window.closeSidebar = closeSidebar;
window.toggleSidebarCollapse = toggleSidebarCollapse;
window.mobileShowNotes = mobileShowNotes;
window.mobileBack = mobileBack;
window.toggleTheme = toggleTheme;
window.signInWithGoogle = signInWithGoogle;
window.signOutUser = signOutUser;
window.openSettings = openSettings;
window.saveApiKey = saveApiKey;
window.removeApiKey = removeApiKey;
window.saveModelPref = saveModelPref;
