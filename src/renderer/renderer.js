/* Tackl renderer: guest (local) / signed-in (remote) storage switch + chat entry flow + drag-and-drop matrix */

import { api as remoteApi } from './api.js';
import { localStore } from './local-store.js';
import {
  watchAuthState,
  signIn,
  signUp,
  signInWithGoogle,
  signOutUser,
} from './auth.js';

const chatLog = document.getElementById('chat-log');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const guestBanner = document.getElementById('guest-banner');

// Tasks are stored locally (guest) until someone signs in, then switch to Firestore.
let store = localStore;

// ---------- Auth ----------

const openSignInBtn = document.getElementById('sign-in-btn');
const authPopover = document.getElementById('auth-popover');
const authCloseBtn = document.getElementById('auth-close');
const authForm = document.getElementById('auth-form');
const authEmail = document.getElementById('auth-email');
const authPassword = document.getElementById('auth-password');
const authError = document.getElementById('auth-error');
const authSubmitBtn = document.getElementById('auth-signin');
const authSignUpBtn = document.getElementById('auth-signup');
const googleBtn = document.getElementById('auth-google');
const signOutBtn = document.getElementById('sign-out');
const userEmailLabel = document.getElementById('user-email');

function showError(err) {
  authError.textContent = err.message || String(err);
}

function openPopover() {
  authError.textContent = '';
  authPopover.hidden = false;
}

function closePopover() {
  authPopover.hidden = true;
}

openSignInBtn.addEventListener('click', () => {
  if (authPopover.hidden) openPopover();
  else closePopover();
});
authCloseBtn.addEventListener('click', closePopover);

authForm.addEventListener('submit', (e) => {
  e.preventDefault();
  authError.textContent = '';
  signIn(authEmail.value, authPassword.value).catch(showError);
});
authSignUpBtn.addEventListener('click', () => {
  authError.textContent = '';
  signUp(authEmail.value, authPassword.value).catch(showError);
});
googleBtn.addEventListener('click', () => {
  authError.textContent = '';
  signInWithGoogle().catch(showError);
});
signOutBtn.addEventListener('click', () => signOutUser());

// Uploads any guest-mode tasks (made before signing in) into the newly-signed-in
// account's Firestore collection, preserving quadrant/order and completed state.
async function migrateGuestTasks() {
  const guestTasks = await localStore.getAllTasks();
  if (guestTasks.length === 0) return;
  for (const t of guestTasks) {
    const { id } = await remoteApi.addTask(t.text, t.important, t.urgent);
    if (t.completed) await remoteApi.setCompleted(id, true);
  }
  localStore.clearAll();
}

watchAuthState(async (user) => {
  if (user) {
    closePopover();
    openSignInBtn.hidden = true;
    signOutBtn.hidden = false;
    guestBanner.hidden = true;
    userEmailLabel.textContent = user.email || user.displayName || '';
    authEmail.value = '';
    authPassword.value = '';
    authError.textContent = '';
    await migrateGuestTasks();
    store = remoteApi;
  } else {
    openSignInBtn.hidden = false;
    signOutBtn.hidden = true;
    guestBanner.hidden = false;
    userEmailLabel.textContent = '';
    store = localStore;
  }
  await refresh();
});

// ---------- Chat flow state machine ----------
// idle -> asking (important) -> asking (urgent) -> save -> idle
let pending = null; // { text, important }

function addMsg(text, who) {
  const div = document.createElement('div');
  div.className = `msg ${who}`;
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

function addYesNoButtons(onAnswer) {
  const wrap = document.createElement('div');
  wrap.className = 'msg-buttons';
  for (const [label, val] of [['Yes', true], ['No', false]]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      wrap.remove();
      addMsg(label, 'user');
      onAnswer(val);
    });
    wrap.appendChild(btn);
  }
  chatLog.appendChild(wrap);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function askImportant() {
  addMsg('Is this important?', 'bot');
  addYesNoButtons((important) => {
    pending.important = important;
    askUrgent();
  });
}

function askUrgent() {
  addMsg('Is this urgent?', 'bot');
  addYesNoButtons(async (urgent) => {
    const { text, important } = pending;
    pending = null;
    await store.addTask(text, important, urgent);
    const q = important ? (urgent ? 'Q1: Do First' : 'Q2: Schedule') : urgent ? 'Q3: Delegate' : 'Q4: Eliminate';
    addMsg(`Added to ${q}.`, 'bot');
    chatInput.disabled = false;
    chatInput.focus();
    await refresh();
  });
}

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text || pending || chatInput.disabled) return;
  addMsg(text, 'user');
  chatInput.value = '';
  chatInput.disabled = true;
  pending = { text, important: null };
  askImportant();
});

// ---------- Matrix rendering ----------

const lists = Array.from(document.querySelectorAll('.task-list'));

function listFor(important, urgent) {
  return lists.find(
    (l) => l.dataset.important === String(important) && l.dataset.urgent === String(urgent)
  );
}

function makeCard(task, index) {
  const li = document.createElement('li');
  li.className = 'task-card' + (task.completed ? ' completed' : '');
  li.draggable = true;
  li.dataset.id = task.id;

  const num = document.createElement('span');
  num.className = 'task-num';
  num.textContent = index + 1;

  const text = document.createElement('span');
  text.className = 'task-text';
  text.textContent = task.text;

  const actions = document.createElement('span');
  actions.className = 'task-actions';

  const doneBtn = document.createElement('button');
  doneBtn.title = task.completed ? 'Mark incomplete' : 'Mark complete';
  doneBtn.textContent = task.completed ? '↩︎' : '✓';
  doneBtn.addEventListener('click', async () => {
    await store.setCompleted(task.id, !task.completed);
    await refresh();
  });

  const editBtn = document.createElement('button');
  editBtn.title = 'Edit';
  editBtn.textContent = '✎';
  editBtn.addEventListener('click', () => startEdit(li, text, task));

  const delBtn = document.createElement('button');
  delBtn.title = 'Delete';
  delBtn.textContent = '✕';
  delBtn.addEventListener('click', async () => {
    await store.deleteTask(task.id);
    await refresh();
  });

  actions.append(doneBtn, editBtn, delBtn);
  li.append(num, text, actions);

  li.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', String(task.id));
    e.dataTransfer.effectAllowed = 'move';
    li.classList.add('dragging');
  });
  li.addEventListener('dragend', () => li.classList.remove('dragging'));

  return li;
}

function startEdit(li, textSpan, task) {
  if (li.querySelector('input')) return;
  li.draggable = false;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = task.text;
  textSpan.textContent = '';
  textSpan.appendChild(input);
  input.focus();
  input.select();

  const finish = async (save) => {
    const val = input.value.trim();
    if (save && val && val !== task.text) {
      await store.updateTaskText(task.id, val);
    }
    await refresh();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

async function refresh() {
  const tasks = await store.getAllTasks();
  for (const list of lists) list.replaceChildren();
  const grouped = new Map();
  for (const t of tasks) {
    const key = `${t.important}-${t.urgent}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(t);
  }
  for (const [key, group] of grouped) {
    const [imp, urg] = key.split('-');
    const list = listFor(imp, urg);
    group.forEach((task, i) => list.appendChild(makeCard(task, i)));
  }
}

// ---------- Drag and drop ----------

function dropIndex(list, y) {
  const cards = Array.from(list.querySelectorAll('.task-card:not(.dragging)'));
  for (let i = 0; i < cards.length; i++) {
    const rect = cards[i].getBoundingClientRect();
    if (y < rect.top + rect.height / 2) return i;
  }
  return cards.length;
}

for (const list of lists) {
  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    list.classList.add('drag-over');
  });
  list.addEventListener('dragleave', (e) => {
    if (!list.contains(e.relatedTarget)) list.classList.remove('drag-over');
  });
  list.addEventListener('drop', async (e) => {
    e.preventDefault();
    list.classList.remove('drag-over');
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;
    const important = list.dataset.important === '1';
    const urgent = list.dataset.urgent === '1';
    await store.moveTask(id, important, urgent, dropIndex(list, e.clientY));
    await refresh();
  });
}

// Also allow dropping anywhere on a quadrant (not just the list)
for (const quad of document.querySelectorAll('.quadrant')) {
  quad.addEventListener('dragover', (e) => e.preventDefault());
  quad.addEventListener('drop', async (e) => {
    if (e.target.closest('.task-list')) return; // handled above
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;
    const important = quad.dataset.important === '1';
    const urgent = quad.dataset.urgent === '1';
    const list = quad.querySelector('.task-list');
    await store.moveTask(id, important, urgent, list.children.length);
    await refresh();
  });
}

// ---------- Init ----------

addMsg('Type a task below and press Return to get started.', 'bot');
refresh();
