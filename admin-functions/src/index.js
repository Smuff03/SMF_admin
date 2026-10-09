import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { COLLECTIONS } from './collections.js';
import { Fail, perform } from './logic.js';

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
      const tx = {
        get: async (r, docId) => { const s = await t.get(ref(r, docId)); return s.exists ? s.data() : null; },
        set: (r, docId, doc) => writes.push(() => t.set(ref(r, docId), doc)),
        update: (r, docId, patch) => writes.push(() => t.set(ref(r, docId), patch, { merge: true })),
        delete: (r, docId) => writes.push(() => t.delete(ref(r, docId))),
        newId: (r) => db.collection(COLLECTIONS[r]).doc().id,
      };
      const result = await perform({ tx, actor, now: new Date().toISOString() }, { resource, action, id, data });
      writes.forEach((w) => w());
      return result;
    });
  } catch (e) {
    if (e instanceof Fail) throw new HttpsError(e.code, e.message);
    logger.error('adminMutate failed', e);
    throw new HttpsError('internal', 'Something went wrong. Please try again.');
  }
});
