/**
 * Firestore security-rules behavioural test.
 * Run via:  npx firebase emulators:exec --only firestore --project demo-planregister "node scripts/rules.test.mjs"
 *
 * Verifies the staff visibility model:
 *   - staff CAN read everyone's entries for TODAY (register/coordination view)
 *   - staff CANNOT read other users' entries for PAST days (history is private)
 *   - staff CAN read their own history (collectionGroup)
 *   - staff CANNOT read another user's history (collectionGroup)
 */
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  collection,
  collectionGroup,
  query,
  runTransaction,
  where,
} from 'firebase/firestore';

const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080').split(':');

function vnParts(date) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const get = t => fmt.formatToParts(date).find(p => p.type === t).value;
  return { year: get('year'), month: get('month'), day: get('day') };
}

const today = vnParts(new Date());
const yest = vnParts(new Date(Date.now() - 24 * 3600 * 1000));

function entryRef(db, p, uid) {
  return doc(db, 'history', p.year, 'months', p.month, 'days', p.day, 'entries', uid);
}
function entriesCol(db, p) {
  return collection(db, 'history', p.year, 'months', p.month, 'days', p.day, 'entries');
}

const results = [];
function record(name, ok) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}

const env = await initializeTestEnvironment({
  projectId: 'demo-planregister',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host, port: Number(port) },
});

// ---- seed (rules disabled) ----
await env.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'config', 'app'), { minVersion: '1.0.0', updateUrl: 'https://example.com' });
  await setDoc(doc(db, 'users', 'boss1'), { role: 'boss', approved: true, active: true, uid: 'boss1' });
  await setDoc(doc(db, 'users', 'staffA'), { role: 'staff', approved: true, active: true, uid: 'staffA' });
  await setDoc(doc(db, 'users', 'staffB'), { role: 'staff', approved: true, active: true, uid: 'staffB' });
  // A "Trưởng CA" chức vụ grants boss powers even with role 'staff'.
  await setDoc(doc(db, 'users', 'chief1'), { role: 'staff', position: 'Trưởng CA', approved: false, active: true, uid: 'chief1' });
  // A pending (unapproved) user, used to test self-approval via chức vụ.
  await setDoc(doc(db, 'users', 'selfP'), { role: 'staff', approved: false, active: true, uid: 'selfP' });
  const mk = (p, uid) => setDoc(entryRef(db, p, uid), { uid, displayName: uid, unit: 'U', date: `${p.year}-${p.month}-${p.day}`, content: 'x', createdAt: 1, updatedAt: 1 });
  await mk(today, 'staffA');
  await mk(today, 'staffB');
  await mk(yest, 'staffA');
  await mk(yest, 'staffB');
});

const staffA = env.authenticatedContext('staffA').firestore();
const staffB = env.authenticatedContext('staffB').firestore();
const chief = env.authenticatedContext('chief1').firestore();
const selfP = env.authenticatedContext('selfP').firestore();
const anon = env.unauthenticatedContext().firestore();

async function check(name, expectPass, thunk) {
  try {
    await (expectPass ? assertSucceeds(thunk()) : assertFails(thunk()));
    record(name, true);
  } catch (e) {
    record(name, false);
  }
}

// unauthenticated (pre-login) can read version config → allowed
await check('anon reads config/app', true, () => getDoc(doc(anon, 'config', 'app')));
// unauthenticated cannot read a user profile → denied
await check('anon reads users (deny)', false, () => getDoc(doc(anon, 'users', 'staffA')));
// nobody may write the version config from a client (console/admin only) → denied
await check('staff writes config/app (deny)', false, () =>
  setDoc(doc(staffA, 'config', 'app'), { minVersion: '9.9.9' }));
await check('anon writes config/app (deny)', false, () =>
  setDoc(doc(anon, 'config', 'app'), { minVersion: '9.9.9' }));
// staff reads today's full list (others included) → allowed
await check('staff reads TODAY all entries', true, () => getDocs(entriesCol(staffA, today)));
// staff reads another user's today entry directly → allowed
await check('staff reads other TODAY entry', true, () => getDoc(entryRef(staffA, today, 'staffB')));
// staff reads another user's PAST entry directly → denied
await check('staff reads other PAST entry (deny)', false, () => getDoc(entryRef(staffA, yest, 'staffB')));
// staff lists a PAST day's entries (contains others) → denied
await check('staff lists PAST day all entries (deny)', false, () => getDocs(entriesCol(staffA, yest)));
// staff reads own history (collectionGroup) → allowed
await check('staff reads OWN history (group)', true, () =>
  getDocs(query(collectionGroup(staffA, 'entries'), where('uid', '==', 'staffA'))));
// staff reads another user's history (collectionGroup) → denied
await check('staff reads OTHER history (group, deny)', false, () =>
  getDocs(query(collectionGroup(staffA, 'entries'), where('uid', '==', 'staffB'))));

// "Trưởng CA" (position-only boss) has boss read powers:
// reads another user's PAST entry directly → allowed (a plain staff cannot)
await check('chief (Trưởng CA) reads other PAST entry', true, () =>
  getDoc(entryRef(chief, yest, 'staffB')));
// lists a PAST day's full entries → allowed
await check('chief (Trưởng CA) lists PAST day all entries', true, () =>
  getDocs(entriesCol(chief, yest)));
// reads any user profile → allowed (boss/manager read)
await check('chief (Trưởng CA) reads users', true, () =>
  getDoc(doc(chief, 'users', 'staffA')));
// manager lists the WHOLE users collection (ManageUsers "show all") → allowed
await check('chief (Trưởng CA) lists ALL users', true, () =>
  getDocs(collection(chief, 'users')));
// a plain staff cannot list all users
await check('staff lists ALL users (deny)', false, () =>
  getDocs(collection(staffA, 'users')));
// any signed-in user MAY query for the Trưởng CA (to detect one exists)
await check('staff queries Trưởng CA users (allow)', true, () =>
  getDocs(query(collection(staffA, 'users'), where('position', '==', 'Trưởng CA'))));

// ---- duty roster: duty_schedules/{force} ----
// NOTE: must run BEFORE the self-profile-update block below, which promotes
// staffA to a Trưởng CA (boss) and would invalidate the "plain staff" cases.
const dutyDoc = (db, force = 'CA') => doc(db, 'duty_schedules', force);
const duty = (uid, force = 'CA') => ({
  force,
  fileType: 'image',
  fileName: 'lich-truc.jpg',
  mimeType: 'image/jpeg',
  size: 1234,
  storagePath: `duty/${force}/1-lich-truc.jpg`,
  fileUrl: 'https://example.com/x.jpg',
  note: '',
  uploadedBy: uid,
  uploadedByName: uid,
  uploadedAt: 1,
});
// approved staff read the roster → allowed (whole unit sees it)
await check('staff reads duty roster', true, () => getDoc(dutyDoc(staffA)));
// unauthenticated / not-yet-approved users see nothing
await check('anon reads duty roster (deny)', false, () => getDoc(dutyDoc(anon)));
await check('pending reads duty roster (deny)', false, () => getDoc(dutyDoc(selfP)));
// any approved staff may post — this is deliberate, not a boss-only action
await check('staff posts duty roster', true, () =>
  setDoc(dutyDoc(staffA), duty('staffA')));
// but may not post it under someone else's name
await check('staff posts as other user (deny)', false, () =>
  setDoc(dutyDoc(staffB), duty('staffA')));
// nor create a roster for a lực lượng that does not exist
await check('staff posts unknown force (deny)', false, () =>
  setDoc(dutyDoc(staffA, 'XX'), duty('staffA', 'XX')));
// deleting is narrower than posting: not someone else's roster...
await check('staff deletes other roster (deny)', false, () =>
  deleteDoc(dutyDoc(staffB)));
// ...but the person who posted it may remove it
await check('staff deletes own roster', true, () => deleteDoc(dutyDoc(staffA)));
// and a manager may remove anyone's
await check('staff posts duty roster again', true, () =>
  setDoc(dutyDoc(staffA), duty('staffA')));
await check('chief deletes any roster', true, () => deleteDoc(dutyDoc(chief)));

// ---- sổ số văn bản: doc_numbers / doc_number_counters / doc_number_locks ----
// Also runs BEFORE the self-profile-update block (staffA is still plain staff).
const lockDoc = db => doc(db, 'doc_number_locks', 'global');
const counterDoc = db => doc(db, 'doc_number_counters', '2026-QD');
const mkLock = uid => ({
  uid, name: uid, unit: 'U', position: '',
  acquiredAt: Date.now(), expiresAt: Date.now() + 60_000,
});
const counter = next => ({ year: 2026, typeId: 'QD', next });
const mkEntry = uid => ({
  seq: 1, year: 2026, number: '1/QĐ', typeId: 'QD', typeAbbr: 'QĐ',
  typeLabel: 'Quyết định (cá biệt)', summary: 'Trích yếu', signer: 'Ông A',
  unit: 'CA xã', createdBy: uid, createdByName: uid, createdAt: 1,
});
// taking the "đang nhập" lock while it is free → allowed
await check('staff takes doc-number lock', true, () =>
  setDoc(lockDoc(staffA), mkLock('staffA')));
// ...and nobody else may take it while it is still alive (this is the lock)
await check('other staff takes held lock (deny)', false, () =>
  setDoc(lockDoc(staffB), mkLock('staffB')));
// nor may they impersonate the holder in the lock document
await check('staff writes lock under other name (deny)', false, () =>
  setDoc(lockDoc(staffA), mkLock('staffB')));
// a number can only be taken by whoever holds the lock
await check('staff bumps counter without lock (deny)', false, () =>
  setDoc(counterDoc(staffB), counter(2)));
await check('lock holder bumps counter', true, () =>
  setDoc(counterDoc(staffA), counter(2)));
// the counter may only ever step forward by exactly one
await check('counter skips a number (deny)', false, () =>
  setDoc(counterDoc(staffA), counter(5)));
await check('counter goes backwards (deny)', false, () =>
  setDoc(counterDoc(staffA), counter(2)));
await check('counter steps by one', true, () =>
  setDoc(counterDoc(staffA), counter(3)));
// writing the issued number itself, under the caller's own name
await check('staff issues a doc number', true, () =>
  setDoc(doc(staffA, 'doc_numbers', 'dn1'), mkEntry('staffA')));
await check('staff issues under other name (deny)', false, () =>
  setDoc(doc(staffB, 'doc_numbers', 'dn2'), mkEntry('staffA')));
// the sổ is a permanent record: no edits, no deletes, not even by its author
await check('staff edits issued number (deny)', false, () =>
  setDoc(doc(staffA, 'doc_numbers', 'dn1'), { ...mkEntry('staffA'), summary: 'khác' }));
await check('staff deletes issued number (deny)', false, () =>
  deleteDoc(doc(staffA, 'doc_numbers', 'dn1')));
await check('chief deletes issued number (deny)', false, () =>
  deleteDoc(doc(chief, 'doc_numbers', 'dn1')));
// the whole unit reads the sổ; outsiders and pending users do not
await check('staff reads the sổ số văn bản', true, () =>
  getDoc(doc(staffA, 'doc_numbers', 'dn1')));
await check('anon reads the sổ (deny)', false, () =>
  getDoc(doc(anon, 'doc_numbers', 'dn1')));
await check('pending reads the sổ (deny)', false, () =>
  getDoc(doc(selfP, 'doc_numbers', 'dn1')));
// releasing: not someone else's live lock, but your own is fine
await check('staff releases other live lock (deny)', false, () =>
  deleteDoc(lockDoc(staffB)));
await check('staff releases own lock', true, () => deleteDoc(lockDoc(staffA)));
// a lock left behind by a crashed app expires, and anyone may then take it
await env.withSecurityRulesDisabled(async ctx => {
  await setDoc(doc(ctx.firestore(), 'doc_number_locks', 'global'), {
    ...mkLock('staffA'), expiresAt: Date.now() - 1000,
  });
});
await check('staff takes an EXPIRED lock', true, () =>
  setDoc(lockDoc(staffB), mkLock('staffB')));
await check('chief force-releases a live lock', true, () =>
  deleteDoc(lockDoc(chief)));

// The app issues a number in ONE transaction: bump the counter, write the
// entry, and release the lock together. Rules evaluate every write in the
// transaction against the state BEFORE it commits, so holdsDocNumberLock()
// still sees the lock the same transaction is about to delete — this is the
// path that actually runs in production, so test it, not just the pieces.
const issueTx = db => runTransaction(db, async tx => {
  await tx.get(lockDoc(db));
  await tx.get(counterDoc(db));
  tx.set(counterDoc(db), counter(4));
  tx.set(doc(db, 'doc_numbers', 'dn3'), { ...mkEntry('staffA'), seq: 3, number: '3/QĐ' });
  tx.delete(lockDoc(db));
});
await check('staff re-takes the lock', true, () =>
  setDoc(lockDoc(staffA), mkLock('staffA')));
// someone who does NOT hold the lock cannot slip a number through the same way
await check('non-holder issues in one transaction (deny)', false, () => issueTx(staffB));
await check('lock holder issues in one transaction', true, () => issueTx(staffA));

// ---- so phu: doc_number_suffixes ----
// Cung luat voi bo dem chinh, nhung dem chu cai cho MOT so cu the (12A, 12B).
const suffixDoc = db => doc(db, 'doc_number_suffixes', '2026-QD-5');
const sfx = next => ({ year: 2026, typeId: 'QD', seq: 5, next });
await check('staff re-takes the lock (2)', true, () =>
  setDoc(lockDoc(staffA), mkLock('staffA')));
// khong giu khoa thi khong duoc cap chu phu
await check('non-holder bumps suffix counter (deny)', false, () =>
  setDoc(suffixDoc(staffB), sfx(2)));
await check('lock holder takes suffix A', true, () =>
  setDoc(suffixDoc(staffA), sfx(2)));
// chu phu cung chi duoc tang dung mot don vi
await check('suffix counter skips a letter (deny)', false, () =>
  setDoc(suffixDoc(staffA), sfx(5)));
await check('suffix counter goes backwards (deny)', false, () =>
  setDoc(suffixDoc(staffA), sfx(2)));
await check('suffix counter takes B', true, () => setDoc(suffixDoc(staffA), sfx(3)));
await check('nobody deletes a suffix counter (deny)', false, () =>
  deleteDoc(suffixDoc(chief)));
// van ban so phu ghi vao so binh thuong (van bi ep createdBy)
await check('staff writes a suffixed doc number', true, () =>
  setDoc(doc(staffA, 'doc_numbers', 'dn5A'), { ...mkEntry('staffA'), seq: 5, suffix: 'A', number: '5A/QĐ' }));
await check('staff releases own lock (2)', true, () => deleteDoc(lockDoc(staffA)));

// ---- danh muc nguoi ky / don vi: doc_number_options ----
const optDoc = (db, id = 'lists') => doc(db, 'doc_number_options', id);
const opts = { signers: ['Phạm Nguyên Khánh'], units: ['Tổ An ninh'] };
// ca don vi doc duoc (de do vao dropdown)...
await check('staff reads danh muc', true, () => getDoc(optDoc(staffA)));
await check('anon reads danh muc (deny)', false, () => getDoc(optDoc(anon)));
// ...nhung chi quan ly moi sua duoc: day la du lieu dung chung
await check('staff sua danh muc (deny)', false, () => setDoc(optDoc(staffA), opts));
await check('chief sua danh muc', true, () => setDoc(optDoc(chief), opts));
// khong tao duoc document danh muc la, va phai dung kieu mang
await check('chief ghi id la (deny)', false, () =>
  setDoc(optDoc(chief, 'khac'), opts));
await check('chief ghi signers khong phai mang (deny)', false, () =>
  setDoc(optDoc(chief), { signers: 'x', units: ['Tổ An ninh'] }));

// ---- self profile update: role must follow chức vụ ----
const selfDoc = () => doc(staffA, 'users', 'staffA');
const base = { uid: 'staffA', approved: true, active: true };
// self sets role=boss but position is NOT Trưởng CA → denied (role must match position)
await check('self sets role=boss with wrong position (deny)', false, () =>
  setDoc(selfDoc(), { ...base, role: 'boss', position: 'Cán bộ' }));
// self tries to self-approve/deactivate flip → denied
await check('self flips approved (deny)', false, () =>
  setDoc(selfDoc(), { ...base, approved: false, role: 'staff', position: 'Cán bộ' }));
// self tries to grant themselves the dev role → denied
await check('self sets role=dev (deny)', false, () =>
  setDoc(selfDoc(), { ...base, role: 'dev', position: 'Trưởng CA' }));
// self picks "Trưởng CA" chức vụ → role=boss allowed (self-promote, accepted)
await check('self picks Trưởng CA → role=boss (allow)', true, () =>
  setDoc(selfDoc(), { ...base, role: 'boss', position: 'Trưởng CA' }));

// ---- pending user self-approves ONLY by picking Trưởng CA ----
const selfPDoc = () => doc(selfP, 'users', 'selfP');
// pending user tries to self-approve with a non-Trưởng chức vụ → denied
// (runs first, while selfP is still approved:false)
await check('pending self-approves as Cán bộ (deny)', false, () =>
  setDoc(selfPDoc(), { uid: 'selfP', active: true, role: 'staff', approved: true, position: 'Cán bộ' }));
// pending user picks Trưởng CA → role=boss AND approved=true → allowed (auto-approve)
await check('pending picks Trưởng CA → approved=true (allow)', true, () =>
  setDoc(selfPDoc(), { uid: 'selfP', active: true, role: 'boss', approved: true, position: 'Trưởng CA' }));

await env.cleanup();

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
