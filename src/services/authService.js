import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import {
  GoogleAuthProvider,
  signInWithCredential,
  signOut as fbSignOut,
} from '@react-native-firebase/auth';
import { WEB_CLIENT_ID } from '../config/constants';
import { auth } from './firebase';
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
