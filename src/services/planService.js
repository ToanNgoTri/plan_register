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
import { displayNameOf, subscribeApprovedStaff } from './userService';
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

/**
 * The signed-in user's entry for `date`, live: pushes a new value whenever the
 * entry is created or edited (allowed by rule A — own entry, any day).
 */
export function subscribeMyEntry(uid, date, onChange, onError) {
  return onSnapshot(
    entryDocRef(date, uid),
    snap => onChange(snap.exists() ? snap.data() : null),
    err => onError?.(err),
  );
}

/** Live entries for a whole day (used by the boss table + boss alert). */
export function subscribeDailyEntries(date, onChange, onError) {
  return onSnapshot(
    entriesColRef(date),
    snap => onChange(snap.docs.map(d => d.data())),
    err => onError?.(err),
  );
}

/** Joins the approved-staff list with a day's entries into boss table rows. */
function buildDailyRows(staff, entries) {
  const byUid = new Map();
  entries.forEach(e => {
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
 * Boss daily table, live: every approved staff member joined with whether they
 * registered on `date` (rows with registered=false are shown in red).
 *
 * Watches BOTH sources that make up a row:
 *   - the day's entries (someone registers / edits their plan), and
 *   - the approved-staff list (someone is approved / deactivated / deleted),
 * and pushes recomputed rows on every change — no manual reload needed.
 *
 * `onChange` only fires once both sources have delivered a first snapshot, so
 * the table never flashes an "everyone missing" state.
 * Returns an unsubscribe function that tears down both listeners.
 */
export function subscribeDailyStatus(date, onChange, onError) {
  let staff = null;
  let entries = null;
  const emit = () => {
    if (staff && entries) {
      onChange(buildDailyRows(staff, entries));
    }
  };
  const fail = err => onError?.(err);
  const unsubStaff = subscribeApprovedStaff(list => {
    staff = list;
    emit();
  }, fail);
  const unsubEntries = onSnapshot(
    entriesColRef(date),
    snap => {
      entries = snap.docs.map(d => d.data());
      emit();
    },
    fail,
  );
  return () => {
    unsubStaff();
    unsubEntries();
  };
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
