// Guest-mode task store: mirrors the api.js interface but persists to localStorage only.
// Used when no one is signed in, so the app is still usable without an account.

const STORAGE_KEY = 'tackl:guestTasks';

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function save(tasks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function sortTasks(tasks) {
  return [...tasks].sort(
    (a, b) =>
      b.important - a.important ||
      b.urgent - a.urgent ||
      a.completed - b.completed ||
      a.position - b.position ||
      (a.id < b.id ? -1 : 1)
  );
}

function quadrantMaxPos(tasks, important, urgent, excludeId) {
  return tasks.reduce((max, t) => {
    if (t.important !== important || t.urgent !== urgent || t.id === excludeId) return max;
    return Math.max(max, t.position);
  }, -1);
}

export const localStore = {
  async getAllTasks() {
    return sortTasks(load());
  },

  async addTask(text, important, urgent) {
    const tasks = load();
    const imp = important ? 1 : 0;
    const urg = urgent ? 1 : 0;
    const id = crypto.randomUUID();
    const maxPos = quadrantMaxPos(tasks, imp, urg);
    tasks.push({
      id,
      text: text.trim(),
      important: imp,
      urgent: urg,
      position: maxPos + 1,
      completed: 0,
    });
    save(tasks);
    return { id };
  },

  async updateTaskText(id, text) {
    const tasks = load();
    const task = tasks.find((t) => t.id === id);
    if (task) task.text = text.trim();
    save(tasks);
  },

  async setCompleted(id, completed) {
    const tasks = load();
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const maxPos = quadrantMaxPos(tasks, task.important, task.urgent, id);
    task.completed = completed ? 1 : 0;
    task.position = maxPos + 1;
    save(tasks);
  },

  async deleteTask(id) {
    save(load().filter((t) => t.id !== id));
  },

  async moveTask(id, important, urgent, newIndex) {
    const tasks = load();
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const imp = important ? 1 : 0;
    const urg = urgent ? 1 : 0;
    const prevImportant = task.important;
    const prevUrgent = task.urgent;

    const targetIds = sortTasks(
      tasks.filter((t) => t.important === imp && t.urgent === urg && t.id !== id)
    ).map((t) => t.id);
    const idx = Math.max(0, Math.min(newIndex, targetIds.length));
    targetIds.splice(idx, 0, id);
    targetIds.forEach((taskId, i) => {
      const t = tasks.find((x) => x.id === taskId);
      t.important = imp;
      t.urgent = urg;
      t.position = i;
    });

    if (prevImportant !== imp || prevUrgent !== urg) {
      const sourceIds = sortTasks(
        tasks.filter((t) => t.important === prevImportant && t.urgent === prevUrgent && t.id !== id)
      ).map((t) => t.id);
      sourceIds.forEach((taskId, i) => {
        tasks.find((x) => x.id === taskId).position = i;
      });
    }

    save(tasks);
  },

  clearAll() {
    localStorage.removeItem(STORAGE_KEY);
  },
};
