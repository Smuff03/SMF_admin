import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { COLLECTIONS } from './collections.js';
import { Fail, perform } from './logic.js';
import { storefrontDocs } from './storefront.js';

// Keep in sync with VITE_FUNCTIONS_REGION in the web app.
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

initializeApp();
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

const ref = (resource, id) => db.collection(COLLECTIONS[resource]).doc(id);

/**
 * Single callable for every admin write. Authorisation is enforced here from the verified ID
 * token (custom claim role == 'admin'); Firestore rules block all direct client writes.
 * Writes are queued and applied at the end so Firestore's "reads before writes" rule always holds.
 */
export const adminMutate = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in.');
  if (request.auth.token.role !== 'admin') throw new HttpsError('permission-denied', 'Admin access required.');

  const { resource, action, id, data } = request.data || {};
  const actor = request.auth.token.email || request.auth.uid;

  try {
    return await db.runTransaction(async (t) => {
      const writes = [];
      // Every change to an adminProducts doc (create, edit, stock moves, delete) is recorded here so the
      // storefront copy (`products` / `productPricing`) is rebuilt in the SAME transaction.
      const touched = new Map(); // productId -> [{ op: 'set'|'patch'|'delete', doc }]
      const track = (docId, entry) => touched.set(docId, [...(touched.get(docId) || []), entry]);
      const tx = {
        get: async (r, docId) => { const s = await t.get(ref(r, docId)); return s.exists ? s.data() : null; },
        set: (r, docId, doc) => { if (r === 'products') track(docId, { op: 'set', doc }); writes.push(() => t.set(ref(r, docId), doc)); },
        update: (r, docId, patch) => { if (r === 'products') track(docId, { op: 'patch', doc: patch }); writes.push(() => t.set(ref(r, docId), patch, { merge: true })); },
        delete: (r, docId) => { if (r === 'products') track(docId, { op: 'delete' }); writes.push(() => t.delete(ref(r, docId))); },
        newId: (r) => db.collection(COLLECTIONS[r]).doc().id,
      };
      const now = new Date().toISOString();
      const result = await perform({ tx, actor, now }, { resource, action, id, data });

      // Reads first (Firestore requires reads before writes), then queue the storefront writes.
      const mirrors = [];
      for (const [pid, entries] of touched) {
        const pricingRef = db.collection('productPricing').doc(pid);
        if (entries.some((e) => e.op === 'delete')) {
          mirrors.push({ pid, deleted: true });
          continue;
        }
        let state = entries[0].op === 'set' ? {} : (await t.get(ref('products', pid))).data() || {};
        for (const e of entries) state = e.op === 'set' ? { ...e.doc } : { ...state, ...e.doc };
        const existingPricing = (await t.get(pricingRef)).data();
        mirrors.push({ pid, ...storefrontDocs({ ...state, id: pid }, existingPricing, now) });
      }
      writes.forEach((w) => w());
      for (const m of mirrors) {
        const productRef = db.collection('products').doc(m.pid);
        const pricingRef = db.collection('productPricing').doc(m.pid);
        if (m.deleted) {
          // The storefront never hard-deletes (old orders reference products): hide it instead.
          t.set(productRef, { active: false, stockQty: 0, updatedAt: now }, { merge: true });
          t.delete(pricingRef);
        } else {
          t.set(productRef, m.product, { merge: true });
          if (m.pricing) t.set(pricingRef, m.pricing, { merge: true }); else t.delete(pricingRef);
        }
      }
      return result;
    });
  } catch (e) {
    if (e instanceof Fail) throw new HttpsError(e.code, e.message);
    logger.error('adminMutate failed', e);
    throw new HttpsError('internal', 'Something went wrong. Please try again.');
  }
});

/** Admin: copy every existing adminProducts doc to products / productPricing (one-off backfill). */
export const adminSyncProducts = onCall({ timeoutSeconds: 300 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in.');
  if (request.auth.token.role !== 'admin') throw new HttpsError('permission-denied', 'Admin access required.');
  try {
    const now = new Date().toISOString();
    const snap = await db.collection('adminProducts').get();
    const writer = db.bulkWriter();
    for (const d of snap.docs) {
      const existing = (await db.collection('productPricing').doc(d.id).get()).data();
      const { product, pricing } = storefrontDocs({ ...d.data(), id: d.id }, existing, now);
      writer.set(db.collection('products').doc(d.id), product, { merge: true });
      if (pricing) writer.set(db.collection('productPricing').doc(d.id), pricing, { merge: true });
      else writer.delete(db.collection('productPricing').doc(d.id));
    }
    await writer.close();
    return { synced: snap.size };
  } catch (e) {
    logger.error('adminSyncProducts failed', e);
    throw new HttpsError('internal', 'Something went wrong. Please try again.');
  }
});