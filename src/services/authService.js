import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { appleAuth } from '@invertase/react-native-apple-authentication';
import {
  AppleAuthProvider,
  GoogleAuthProvider,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
} from '@react-native-firebase/auth';
import { WEB_CLIENT_ID } from '../config/constants';
import { auth } from './firebase';
import { ensureUserProfile, updateFullName } from './userService';
let configured = false;

/** Must run once before any sign-in attempt. */
export function configureGoogleSignin() {
  if (configured) {
    return;
  }
  GoogleSignin.configure({
    webClientId: WEB_CLIENT_ID,
    offlineAccess: false,
  });
  configured = true;
}

/**
 * Runs the native Google account picker, then exchanges the Google id token for
 * a Firebase credential. The Firebase auth listener (see AuthContext) reacts to
 * the resulting sign-in.
 */
export async function signInWithGoogle() {
  configureGoogleSignin();
  await GoogleSignin.hasPlayServices({
    showPlayServicesUpdateDialog: true,
  });
  const result = await GoogleSignin.signIn();
  // google-signin v13+ nests the payload under `data`; older versions are flat.
  let idToken = result?.data?.idToken ?? result?.idToken;

  // Fetch fresh tokens. Some Firebase Android builds reject a Google credential
  // that has no access token ("accessToken cannot be empty"), so we pass BOTH
  // the id token and the access token. getTokens() also gives a reliable
  // idToken if the signIn() payload shape differs across versions.
  const tokens = await GoogleSignin.getTokens();
  idToken = idToken ?? tokens?.idToken;
  const accessToken = tokens?.accessToken;
  if (!idToken && !accessToken) {
    throw new Error('Không lấy được token từ Google.');
  }
  const credential = GoogleAuthProvider.credential(
    idToken ?? null,
    accessToken,
  );
  await signInWithCredential(auth, credential);
}

/**
 * Runs the native Sign in with Apple flow, then exchanges the Apple identity
 * token for a Firebase credential. iOS 13+ only.
 *
 * Per App Store Guideline 4 (Sign in with Apple), we must USE the name/email
 * the Authentication Services framework provides and must NOT require the user
 * to type them again. So we request both scopes and, on the first
 * authorization (the only time Apple returns the name), capture it and store it
 * on the profile. The profile screen then shows it pre-filled and never forces
 * the user to enter their name.
 */
export async function signInWithApple() {
  const response = await appleAuth.performRequest({
    requestedOperation: appleAuth.Operation.LOGIN,
    requestedScopes: [appleAuth.Scope.FULL_NAME, appleAuth.Scope.EMAIL],
  });
  const { identityToken, nonce, fullName, email } = response;
  if (!identityToken) {
    throw new Error('Không lấy được token từ Apple.');
  }
  // invertase returns the raw nonce; AppleAuthProvider expects it as-is.
  const credential = AppleAuthProvider.credential(identityToken, nonce);
  const { user } = await signInWithCredential(auth, credential);

  // Apple returns the name only on the VERY FIRST authorization. Capture and
  // persist it (Firebase does not do this for Apple credentials) so the user is
  // never asked to type it.
  const name = [fullName?.givenName, fullName?.familyName]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (name) {
    if (!user.displayName) {
      await user.updateProfile({ displayName: name }).catch(() => {});
    }
    await ensureUserProfile({
      uid: user.uid,
      email: user.email ?? email ?? '',
      displayName: name,
      photoURL: user.photoURL,
    }).catch(() => {});
    await updateFullName(user.uid, name).catch(() => {});
  }
}

/**
 * Email + password sign-in. Used by the demo / dev account provided to App
 * Review (Google & Apple OAuth cannot be exercised by the reviewer). The
 * Firebase auth listener (see AuthContext) reacts to the resulting sign-in.
 */
export async function signInWithEmail(email, password) {
  const cleanEmail = (email ?? '').trim();
  if (!cleanEmail || !password) {
    throw new Error('Vui lòng nhập tài khoản và mật khẩu.');
  }
  await signInWithEmailAndPassword(auth, cleanEmail, password);
}

/** Signs out of both Firebase and Google so the next launch shows the picker. */
export async function signOut() {
  try {
    await GoogleSignin.signOut();
  } catch {
    // ignore — Google session may already be gone
  }
  await fbSignOut(auth);
}
export { statusCodes };
