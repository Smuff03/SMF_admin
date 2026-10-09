import { initializeApp } from 'firebase/app';
import { getAnalytics, isSupported } from 'firebase/analytics';

const e = import.meta.env;
const config = {
  apiKey: e.VITE_FIREBASE_API_KEY,
  authDomain: e.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: e.VITE_FIREBASE_PROJECT_ID,
  storageBucket: e.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: e.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: e.VITE_FIREBASE_APP_ID,
  measurementId: e.VITE_FIREBASE_MEASUREMENT_ID,
};

export const firebaseConfigured = Boolean(config.apiKey && config.projectId && config.appId);
export const firebaseProject = config.projectId || '';
export const firebaseApp = firebaseConfigured ? initializeApp(config) : null;

if (firebaseApp && config.measurementId) {
  isSupported().then((ok) => ok && getAnalytics(firebaseApp)).catch(() => {});
}
