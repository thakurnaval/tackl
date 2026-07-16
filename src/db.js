const admin = require('firebase-admin');

let firestore;

function init() {
  if (!admin.apps.length) admin.initializeApp();
  firestore = admin.firestore();
  return firestore;
}

function tasksRef(uid) {
  return firestore.collection('users').doc(uid).collection('tasks');
}

// Quadrant is derived from (important, urgent). Position orders tasks within a quadrant.

async function getAllTasks(uid) {
  const snap = await tasksRef(uid)
    .orderBy('important', 'desc')
    .orderBy('urgent', 'desc')
    .orderBy('completed', 'asc')
    .orderBy('position', 'asc')
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function addTask(uid, text, important, urgent) {
  const imp = important ? 1 : 0;
  const urg = urgent ? 1 : 0;
  const ref = tasksRef(uid);

  return firestore.runTransaction(async (tx) => {
    const quadrantSnap = await tx.get(
      ref.where('important', '==', imp).where('urgent', '==', urg)
    );
    const maxPos = quadrantSnap.docs.reduce(
      (max, doc) => Math.max(max, doc.data().position),
      -1
    );

    const newDoc = ref.doc();
    tx.set(newDoc, {
      text: text.trim(),
      important: imp,
      urgent: urg,
      position: maxPos + 1,
      completed: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return newDoc.id;
  });
}

async function updateTaskText(uid, id, text) {
  await tasksRef(uid).doc(id).update({ text: text.trim() });
}

async function setCompleted(uid, id, completed) {
  const nextCompleted = completed ? 1 : 0;
  const ref = tasksRef(uid);

  await firestore.runTransaction(async (tx) => {
    const taskDoc = await tx.get(ref.doc(id));
    if (!taskDoc.exists) return;
    const task = taskDoc.data();

    // Move to the end of the current quadrant order whenever completion changes.
    // This keeps newly completed items at the bottom of the visible list.
    const quadrantSnap = await tx.get(
      ref.where('important', '==', task.important).where('urgent', '==', task.urgent)
    );
    const maxPos = quadrantSnap.docs.reduce(
      (max, doc) => (doc.id === id ? max : Math.max(max, doc.data().position)),
      -1
    );

    tx.update(ref.doc(id), { completed: nextCompleted, position: maxPos + 1 });
  });
}

async function deleteTask(uid, id) {
  await tasksRef(uid).doc(id).delete();
}

// Deletes every task doc for a user — used when the account itself is deleted.
// Firestore batches are capped at 500 writes, so chunk in case of a very large list.
async function deleteAllTasks(uid) {
  const snap = await tasksRef(uid).get();
  const chunkSize = 500;
  for (let i = 0; i < snap.docs.length; i += chunkSize) {
    const batch = firestore.batch();
    snap.docs.slice(i, i + chunkSize).forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

// Move a task to a quadrant at a specific index; re-sequences both quadrants.
async function moveTask(uid, id, important, urgent, newIndex) {
  const imp = important ? 1 : 0;
  const urg = urgent ? 1 : 0;
  const ref = tasksRef(uid);

  await firestore.runTransaction(async (tx) => {
    const taskDoc = await tx.get(ref.doc(id));
    if (!taskDoc.exists) return;
    const task = taskDoc.data();

    // Ordered ids in the target quadrant, excluding the moving task
    const targetSnap = await tx.get(
      ref.where('important', '==', imp).where('urgent', '==', urg)
    );
    const targetIds = targetSnap.docs
      .filter((doc) => doc.id !== id)
      .sort((a, b) => {
        const da = a.data();
        const db_ = b.data();
        return (
          da.completed - db_.completed ||
          da.position - db_.position ||
          (a.id < b.id ? -1 : 1)
        );
      })
      .map((doc) => doc.id);

    const idx = Math.max(0, Math.min(newIndex, targetIds.length));
    targetIds.splice(idx, 0, id);

    targetIds.forEach((taskId, i) => {
      tx.update(ref.doc(taskId), { important: imp, urgent: urg, position: i });
    });

    // Re-sequence the source quadrant if the task changed quadrants
    if (task.important !== imp || task.urgent !== urg) {
      const sourceSnap = await tx.get(
        ref.where('important', '==', task.important).where('urgent', '==', task.urgent)
      );
      const sourceIds = sourceSnap.docs
        .filter((doc) => doc.id !== id)
        .sort((a, b) => {
          const da = a.data();
          const db_ = b.data();
          return (
            da.completed - db_.completed ||
            da.position - db_.position ||
            (a.id < b.id ? -1 : 1)
          );
        })
        .map((doc) => doc.id);
      sourceIds.forEach((taskId, i) => {
        tx.update(ref.doc(taskId), { position: i });
      });
    }
  });
}

module.exports = {
  init,
  getAllTasks,
  addTask,
  updateTaskText,
  setCompleted,
  deleteTask,
  deleteAllTasks,
  moveTask,
};
