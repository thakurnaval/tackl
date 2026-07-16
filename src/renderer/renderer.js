/* Tackl renderer: guest (local) / signed-in (remote) storage switch + chat entry flow + drag-and-drop matrix */

import { api as remoteApi } from './api.js';
import { localStore } from './local-store.js';
import {
  watchAuthState,
  signIn,
  signUp,
  signInWithGoogle,
  signOutUser,
  isGoogleUser,
  resetPassword,
  resendVerificationEmail,
  isEmailVerified,
} from './auth.js';
import { createCalendarEvent, backupTasksToGoogleTasks } from './google-api.js';

const chatLog = document.getElementById('chat-log');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const guestBanner = document.getElementById('guest-banner');
const verifyBanner = document.getElementById('verify-banner');
const resendVerificationBtn = document.getElementById('resend-verification');

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
const authForgotBtn = document.getElementById('auth-forgot');
const googleBtn = document.getElementById('auth-google');
const signOutBtn = document.getElementById('sign-out');
const deleteAccountBtn = document.getElementById('delete-account-btn');
const backupBtn = document.getElementById('backup-btn');
const userEmailLabel = document.getElementById('user-email');

const AUTH_ERROR_MESSAGES = {
  'auth/invalid-email': 'That email address doesn\'t look valid.',
  'auth/missing-email': 'Enter your email address.',
  'auth/missing-password': 'Enter your password.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/email-already-in-use': 'An account with this email already exists — try signing in instead.',
  'auth/user-not-found': 'Incorrect email or password.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/too-many-requests': 'Too many attempts — please wait a moment and try again.',
  'auth/network-request-failed': 'Network error — check your connection and try again.',
  'auth/popup-closed-by-user': 'Sign-in was cancelled.',
  'auth/internal-error': 'That sign-in method isn\'t set up yet — please try a different option.',
  'auth/operation-not-allowed': 'That sign-in method isn\'t enabled yet — please try a different option.',
};

function showError(err) {
  authError.classList.remove('success');
  authError.textContent = AUTH_ERROR_MESSAGES[err.code] || err.message || String(err);
}

function openPopover() {
  authError.classList.remove('success');
  authError.textContent = '';
  authPopover.hidden = false;
}

function closePopover() {
  authPopover.hidden = true;
}

// Basic client-side validation so empty fields produce a clear message instead of
// a confusing Firebase error code (e.g. auth/invalid-email for an empty string).
function validCredentials() {
  if (!authEmail.value.trim()) {
    authError.textContent = 'Enter your email address.';
    authEmail.focus();
    return false;
  }
  if (!authPassword.value) {
    authError.textContent = 'Enter your password.';
    authPassword.focus();
    return false;
  }
  return true;
}

openSignInBtn.addEventListener('click', () => {
  if (authPopover.hidden) openPopover();
  else closePopover();
});
authCloseBtn.addEventListener('click', closePopover);

authForm.addEventListener('submit', (e) => {
  e.preventDefault();
  authError.textContent = '';
  if (!validCredentials()) return;
  signIn(authEmail.value, authPassword.value).catch(showError);
});
authSignUpBtn.addEventListener('click', () => {
  authError.textContent = '';
  if (!validCredentials()) return;
  signUp(authEmail.value, authPassword.value).catch(showError);
});
googleBtn.addEventListener('click', () => {
  authError.textContent = '';
  signInWithGoogle().catch(showError);
});

authForgotBtn.addEventListener('click', async () => {
  authError.textContent = '';
  const email = authEmail.value.trim();
  if (!email) {
    authError.textContent = 'Enter your email address above first.';
    authEmail.focus();
    return;
  }
  try {
    await resetPassword(email);
    authError.classList.add('success');
    authError.textContent = `Password reset email sent to ${email}.`;
  } catch (err) {
    showError(err);
  }
});

signOutBtn.addEventListener('click', () => signOutUser());

resendVerificationBtn.addEventListener('click', async () => {
  resendVerificationBtn.disabled = true;
  resendVerificationBtn.textContent = 'sending…';
  try {
    await resendVerificationEmail();
    resendVerificationBtn.textContent = 'sent!';
  } catch {
    resendVerificationBtn.textContent = 'resend the email';
    resendVerificationBtn.disabled = false;
  }
});

deleteAccountBtn.addEventListener('click', async () => {
  const confirmed = confirm(
    'Delete your Tackl account? This permanently deletes all of your tasks and cannot be undone.'
  );
  if (!confirmed) return;
  try {
    await remoteApi.deleteAccount();
    await signOutUser();
  } catch (err) {
    alert(`Couldn't delete account: ${err.message || err}`);
  }
});

// ---------- Google integrations: Delegate / Schedule / Backup ----------

const delegatePopover = document.getElementById('delegate-popover');
const delegateEmail = document.getElementById('delegate-email');
const delegateNote = document.getElementById('delegate-note');
const delegateError = document.getElementById('delegate-error');
const delegateCloseBtn = document.getElementById('delegate-close');
const delegateSendBtn = document.getElementById('delegate-send');

const schedulePopover = document.getElementById('schedule-popover');
const scheduleDatetime = document.getElementById('schedule-datetime');
const scheduleError = document.getElementById('schedule-error');
const scheduleCloseBtn = document.getElementById('schedule-close');
const scheduleSaveBtn = document.getElementById('schedule-save');

let activeTask = null; // the task currently targeted by an open popover

function openDelegatePopover(task) {
  activeTask = task;
  delegateEmail.value = '';
  delegateNote.value = '';
  delegateError.textContent = '';
  delegatePopover.hidden = false;
  delegateEmail.focus();
}

function closeDelegatePopover() {
  delegatePopover.hidden = true;
  activeTask = null;
}

function openSchedulePopover(task) {
  if (!isGoogleUser()) {
    addMsg('Schedule needs a Google account — sign in with Google to use it.', 'bot');
    return;
  }
  activeTask = task;
  scheduleDatetime.value = '';
  scheduleError.textContent = '';
  schedulePopover.hidden = false;
  scheduleDatetime.focus();
}

function closeSchedulePopover() {
  schedulePopover.hidden = true;
  activeTask = null;
}

delegateCloseBtn.addEventListener('click', closeDelegatePopover);
scheduleCloseBtn.addEventListener('click', closeSchedulePopover);

delegateSendBtn.addEventListener('click', async () => {
  const email = delegateEmail.value.trim();
  if (!email) {
    delegateError.textContent = 'Enter a recipient email address.';
    return;
  }
  const task = activeTask;
  const subject = `Task: ${task.text}`;
  const body = delegateNote.value.trim()
    ? `${delegateNote.value.trim()}\n\n---\n${task.text}`
    : task.text;
  const mailtoUrl =
    `mailto:${encodeURIComponent(email)}` +
    `?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.open(mailtoUrl, '_blank');

  await store.updateTaskMeta(task.id, {
    delegatedTo: email,
    delegatedAt: new Date().toISOString(),
  });
  closeDelegatePopover();
  await refresh();
});

scheduleSaveBtn.addEventListener('click', async () => {
  const value = scheduleDatetime.value;
  if (!value) {
    scheduleError.textContent = 'Pick a date and time.';
    return;
  }
  const task = activeTask;
  const start = new Date(value);
  const end = new Date(start.getTime() + 30 * 60 * 1000); // default 30-minute block
  scheduleError.textContent = '';
  scheduleSaveBtn.disabled = true;
  try {
    const { id: calendarEventId, htmlLink: calendarEventLink } = await createCalendarEvent(
      task.text,
      start.toISOString(),
      end.toISOString()
    );
    await store.updateTaskMeta(task.id, {
      calendarEventId,
      calendarEventLink,
      scheduledAt: start.toISOString(),
    });
    closeSchedulePopover();
    await refresh();
  } catch (err) {
    scheduleError.textContent = err.message || String(err);
  } finally {
    scheduleSaveBtn.disabled = false;
  }
});

backupBtn.addEventListener('click', async () => {
  if (!isGoogleUser()) return;
  backupBtn.disabled = true;
  try {
    const tasks = await store.getAllTasks();
    const createdIds = await backupTasksToGoogleTasks(tasks);
    for (const [taskId, googleTaskId] of Object.entries(createdIds)) {
      await store.updateTaskMeta(taskId, { googleTaskId });
    }
    addMsg(`Backed up ${tasks.length} task(s) to Google Tasks ("Tackl" list).`, 'bot');
  } catch (err) {
    addMsg(`Backup failed: ${err.message || err}`, 'bot');
  } finally {
    backupBtn.disabled = false;
  }
});

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
    deleteAccountBtn.hidden = false;
    backupBtn.hidden = !isGoogleUser();
    guestBanner.hidden = true;
    verifyBanner.hidden = isEmailVerified();
    resendVerificationBtn.disabled = false;
    resendVerificationBtn.textContent = 'resend the email';
    userEmailLabel.textContent = user.email || user.displayName || '';
    authEmail.value = '';
    authPassword.value = '';
    authError.textContent = '';
    await migrateGuestTasks();
    store = remoteApi;
  } else {
    openSignInBtn.hidden = false;
    signOutBtn.hidden = true;
    deleteAccountBtn.hidden = true;
    backupBtn.hidden = true;
    guestBanner.hidden = false;
    verifyBanner.hidden = true;
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

  const delegateBtn = document.createElement('button');
  delegateBtn.title = task.delegatedTo ? `Delegated to ${task.delegatedTo}` : 'Delegate';
  delegateBtn.textContent = '✉';
  delegateBtn.addEventListener('click', () => openDelegatePopover(task));

  const scheduleBtn = document.createElement('button');
  scheduleBtn.title = task.calendarEventLink ? 'Scheduled on Calendar' : 'Schedule';
  scheduleBtn.textContent = '📅';
  scheduleBtn.addEventListener('click', () => openSchedulePopover(task));

  const delBtn = document.createElement('button');
  delBtn.title = 'Delete';
  delBtn.textContent = '✕';
  delBtn.addEventListener('click', async () => {
    await store.deleteTask(task.id);
    await refresh();
  });

  actions.append(doneBtn, editBtn, delegateBtn, scheduleBtn, delBtn);
  li.append(num, text, actions);

  if (task.delegatedTo || task.calendarEventLink) {
    const badges = document.createElement('span');
    badges.className = 'task-badges';
    if (task.delegatedTo) {
      const b = document.createElement('span');
      b.className = 'task-badge';
      b.textContent = `✉ ${task.delegatedTo}`;
      badges.appendChild(b);
    }
    if (task.calendarEventLink) {
      const b = document.createElement('a');
      b.className = 'task-badge';
      b.textContent = '📅 Calendar';
      b.href = task.calendarEventLink;
      b.target = '_blank';
      b.rel = 'noopener';
      badges.appendChild(b);
    }
    li.appendChild(badges);
  }

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
