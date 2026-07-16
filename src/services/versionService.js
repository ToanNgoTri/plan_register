import { doc, onSnapshot } from '@react-native-firebase/firestore';
import VersionCheck from 'react-native-version-check';
import { db } from './firebase';

/**
 * Version config you control, stored at Firestore `config/app`:
 *   { minVersion?: string, latestVersion?: string, updateUrl?: string,
 *     message?: string }
 * Bumping `minVersion` above the installed version forces an update — this is
 * the reliable path for internally-distributed builds that are not on a store.
 */

export function getCurrentAppVersion() {
  return VersionCheck.getCurrentVersion();
}

/**
 * Compare dotted version strings numerically.
 * Returns 1 if a > b, -1 if a < b, 0 if equal. e.g. ("1.2.0","1.10.0") => -1.
 */
export function compareVersions(a, b) {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) {
      return 1;
    }
    if (x < y) {
      return -1;
    }
  }
  return 0;
}

/** Live updates of the server-controlled version config. */
export function subscribeToVersionConfig(onChange, onError) {
  return onSnapshot(
    doc(db, 'config', 'app'),
    snap => onChange(snap.exists() ? snap.data() : null),
    err => onError?.(err),
  );
}

/**
 * Store-based check (Play Store / App Store), same library as the lawMachine
 * app. Any error (app not published, no network, lookup failed) is treated as
 * "no update needed" so we never block by mistake.
 */
export async function checkForUpdate() {
  const currentVersion = getCurrentAppVersion();
  try {
    const res = await VersionCheck.needUpdate();
    return {
      isNeeded: !!res?.isNeeded,
      currentVersion,
      latestVersion: res?.latestVersion,
      storeUrl: res?.storeUrl,
    };
  } catch {
    return {
      isNeeded: false,
      currentVersion,
    };
  }
}
