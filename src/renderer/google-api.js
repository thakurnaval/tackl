// Calls Google's Calendar and Tasks REST APIs directly from the browser, using a
// short-lived OAuth access token obtained via incremental authorization
// (see connectGoogleIntegrations() in auth.js). Nothing here is persisted —
// the token lives only in memory for this tab's session.

import { connectGoogleIntegrations } from './auth.js';

let accessToken = null;
let obtainedAt = 0;
const TOKEN_LIFETIME_MS = 55 * 60 * 1000; // refresh a bit before Google's ~1hr expiry

async function getAccessToken() {
  const isFresh = accessToken && Date.now() - obtainedAt < TOKEN_LIFETIME_MS;
  if (isFresh) return accessToken;
  accessToken = await connectGoogleIntegrations();
  obtainedAt = Date.now();
  return accessToken;
}

async function googleFetch(url, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google API ${res.status}: ${body.slice(0, 300)}`);
  }
  const contentType = res.headers.get('content-type') || '';
  return contentType.includes('application/json') ? res.json() : undefined;
}

export async function createCalendarEvent(taskText, startISO, endISO) {
  const event = await googleFetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: taskText,
        start: { dateTime: startISO },
        end: { dateTime: endISO },
      }),
    }
  );
  return { id: event.id, htmlLink: event.htmlLink };
}

async function findOrCreateTacklTaskList() {
  const { items = [] } = await googleFetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists');
  const existing = items.find((list) => list.title === 'Tackl');
  if (existing) return existing.id;
  const created = await googleFetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Tackl' }),
  });
  return created.id;
}

// One-way mirror of the current task list into a "Tackl" Google Tasks list.
// Upserts via each task's stored googleTaskId so re-running doesn't duplicate.
// Returns a map of { taskId: googleTaskId } for tasks that were created (not updated).
export async function backupTasksToGoogleTasks(tasks) {
  const listId = await findOrCreateTacklTaskList();
  const createdIds = {};

  for (const task of tasks) {
    const body = {
      title: task.text,
      status: task.completed ? 'completed' : 'needsAction',
      notes: task.important
        ? task.urgent
          ? 'Tackl: Do First'
          : 'Tackl: Schedule'
        : task.urgent
          ? 'Tackl: Delegate'
          : 'Tackl: Eliminate',
    };
    if (task.scheduledAt) body.due = new Date(task.scheduledAt).toISOString();

    if (task.googleTaskId) {
      await googleFetch(
        `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${task.googleTaskId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
    } else {
      const created = await googleFetch(
        `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      createdIds[task.id] = created.id;
    }
  }

  return createdIds;
}
