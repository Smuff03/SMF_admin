import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase.js';

/**
 * Product images are sent to the `adminImage` Cloud Function, which stores them in Firebase Storage with the Admin SDK
 * and returns { url, path }. (Uploading straight from the browser failed with a 401 from Storage, so it goes through the
 * function, which is already admin-only.) The product document only stores [{ url, path }].
 */
export const MAX_IMAGES = 6;
export const MAX_PICK_BYTES = 10 * 1024 * 1024; // what we accept from the file picker; we shrink before upload
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // enforced again by the function
const MAX_SIDE = 1600;

export function checkImage(file) {
  if (!file.type.startsWith('image/')) return `${file.name} is not an image.`;
  if (file.size > MAX_PICK_BYTES) return `${file.name} is larger than 10 MB.`;
  return '';
}

/** Downscale to <= 1600px and re-encode as JPEG (also applies EXIF rotation). Falls back to the original if it already fits. */
async function prepare(file) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, w, h);
    c.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
    if (blob && blob.size <= MAX_UPLOAD_BYTES) return blob;
  } catch { /* unsupported format: try the original below */ }
  if (file.size <= MAX_UPLOAD_BYTES) return file;
  throw new Error(`${file.name} could not be processed. Try a smaller JPG or PNG.`);
}

const toBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(r.error || new Error('Could not read the image'));
  r.readAsDataURL(blob);
});

const friendly = (e) => {
  if (e?.code === 'functions/internal' && e.message === 'internal') return 'Could not reach the adminImage Cloud Function. Deploy it with "npm run deploy:functions" and try again.';
  if (e?.code === 'functions/not-found') return 'The adminImage Cloud Function is not deployed yet. Run "npm run deploy:functions".';
  if (e?.code === 'functions/unauthenticated') return 'Your session has expired. Please sign in again.';
  return e?.message || 'Image upload failed';
};

const call = () => httpsCallable(functions, 'adminImage');

export async function uploadProductImage(file) {
  try {
    const blob = await prepare(file);
    const { data } = await call()({ action: 'upload', contentType: blob.type || 'image/jpeg', data: await toBase64(blob) });
    return { url: data.url, path: data.path };
  } catch (e) {
    throw new Error(friendly(e));
  }
}

/** Best-effort cleanup: a failed delete must never block the user. */
export async function deleteImages(list = []) {
  const paths = list.map((i) => i?.path).filter(Boolean);
  if (!paths.length) return;
  try { await call()({ action: 'delete', paths }); } catch { /* ignore */ }
}
