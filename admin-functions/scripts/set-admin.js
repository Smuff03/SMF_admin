#!/usr/bin/env node
/**
 * Grant or revoke the admin custom claim:  node scripts/set-admin.js user@example.com [--remove]
 *
 * Authenticates with your own Google credentials (never commit a key file):
 *   gcloud auth application-default login     (or set GOOGLE_APPLICATION_CREDENTIALS locally)
 * Against the Auth emulator, set FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 instead.
 * Existing claims (e.g. the storefront's `wholesaler`) are preserved, except `role`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(root, '.env') });

const email = process.argv[2];
const keyPath = path.resolve(root, process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './backend/serviceAccountKey.json');
if (!email) { console.error('Usage: npm --prefix backend run set-admin -- user@example.com'); process.exit(1); }
if (!fs.existsSync(keyPath)) { console.error(`Service account key not found: ${keyPath}`); process.exit(1); }

initializeApp({ credential: cert(JSON.parse(fs.readFileSync(keyPath, 'utf8'))) });
const auth = getAuth();
const user = await auth.getUserByEmail(email);
await auth.setCustomUserClaims(user.uid, { ...(user.customClaims || {}), role: 'admin' });
console.log(`${email} (${user.uid}) is now an admin. Sign out and back in to refresh the token.`);