const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const admin = require('firebase-admin');
const db = require('./db');

db.init();

// Reports uncaught errors to GCP Error Reporting in production. Locally (no
// NODE_ENV=production) this client is a no-op, so it's safe to leave wired up
// unconditionally rather than branching on environment.
const { ErrorReporting } = require('@google-cloud/error-reporting');
const errors = new ErrorReporting({ reportMode: 'production' });

const app = express();

// Cloud Run sits behind Google's load balancer; trust its X-Forwarded-For so
// rate limiting (and anything else keyed on req.ip) sees the real client IP.
app.set('trust proxy', 1);

app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'renderer')));

app.use(
  '/api',
  rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests — please slow down.' },
  })
);

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

const MAX_TASK_TEXT_LENGTH = 500;

function validTaskText(text) {
  return typeof text === 'string' && text.trim().length > 0 && text.length <= MAX_TASK_TEXT_LENGTH;
}

const api = express.Router();
api.use(requireAuth);

api.get('/tasks', wrap(async (req, res) => {
  res.json(await db.getAllTasks(req.uid));
}));

api.post('/tasks', wrap(async (req, res) => {
  const { text, important, urgent } = req.body;
  if (!validTaskText(text)) {
    res.status(400).json({ error: `text must be 1-${MAX_TASK_TEXT_LENGTH} characters` });
    return;
  }
  const id = await db.addTask(req.uid, text, important, urgent);
  res.json({ id });
}));

api.patch('/tasks/:id/text', wrap(async (req, res) => {
  if (!validTaskText(req.body.text)) {
    res.status(400).json({ error: `text must be 1-${MAX_TASK_TEXT_LENGTH} characters` });
    return;
  }
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

// Persists the small result of a Google integration action (delegate/schedule/backup)
// onto a task. Field whitelist is enforced in db.updateTaskMeta.
api.patch('/tasks/:id/meta', wrap(async (req, res) => {
  await db.updateTaskMeta(req.uid, req.params.id, req.body);
  res.sendStatus(204);
}));

// Deletes all of the caller's task data, then their Firebase Auth account itself.
api.delete('/account', wrap(async (req, res) => {
  await db.deleteAllTasks(req.uid);
  await admin.auth().deleteUser(req.uid);
  res.sendStatus(204);
}));

app.use('/api', api);

app.use((err, req, res, next) => {
  console.error(err);
  errors.report(err);
  next(err);
});

app.use((err, req, res, _next) => {
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Tackl listening on port ${port}`);
});
