import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
} from '@react-native-firebase/firestore';
import { db } from './firebase';
import { dateParts, toDateKey } from '../utils/date';
import { displayNameOf, listApprovedStaff } from './userService';
/**
 * Firestore path for a day's registrations:
 *   history/{year}/months/{month}/days/{day}/entries/{uid}
 *
 * The năm → tháng → ngày → user nesting is preserved, but the collection names
 * (history / months / days / entries) are FIXED literals — only the ids (year,
 * month, day, uid) are dynamic. This is required so a Cloud Functions Firestore
 * trigger can match the path (triggers only allow wildcards on document ids,
 * not on collection names).
 */
function entriesColRef(d) {
  const { year, month, day } = dateParts(d);
  return collection(
    db,
    'history',
    year,
    'months',
    month,
    'days',
    day,
    'entries',
  );
}
function entryDocRef(d, uid) {
  const { year, month, day } = dateParts(d);
  return doc(db, 'history', year, 'months', month, 'days', day, 'entries', uid);
}

/** Create or overwrite the signed-in user's plan for `date` (default today). */
export async function registerPlan(user, content, date = new Date()) {
  const now = Date.now();
  const existing = await getDoc(entryDocRef(date, user.uid));
  const entry = {
    uid: user.uid,
    displayName: displayNameOf(user),
    unit: user.unit,
    date: toDateKey(date),
    content: content.trim(),
    createdAt: existing.exists() ? existing.data().createdAt : now,
    updatedAt: now,
  };
  await setDoc(entryDocRef(date, user.uid), entry);
}

/** The signed-in user's entry for a given day, or null. */
export async function getMyEntry(uid, date = new Date()) {
  const snap = await getDoc(entryDocRef(date, uid));
  return snap.exists() ? snap.data() : null;
}

/** Live entries for a whole day (used by the boss table + boss alert). */
export function subscribeDailyEntries(date, onChange, onError) {
  return onSnapshot(
    entriesColRef(date),
    snap => onChange(snap.docs.map(d => d.data())),
    err => onError?.(err),
  );
}

/**
 * Boss daily table: every approved staff member joined with whether they
 * registered on `date`. Rows with registered=false are shown in red.
 */
export async function getDailyStatus(date = new Date()) {
  const [staff, entriesSnap] = await Promise.all([
    listApprovedStaff(),
    getDocs(entriesColRef(date)),
  ]);
  const byUid = new Map();
  entriesSnap.docs.forEach(d => {
    const e = d.data();
    byUid.set(e.uid, e);
  });
  const staffUids = new Set(staff.map(s => s.uid));
  const rows = staff.map(user => {
    const entry = byUid.get(user.uid) ?? null;
    return {
      user,
      entry,
      registered: entry != null,
    };
  });

  // Include entries whose owner is no longer an active staff member (deleted or
  // deactivated) so the history stays complete. Rebuild the row from the entry.
  byUid.forEach((entry, uid) => {
    if (staffUids.has(uid)) {
      return;
    }
    rows.push({
      user: {
        uid,
        email: '',
        displayName: entry.displayName,
        fullName: entry.displayName,
        photoURL: null,
        unit: entry.unit,
        role: 'staff',
        approved: true,
        active: false,
        createdAt: entry.createdAt,
        fcmToken: null,
      },
      entry,
      registered: true,
      formerUser: true,
    });
  });
  return rows.sort((a, b) =>
    a.user.displayName.localeCompare(b.user.displayName, 'vi'),
  );
}

/**
 * A single user's full registration history, newest first.
 * Requires a collectionGroup index on `entries` (see firestore.indexes.json).
 */
export async function getUserHistory(uid) {
  const q = query(
    collectionGroup(db, 'entries'),
    where('uid', '==', uid),
    orderBy('date', 'desc'),
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data());
}
