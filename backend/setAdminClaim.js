// backend/setAdminClaim.js
import admin from 'firebase-admin';
import { createRequire } from 'module';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(
    readFileSync('./backend/serviceAccountKey.json', 'utf8')
);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const uid = 'DHPzCVDaJcaQey4UYLGFxX4GByF3';

const user = await admin.auth().getUser(uid);
console.log('Before:', user.customClaims);

await admin.auth().setCustomUserClaims(uid, { role: 'admin' });

const updated = await admin.auth().getUser(uid);
console.log('✅ Claims set:', updated.customClaims);
console.log('Sign out and back in to refresh your token.');

process.exit(0);