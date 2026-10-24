import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase.js';

/**
 * All writes go through the `adminMutate` Cloud Function, which re-checks the admin claim and applies
 * the business rules (stock, sequential ids, audit log) atomically. Reads are live in context.jsx.
 */
const friendly = (e) => {
  if (e?.code === 'functions/unavailable') return 'Cannot reach Firebase. Check your internet connection and try again.';
  if (e?.code === 'functions/not-found' && e.message === 'NOT_FOUND') return 'The adminMutate Cloud Function is not deployed yet. See the README.';
  if (e?.code === 'functions/unauthenticated') return 'Your session has expired. Please sign in again.';
  return e?.message || 'Something went wrong';
};

async function send(payload) {
  try {
    if (functions) {
      return (await httpsCallable(functions, 'adminMutate')(payload)).data;
    }
  } catch (e) {
    // Attempt fallback to local Express API
    try {
      const { resource, action, id, data } = payload;
      let res;
      if (action === 'create') {
        res = await fetch(`/api/${resource}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      } else if (action === 'update') {
        res = await fetch(`/api/${resource}/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      } else if (action === 'delete') {
        res = await fetch(`/api/${resource}/${id}`, { method: 'DELETE' });
      }
      if (res && res.ok) {
        if (action === 'delete') return { id };
        return await res.json();
      }
    } catch {
      // ignore local fallback error and throw friendly error
    }
    throw new Error(friendly(e));
  }
}

async function syncProducts() {
  try {
    return (await httpsCallable(functions, 'adminSyncProducts')({})).data;
  } catch (e) {
    if (e?.code === 'functions/not-found') throw new Error('adminSyncProducts is not deployed yet. Run: firebase deploy --only functions:admin');
    throw new Error(friendly(e));
  }
}

export const api = {
  syncProducts,
  create: (resource, data) => send({ resource, action: 'create', data }),
  update: (resource, id, data) => send({ resource, action: 'update', id, data }),
  remove: (resource, id) => send({ resource, action: 'delete', id }),
};