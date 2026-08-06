import { Platform } from 'react-native';
import { doc, onSnapshot } from '@react-native-firebase/firestore';
import VersionCheck from 'react-native-version-check';
import { db } from './firebase';
import { STORE_URL } from '../config/constants';

/**
 * Version config you control, stored at Firestore `config/app`:
 *   { forceUpdate?: boolean, minVersion?: string, latestVersion?: string,
 *     updateUrl?: string, updateUrlIos?: string, updateUrlAndroid?: string,
 *     message?: string }
 * `forceUpdate` là công tắc tổng: chỉ khi bằng `true` thì ForceUpdateGate mới
 * chặn app. Bumping `minVersion` above the installed version forces an update —
 * this is the reliable path for internally-distributed builds not on a store.
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
 * Đường dẫn cho nút "Cập nhật ngay", đúng nền tảng đang chạy. Thứ tự ưu tiên:
 *   1. `config.updateUrlIos` / `config.updateUrlAndroid` — ghi đè riêng từng
 *      nền tảng từ Firestore (đổi được mà không cần phát hành bản mới).
 *   2. `config.updateUrl` — ghi đè chung (vd. link tải APK nội bộ).
 *   3. Link store gắn sẵn trong app (App Store cho iOS, Play Store cho Android).
 *   4. Link store do react-native-version-check dò được.
 */
export function resolveUpdateUrl(config, store) {
  const perPlatform = Platform.select({
    ios: config?.updateUrlIos,
    android: config?.updateUrlAndroid,
  });
  return perPlatform || config?.updateUrl || STORE_URL || store?.storeUrl;
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
