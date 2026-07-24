import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from '@react-native-firebase/firestore';
import { db } from './firebase';
import { BOSS_POSITION } from '../config/constants';
const usersCol = () => collection(db, 'users');

/**
 * The role implied by a chức vụ: "Trưởng CA" ⇒ boss, anything else ⇒ staff.
 * A `dev` (review/demo) account keeps its role regardless of position.
 */
export function roleForPosition(position, currentRole) {
  if (currentRole === 'dev') {
    return 'dev';
  }
  return position === BOSS_POSITION ? 'boss' : 'staff';
}
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

/**
 * Live boolean: does a "Trưởng CA" already exist? Used to hide the Trưởng CA
 * chức vụ option once the unit already has a commander. Readable by any
 * signed-in user (see the users read rule).
 */
export function subscribeChiefExists(onChange, onError) {
  const q = query(usersCol(), where('position', '==', BOSS_POSITION), limit(1));
  return onSnapshot(
    q,
    snap => onChange(!snap.empty),
    err => onError?.(err),
  );
}

/** Live updates for the signed-in user's own profile (approval/role/active). */
export function subscribeToProfile(uid, onChange, onError) {
  return onSnapshot(
    userDoc(uid),
    // Always derive uid from the document id so downstream code (e.g. building
    // Firestore entry paths) never sees an undefined uid — even if a doc was
    // created by hand without the `uid` field.
    snap => onChange(snap.exists() ? { ...snap.data(), uid: snap.id } : null),
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

/**
 * Update the user-editable profile fields (họ tên, chức vụ, đơn vị) at once.
 * Changing the chức vụ also updates `role` accordingly (Trưởng CA ⇒ boss),
 * so permissions follow the position. Pass the current role so a `dev` account
 * is never demoted.
 */
export async function updateProfileInfo(uid, { fullName, position, unit, currentRole }) {
  const patch = {
    fullName,
    position,
    unit,
    role: roleForPosition(position, currentRole),
  };
  // Registering as "Trưởng CA" auto-approves the account (it becomes a boss).
  if (position === BOSS_POSITION) {
    patch.approved = true;
  }
  await updateDoc(userDoc(uid), patch);
}

/**
 * Manager action: change another user's chức vụ, updating the role (and, for
 * "Trưởng CA", the approval) it implies. Allowed by the manager branch of the
 * security rules.
 */
export async function setUserPosition(uid, position, currentRole) {
  const patch = {
    position,
    role: roleForPosition(position, currentRole),
  };
  if (position === BOSS_POSITION) {
    patch.approved = true;
  }
  await updateDoc(userDoc(uid), patch);
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
 * Live list of EVERY user account (staff, boss, and dev — any state). The
 * management screen splits it into pending / active / inactive. Allowed for a
 * manager (boss/dev), who may read all user docs per the security rules.
 */
export function subscribeToUsers(onChange, onError) {
  return onSnapshot(
    usersCol(),
    snap => onChange(snap.docs.map(d => ({ ...d.data(), uid: d.id }))),
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
