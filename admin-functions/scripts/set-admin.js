#!/usr/bin/env node
/**
 * Grant or revoke the admin custom claim:  node scripts/set-admin.js user@example.com [--remove]
 *
 * Authenticates with your own Google credentials (never commit a key file):
 *   gcloud auth application-default login     (or set GOOGLE_APPLICATION_CREDENTIALS locally)
 * Against the Auth emulator, set FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 instead.
 * Existing claims (e.g. the storefront's `wholesaler`) are preserved, except `role`.
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const [email, flag] = process.argv.slice(2);
if (!email || !email.includes('@')) {
  console.error('Usage: node scripts/set-admin.js <email> [--remove]');
  process.exit(1);
}
initializeApp({ projectId: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'smfoods-8eb21' });

try {
  const auth = getAuth();
  const user = await auth.getUserByEmail(email);
  const { role, ...rest } = user.customClaims || {};
  await auth.setCustomUserClaims(user.uid, flag === '--remove' ? rest : { ...rest, role: 'admin' });
  console.log(`${flag === '--remove' ? 'Removed admin role from' : 'Granted admin role to'} ${email} (${user.uid}). They must sign out and back in.`);
} catch (e) {
  console.error('Failed:', e.message);
  process.exit(1);
}
