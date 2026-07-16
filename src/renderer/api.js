import { getIdToken } from './auth.js';

async function request(method, url, body) {
  const token = await getIdToken();
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${url} failed: ${res.status}`);
  const contentType = res.headers.get('content-type') || '';
  return contentType.includes('application/json') ? res.json() : undefined;
}

export const api = {
  getAllTasks: () => request('GET', '/api/tasks'),
  addTask: (text, important, urgent) =>
    request('POST', '/api/tasks', { text, important, urgent }),
  updateTaskText: (id, text) =>
    request('PATCH', `/api/tasks/${id}/text`, { text }),
  setCompleted: (id, completed) =>
    request('PATCH', `/api/tasks/${id}/completed`, { completed }),
  deleteTask: (id) => request('DELETE', `/api/tasks/${id}`),
  moveTask: (id, important, urgent, newIndex) =>
    request('PATCH', `/api/tasks/${id}/move`, { important, urgent, newIndex }),
  deleteAccount: () => request('DELETE', '/api/account'),
};
