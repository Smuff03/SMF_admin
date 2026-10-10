import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase.js';

/**
 * All writes go through the `adminMutate` Cloud Function, which re-checks the admin claim and applies
 * the business rules (stock, sequential ids, audit log) atomically. Reads are live in context.jsx.
 */
const friendly = (e) => {
  if (e?.code === 'functions/unavailable') return 'Cannot reach Firebase. Check your internet connection and try again.';
  if (e?.code === 'functions/not-found' && e.message === 'NOT_FOUND') return 'The adminMutate Cloud Function is not deployed yet. See the README.';
  // A CORS error / network failure on a callable surfaces as functions/internal with the bare message "internal".
  // The usual cause is that the function is not deployed (or crashed on start-up), so the browser gets no CORS headers.
  if (e?.code === 'functions/internal' && e.message === 'internal') return 'Could not reach the adminMutate Cloud Function. It is most likely not deployed yet: run "npm run deploy:functions" (needs the Blaze plan) and check the logs with "firebase functions:log".';
  if (e?.code === 'functions/unauthenticated') return 'Your session has expired. Please sign in again.';
  return e?.message || 'Something went wrong';
};

async function send(payload) {
  try {
    return (await httpsCallable(functions, 'adminMutate')(payload)).data;
  } catch (e) {
    throw new Error(friendly(e));
  }
}

export const api = {
  create: (resource, data) => send({ resource, action: 'create', data }),
  update: (resource, id, data) => send({ resource, action: 'update', id, data }),
  remove: (resource, id) => send({ resource, action: 'delete', id }),
};
