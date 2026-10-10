import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { randomUUID } from 'node:crypto';
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

// ---------------------------------------------------------------------------------------------
// Product images. The browser sends the (already shrunk) image to this callable and the function
// stores it with the Admin SDK. That keeps uploads independent of Storage security rules, App Check
// and client-side Storage tokens (a direct browser upload failed with 401 for exactly those reasons).
// Authorisation is the same admin-claim check as adminMutate.
// ---------------------------------------------------------------------------------------------
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_PATH = /^products\/[\w.-]{1,120}$/;

export const adminImage = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in.');
  if (request.auth.token.role !== 'admin') throw new HttpsError('permission-denied', 'Admin access required.');

  const { action, contentType, data, paths } = request.data || {};

  try {
    const bucket = getStorage().bucket();

    if (action === 'upload') {
      const ext = IMAGE_TYPES[contentType];
      if (!ext) throw new HttpsError('invalid-argument', 'Only JPG, PNG or WebP images are allowed.');
      if (typeof data !== 'string' || !data) throw new HttpsError('invalid-argument', 'No image data received.');
      const buf = Buffer.from(data, 'base64');
      if (!buf.length) throw new HttpsError('invalid-argument', 'The image is empty.');
      if (buf.length > MAX_IMAGE_BYTES) throw new HttpsError('invalid-argument', 'The image is larger than 5 MB.');

      const path = `products/${randomUUID()}.${ext}`;
      const token = randomUUID();
      await bucket.file(path).save(buf, {
        contentType,
        resumable: false,
        metadata: { cacheControl: 'public,max-age=31536000', metadata: { firebaseStorageDownloadTokens: token } },
      });
      return { path, url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}` };
    }

    if (action === 'delete') {
      const list = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string' && IMAGE_PATH.test(p)).slice(0, 20);
      await Promise.allSettled(list.map((p) => bucket.file(p).delete({ ignoreNotFound: true })));
      return { deleted: list.length };
    }

    throw new HttpsError('invalid-argument', 'Unknown action');
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error('adminImage failed', e);
    if (e?.code === 404) throw new HttpsError('failed-precondition', 'The Storage bucket was not found. In the Firebase console open Build → Storage and click Get started.');
    throw new HttpsError('internal', 'Could not save the image. Check the function logs.');
  }
});
