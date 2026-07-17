import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from '@react-native-firebase/firestore';
import { db } from './firebase';
const usersCol = () => collection(db, 'users');
const userDoc = uid => doc(db, 'users', uid);

/**
 * Ensures a Firestore profile exists for a freshly authenticated Google user.
 * New profiles default to role 'staff', approved=false, active=true — a boss
 * must approve them. Existing profiles are returned untouched (so we never
 * overwrite an approval, a role, or an active flag set elsewhere).
 */
export async function ensureUserProfile(params) {
  const ref = userDoc(params.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return snap.data();
  }
  const profile = {
    uid: params.uid,
    email: params.email,
    displayName: params.displayName || params.email,
    fullName: '',
    position: '',
    photoURL: params.photoURL ?? null,
    unit: '',
    role: 'staff',
    approved: false,
    active: true,
    createdAt: Date.now(),
    fcmToken: null,
  };
  await setDoc(ref, profile);
  return profile;
}

/** Live updates for the signed-in user's own profile (approval/role/active). */
export function subscribeToProfile(uid, onChange, onError) {
  return onSnapshot(
    userDoc(uid),
    snap => onChange(snap.exists() ? snap.data() : null),
    err => onError?.(err),
  );
}
export async function updateUnit(uid, unit) {
  await updateDoc(userDoc(uid), {
    unit,
  });
}
export async function updateFullName(uid, fullName) {
  await updateDoc(userDoc(uid), {
    fullName,
  });
}
export async function updatePosition(uid, position) {
  await updateDoc(userDoc(uid), {
    position,
  });
}

/** Update the user-editable profile fields (họ tên, chức vụ, đơn vị) at once. */
export async function updateProfileInfo(uid, { fullName, position, unit }) {
  await updateDoc(userDoc(uid), {
    fullName,
    position,
    unit,
  });
}

/** Preferred display name: the manually-entered full name, else Google name. */
export function displayNameOf(u) {
  return u.fullName && u.fullName.trim() ? u.fullName.trim() : u.displayName;
}
export async function updateFcmToken(uid, token) {
  await updateDoc(userDoc(uid), {
    fcmToken: token,
  });
}

/** Approved AND active staff — the boss daily table + reminder audience. */
export async function listApprovedStaff() {
  const q = query(
    usersCol(),
    where('role', '==', 'staff'),
    where('approved', '==', true),
    where('active', '==', true),
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data());
}

/**
 * Live list of every staff account (any state). The boss management screen
 * splits it into pending / active / inactive.
 */
export function subscribeToStaff(onChange, onError) {
  const q = query(usersCol(), where('role', '==', 'staff'));
  return onSnapshot(
    q,
    snap => onChange(snap.docs.map(d => d.data())),
    err => onError?.(err),
  );
}

/** Boss actions on a user account. */
export async function approveUser(uid) {
  await updateDoc(userDoc(uid), {
    approved: true,
    active: true,
  });
}

/** Deactivate (soft): keep history, but lock out and hide from the table. */
export async function deactivateUser(uid) {
  await updateDoc(userDoc(uid), {
    active: false,
  });
}
export async function reactivateUser(uid) {
  await updateDoc(userDoc(uid), {
    active: true,
  });
}

/**
 * Delete (hard): removes the user profile document. Access is revoked
 * immediately (security rules key off this doc). Their past plan entries are
 * left intact for the record. Note: this does NOT delete the Firebase Auth
 * account — see functions/deleteUserAccount for that (admin-only).
 */
export async function deleteUser(uid) {
  await deleteDoc(userDoc(uid));
}

/**
 * Self-service delete: a user removes their own profile document. Access is
 * revoked immediately (security rules key off this doc), and the app drops them
 * back to the login screen once the doc is gone. Past plan entries are kept for
 * the record. The Firebase Auth account is left intact (a boss can fully purge
 * it via functions/deleteUserAccount).
 */
export async function deleteOwnAccount(uid) {
  await deleteDoc(userDoc(uid));
}
