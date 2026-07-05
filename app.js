import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// Muted-but-specific folder tones, derived from the Vesatile palette
const FOLDER_COLORS = ['#3B5244','#8B3A3A','#A8842C','#4A6274','#6E5A7E','#31606B','#9C6B4E','#7A8581'];

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

function userDocRef(uid) {
  return doc(db, 'users', uid);
}

async function loadUserData(uid) {
  try {
    const snap = await getDoc(userDocRef(uid));
    if (snap.exists()) {
      const data = snap.data();
      state.folders = data.folders || [];
      state.notes = data.notes || [];
    } else {
      // Deep-clone so per-account edits never mutate the shared DEFAULT_DATA constant.
      state.folders = JSON.parse(JSON.stringify(DEFAULT_DATA.folders));
      state.notes = JSON.parse(JSON.stringify(DEFAULT_DATA.notes));
      await setDoc(userDocRef(uid), { folders: state.folders, notes: state.notes });
    }
  } catch(e) {
    console.warn('Failed to load notes from Firestore', e);
    showToast('⚠ Could not load your notes — check your connection');
  }
}

async function saveData() {
  if (!currentUser) return false;
  try {
    await setDoc(userDocRef(currentUser.uid), { folders: state.folders, notes: state.notes });
    return true;
  } catch(e) {
    console.warn('Failed to save notes to Firestore', e);
    return false;
  }
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
  await signOut(auth);
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
      <div class="folder-dot" style="background:${f.color}"></div>
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
      <div class="note-card-meta">${formatDate(n.date)}${f ? ' · <span class="meta-proj"><i style="background:'+f.color+'"></i>'+esc(f.name)+'</span>' : ''}${open ? ' · <span class="meta-open">'+open+' open</span>' : ''}</div>
      <div class="note-card-preview">${esc(n.body)}</div>
    </div>`;
  }).join('');
}

function selectFolder(id) {
  state.activeFolder = id;
  state.activeNote = null;
  state.isNew = false;
  closeSidebar();
  showEmpty();
  render();
}

function selectNote(id) {
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
}

function assignFolder() {
  const val = document.getElementById('assignSelect').value;
  if (val) {
    document.getElementById('noteFolder').value = val;
    document.getElementById('assignPrompt').style.display = 'none';
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
  const inputs = document.querySelectorAll('.action-input');
  if (inputs.length) inputs[inputs.length-1].focus();
}

function toggleAction(i) {
  editActions[i].done = !editActions[i].done;
  renderActions();
  if (editActions[i].done) {
    const box = document.querySelectorAll('#actionList .action-checkbox')[i];
    if (box) box.classList.add('pop');
  }
}

function editAction(i, field, val) {
  editActions[i][field] = val;
}

function removeAction(i) {
  editActions.splice(i,1);
  renderActions();
}

async function saveNote() {
  const title = document.getElementById('noteTitle').value.trim();
  const folderId = document.getElementById('noteFolder').value;

  if (!title) { showHint('Please add a title.'); return; }
  if (!folderId) {
    document.getElementById('assignPrompt').style.display = 'flex';
    showHint('Please assign a project first.');
    return;
  }

  const note = {
    id: state.isNew ? 'n'+(Date.now()) : state.activeNote,
    folderId,
    title,
    date: document.getElementById('noteDate').value,
    attendees: document.getElementById('noteAttendees').value.trim(),
    body: document.getElementById('noteBody').value.trim(),
    actions: editActions.map(a => ({...a}))
  };

  if (state.isNew) {
    state.notes.push(note);
    state.activeNote = note.id;
    state.isNew = false;
    document.getElementById('deleteBtn').style.display = 'inline-block';
  } else {
    const idx = state.notes.findIndex(n => n.id === note.id);
    if (idx >= 0) state.notes[idx] = note;
  }

  const ok = await saveData();
  if (ok) {
    setStatus('Saved ✓');
    setTimeout(() => setStatus(''), 2000);
    showToast('Note saved');
  } else {
    setStatus('');
    showToast('⚠ Save failed — check your connection');
  }
  render();
}

async function deleteNote() {
  if (!state.activeNote || state.activeNote === 'new') return;
  const id = state.activeNote;
  state.notes = state.notes.filter(n => n.id !== id);
  state.activeNote = null;
  const ok = await saveData();
  showEmpty();
  showToast(ok ? 'Note deleted' : '⚠ Delete failed to sync — check your connection');
  render();
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
  const ok = await saveData();
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
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-latest',
        max_tokens: 1000,
        system: `You are a helpful assistant for a personal meeting notes app. Answer the user's question based only on their meeting notes below. Be concise and specific. If you can't find the answer in the notes, say so.\n\n--- NOTES ---\n${notesContext}`,
        messages: [{ role: 'user', content: q }]
      })
    });
    const data = await res.json();
    resp.textContent = data.content?.[0]?.text || 'No answer found.';
  } catch(e) {
    resp.textContent = 'Could not reach the AI. Check your connection.';
  }
  btn.disabled = false;
  document.getElementById('aiInput').value = '';
}

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d+'T00:00:00');
  return dt.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function setStatus(msg) {
  document.getElementById('syncStatus').textContent = msg;
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

      const existingFolderIds = new Set(state.folders.map(f => f.id));
      const existingNoteIds = new Set(state.notes.map(n => n.id));

      const newFolders = parsed.folders.filter(f => !existingFolderIds.has(f.id));
      const newNotes = parsed.notes.filter(n => !existingNoteIds.has(n.id));
      const updatedNotes = parsed.notes.filter(n => existingNoteIds.has(n.id));

      state.folders = [...state.folders, ...newFolders];
      updatedNotes.forEach(imported => {
        const idx = state.notes.findIndex(n => n.id === imported.id);
        if (idx >= 0) state.notes[idx] = imported;
      });
      state.notes = [...state.notes, ...newNotes];

      state.activeNote = null;
      state.activeFolder = null;
      const ok = await saveData();
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

// Expose functions to global scope (required for onclick attributes with type="module")
window.selectFolder = selectFolder;
window.selectNote = selectNote;
window.newNote = newNote;
window.saveNote = saveNote;
window.deleteNote = deleteNote;
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
