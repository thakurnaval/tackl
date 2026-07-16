const path = require('path');
const express = require('express');
const admin = require('firebase-admin');
const db = require('./db');

db.init();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'renderer')));

async function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// Wraps an async route handler so a rejected promise reaches Express's error
// handling instead of crashing the request (Cloud Run reports the latter as a
// malformed response / 503, not a JSON error).
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const api = express.Router();
api.use(requireAuth);

api.get('/tasks', wrap(async (req, res) => {
  res.json(await db.getAllTasks(req.uid));
}));

api.post('/tasks', wrap(async (req, res) => {
  const { text, important, urgent } = req.body;
  const id = await db.addTask(req.uid, text, important, urgent);
  res.json({ id });
}));

api.patch('/tasks/:id/text', wrap(async (req, res) => {
  await db.updateTaskText(req.uid, req.params.id, req.body.text);
  res.sendStatus(204);
}));

api.patch('/tasks/:id/completed', wrap(async (req, res) => {
  await db.setCompleted(req.uid, req.params.id, req.body.completed);
  res.sendStatus(204);
}));

api.patch('/tasks/:id/move', wrap(async (req, res) => {
  const { important, urgent, newIndex } = req.body;
  await db.moveTask(req.uid, req.params.id, important, urgent, newIndex);
  res.sendStatus(204);
}));

api.delete('/tasks/:id', wrap(async (req, res) => {
  await db.deleteTask(req.uid, req.params.id);
  res.sendStatus(204);
}));

// Deletes all of the caller's task data, then their Firebase Auth account itself.
api.delete('/account', wrap(async (req, res) => {
  await db.deleteAllTasks(req.uid);
  await admin.auth().deleteUser(req.uid);
  res.sendStatus(204);
}));

app.use('/api', api);

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Tackl listening on port ${port}`);
});
