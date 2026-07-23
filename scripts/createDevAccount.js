/**
 * One-off admin script: create (or refresh) the App Review demo account.
 *
 * It creates an Email/Password Firebase Auth user and a matching Firestore
 * profile with role `dev` — which in the app behaves like a staff member
 * (register plans) but ALSO gets the user-approval screen, and is never gated
 * by approval/active. This is what the App Review team signs in with.
 *
 * PREREQUISITES
 *   1. Firebase Console → Authentication → Sign-in method → enable
 *      "Email/Password".
 *   2. Admin credentials on this machine, either:
 *        gcloud auth application-default login
 *      or a service-account key file:
 *        export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
 *
 * RUN
 *   cd functions && npm install        # ensures firebase-admin is present
 *   node ../scripts/createDevAccount.js
 */
const path = require('path');
// Reuse the firebase-admin installed for Cloud Functions.
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const PROJECT_ID = 'planregister-f3f94';

// ---- Demo account details (must match App Store Connect review notes) ----
const EMAIL = 'xuanhoang20384@gmail.com';
const PASSWORD = 'Reymysterio109';
const PROFILE = {
  fullName: 'Tài khoản Demo (App Review)',
  position: 'Cán bộ',
  unit: 'Công an phường Hàng Gòn',
  role: 'dev',
  approved: true,
  active: true,
};

async function main() {
  admin.initializeApp({
    projectId: PROJECT_ID,
    credential: admin.credential.applicationDefault(),
  });
  const auth = admin.auth();
  const db = admin.firestore();

  // 1. Create or update the Auth user.
  let user;
  try {
    user = await auth.getUserByEmail(EMAIL);
    await auth.updateUser(user.uid, {
      password: PASSWORD,
      displayName: PROFILE.fullName,
      emailVerified: true,
    });
    console.log(`Updated existing auth user: ${user.uid}`);
  } catch (e) {
    if (e.code === 'auth/user-not-found') {
      user = await auth.createUser({
        email: EMAIL,
        password: PASSWORD,
        displayName: PROFILE.fullName,
        emailVerified: true,
      });
      console.log(`Created auth user: ${user.uid}`);
    } else {
      throw e;
    }
  }

  // 2. Write the Firestore profile (merge so re-runs are safe).
  await db
    .collection('users')
    .doc(user.uid)
    .set(
      {
        uid: user.uid,
        email: EMAIL,
        displayName: PROFILE.fullName,
        fullName: PROFILE.fullName,
        position: PROFILE.position,
        unit: PROFILE.unit,
        photoURL: null,
        role: PROFILE.role,
        approved: PROFILE.approved,
        active: PROFILE.active,
        fcmToken: null,
      },
      { merge: true },
    );
  console.log(`Firestore profile ready for ${EMAIL} (role=${PROFILE.role}).`);
  console.log('\nDemo login → App Store Connect:');
  console.log(`  Username: ${EMAIL}`);
  console.log(`  Password: ${PASSWORD}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('FAILED:', err);
    process.exit(1);
  });
