import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const BATCH = 400;
// The admin panel keeps its data apart from the storefront's orders/products collections.
const NAMES = { orders: 'adminOrders', products: 'adminProducts' };
const real = (n) => NAMES[n] || n;

/** Firestore implementation of the storage contract in db.js (uses the Firebase Admin SDK). */
export function firestoreDriver(seedData) {
  let db;

  const ready = (async () => {
    const { initializeApp, getApps, cert, applicationDefault } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH && path.resolve(root, process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
    if (!keyPath && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      throw new Error('Set FIREBASE_SERVICE_ACCOUNT_PATH in .env to your service account JSON file');
    }
    if (keyPath && !fs.existsSync(keyPath)) throw new Error(`Service account file not found: ${keyPath}`);
    if (!getApps().length) {
      initializeApp({
        credential: keyPath ? cert(JSON.parse(fs.readFileSync(keyPath, 'utf8'))) : applicationDefault(),
        projectId: process.env.VITE_FIREBASE_PROJECT_ID,
      });
    }
    db = getFirestore();
    db.settings({ ignoreUndefinedProperties: true });

    if ((await db.collection(real('products')).limit(1).get()).empty) {
      console.log('Firestore is empty, importing seed data…');
      const { meta, ...collections } = seedData;
      await db.doc('meta/main').set(meta);
      for (const [name, rows] of Object.entries(collections)) {
        for (let i = 0; i < rows.length; i += BATCH) {
          const batch = db.batch();
          rows.slice(i, i + BATCH).forEach((r, j) => batch.set(db.collection(real(name)).doc(r.id), { ...r, _seq: Date.now() - (i + j) }));
          await batch.commit();
        }
      }
    }
    console.log('Connected to Firestore project', process.env.VITE_FIREBASE_PROJECT_ID);
  })();
  ready.catch((e) => console.error('Firestore init failed:', e.message));

  const out = (snap) => {
    if (!snap.exists) return null;
    const { _seq, ...data } = snap.data();
    return { ...data, id: snap.id };
  };
  const col = async (n) => { await ready; return db.collection(real(n)); };

  return {
    async list(n) {
      return (await (await col(n)).orderBy('_seq', 'desc').get()).docs.map(out);
    },
    async get(n, id) {
      return out(await (await col(n)).doc(id).get());
    },
    async create(n, doc) {
      const c = await col(n);
      const ref = doc.id ? c.doc(doc.id) : c.doc();
      await ref.set({ ...doc, id: ref.id, _seq: Date.now() });
      return out(await ref.get());
    },
    async update(n, id, patch) {
      const ref = (await col(n)).doc(id);
      if (!(await ref.get()).exists) return null;
      await ref.set(patch, { merge: true });
      return out(await ref.get());
    },
    async remove(n, id) {
      const ref = (await col(n)).doc(id);
      if (!(await ref.get()).exists) return false;
      await ref.delete();
      return true;
    },
    async getMeta() { await ready; return (await db.doc('meta/main').get()).data(); },
    async setMeta(meta) { await ready; await db.doc('meta/main').set(meta); },
  };
}