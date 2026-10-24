import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(
    readFileSync('./backend/serviceAccountKey.json', 'utf8')
);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const ADMINS = [
    'DHPzCVDaJcaQey4UYLGFxX4GByF3',
    'SqSl3elWc5hsnaqqESfBo3UTu7x2',
];

for (const uid of ADMINS) {
    await admin.auth().setCustomUserClaims(uid, { role: 'admin' });
    const user = await admin.auth().getUser(uid);
    console.log(`✅ ${uid} → claims:`, user.customClaims);
}

console.log('\nDone. Both users must sign out and back in.');
process.exit(0);
