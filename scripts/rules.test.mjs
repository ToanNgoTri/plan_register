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
  updateDoc,
  where,
  writeBatch,
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
  return doc(db, 'units', 'U1', 'history', p.year, 'months', p.month, 'days', p.day, 'entries', uid);
}
function entriesCol(db, p) {
  return collection(db, 'units', 'U1', 'history', p.year, 'months', p.month, 'days', p.day, 'entries');
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
  // Hai đơn vị trong danh mục: U1 (đơn vị chính của các test) và U2.
  await setDoc(doc(db, 'units', 'U1'), { name: 'Phường U1' });
  await setDoc(doc(db, 'units', 'U2'), { name: 'Xã U2' });
  await setDoc(doc(db, 'users', 'boss1'), { role: 'boss', approved: true, active: true, uid: 'boss1', unitId: 'U1' });
  await setDoc(doc(db, 'users', 'staffA'), { role: 'staff', approved: true, active: true, uid: 'staffA', unitId: 'U1' });
  await setDoc(doc(db, 'users', 'staffB'), { role: 'staff', approved: true, active: true, uid: 'staffB', unitId: 'U1' });
  // A "Trưởng CA" chức vụ grants boss powers even with role 'staff' — once APPROVED.
  await setDoc(doc(db, 'users', 'chief1'), { role: 'staff', position: 'Trưởng CA', approved: true, active: true, uid: 'chief1', unitId: 'U1' });
  // Yêu cầu Trưởng CA chưa duyệt: KHÔNG có quyền boss.
  await setDoc(doc(db, 'users', 'chiefReq'), { role: 'staff', position: 'Trưởng CA', approved: false, active: true, uid: 'chiefReq', unitId: 'U1' });
  // Quản trị (dev) — duyệt yêu cầu Trưởng CA mọi đơn vị.
  await setDoc(doc(db, 'users', 'dev1'), { role: 'dev', position: 'Cán bộ', approved: true, active: true, uid: 'dev1', unitId: 'U1' });
  // A pending (unapproved) user, used to test self-approval via chức vụ.
  await setDoc(doc(db, 'users', 'selfP'), { role: 'staff', approved: false, active: true, uid: 'selfP', unitId: 'U1' });
  // Người của đơn vị KHÁC (U2): cán bộ đã duyệt + Trưởng CA.
  await setDoc(doc(db, 'users', 'staffC'), { role: 'staff', approved: true, active: true, uid: 'staffC', unitId: 'U2', position: 'Cán bộ' });
  await setDoc(doc(db, 'users', 'chiefC'), { role: 'boss', approved: true, active: true, uid: 'chiefC', unitId: 'U2', position: 'Trưởng CA' });
  await setDoc(doc(db, 'unit_chiefs', 'U2'), { uid: 'chiefC' });
  // Tài khoản mới, chưa chọn đơn vị.
  await setDoc(doc(db, 'users', 'fresh'), { role: 'staff', approved: false, active: true, uid: 'fresh', unitId: '' });
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
const staffC = env.authenticatedContext('staffC').firestore();
const chiefC = env.authenticatedContext('chiefC').firestore();
const fresh = env.authenticatedContext('fresh').firestore();
const chiefReq = env.authenticatedContext('chiefReq').firestore();
const dev = env.authenticatedContext('dev1').firestore();

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
// manager lists the users OF THEIR ĐƠN VỊ (ManageUsers) → allowed
await check('chief (Trưởng CA) lists users of own unit', true, () =>
  getDocs(query(collection(chief, 'users'), where('unitId', '==', 'U1'))));
// ...but not the whole collection, nor another unit's users
await check('chief lists ALL users (deny)', false, () =>
  getDocs(collection(chief, 'users')));
await check('chief lists users of OTHER unit (deny)', false, () =>
  getDocs(query(collection(chief, 'users'), where('unitId', '==', 'U2'))));
await check('chief reads profile of OTHER unit (deny)', false, () =>
  getDoc(doc(chief, 'users', 'staffC')));
// a plain staff cannot list users
await check('staff lists users of own unit (deny)', false, () =>
  getDocs(query(collection(staffA, 'users'), where('unitId', '==', 'U1'))));
// any signed-in user MAY read who is the Trưởng CA of a unit (unit_chiefs)
await check('staff reads unit_chiefs (allow)', true, () =>
  getDoc(doc(staffA, 'unit_chiefs', 'U2')));
// and the unit catalogue
await check('fresh user lists units (allow)', true, () =>
  getDocs(collection(fresh, 'units')));
await check('staff writes units (deny)', false, () =>
  setDoc(doc(staffA, 'units', 'U9'), { name: 'x' }));

// ---- CÁCH LY ĐƠN VỊ: người U2 không thấy gì của U1 ----
await check('U2 staff reads U1 TODAY entries (deny)', false, () =>
  getDocs(entriesCol(staffC, today)));
await check('U2 chief reads U1 PAST entries (deny)', false, () =>
  getDocs(entriesCol(chiefC, yest)));
await check('U2 staff writes entry into U1 (deny)', false, () =>
  setDoc(entryRef(staffC, today, 'staffC'), { uid: 'staffC', content: 'x' }));
await check('U1 staff writes own entry into U1', true, () =>
  setDoc(entryRef(staffA, today, 'staffA'), { uid: 'staffA', content: 'y' }));
await check('U2 staff reads U1 duty roster (deny)', false, () =>
  getDoc(doc(staffC, 'units', 'U1', 'duty_schedules', 'CA')));
await check('U2 chief reads U1 sổ số (deny)', false, () =>
  getDocs(collection(chiefC, 'units', 'U1', 'doc_numbers')));
await check('U2 chief edits U1 danh mục (deny)', false, () =>
  setDoc(doc(chiefC, 'units', 'U1', 'doc_number_options', 'lists'), { signers: [], units: [] }));
await check('U2 chief approves U1 user (deny)', false, () =>
  updateDoc(doc(chiefC, 'users', 'selfP'), { approved: true }));
await check('U2 chief deletes U1 user (deny)', false, () =>
  deleteDoc(doc(chiefC, 'users', 'staffB')));
await check('U1 chief moves own staff to U2 (deny)', false, () =>
  updateDoc(doc(chief, 'users', 'staffB'), { unitId: 'U2' }));
// người chưa có đơn vị: không thấy dữ liệu nào
await check('no-unit user reads U1 roster (deny)', false, () =>
  getDoc(doc(fresh, 'units', 'U1', 'duty_schedules', 'CA')));
// đăng ký: chọn đơn vị có thật, không tự duyệt
await check('fresh picks unknown unit (deny)', false, () =>
  updateDoc(doc(fresh, 'users', 'fresh'), { unitId: 'U9', position: 'Cán bộ' }));
await check('fresh picks U2 + self-approve as Cán bộ (deny)', false, () =>
  updateDoc(doc(fresh, 'users', 'fresh'), { unitId: 'U2', position: 'Cán bộ', approved: true }));
await check('fresh claims Trưởng CA of U2 (taken, deny)', false, () => {
  const b = writeBatch(fresh);
  b.set(doc(fresh, 'unit_chiefs', 'U2'), { uid: 'fresh' });
  b.update(doc(fresh, 'users', 'fresh'), { unitId: 'U2', position: 'Trưởng CA', role: 'staff', approved: false });
  return b.commit();
});
await check('fresh picks Trưởng CA WITHOUT claim (deny)', false, () =>
  updateDoc(doc(fresh, 'users', 'fresh'), { unitId: 'U2', position: 'Trưởng CA', role: 'boss', approved: true }));
await check('fresh squats unit_chiefs without becoming chief (deny)', false, () =>
  setDoc(doc(fresh, 'unit_chiefs', 'U1'), { uid: 'fresh' }));
await check('fresh picks U2 as Cán bộ (pending)', true, () =>
  updateDoc(doc(fresh, 'users', 'fresh'), { unitId: 'U2', unit: 'Xã U2', position: 'Cán bộ' }));
await check('U2 chief sees + approves the new U2 user', true, () =>
  updateDoc(doc(chiefC, 'users', 'fresh'), { approved: true }));
await check('approved U2 user moves to U1 keeping approval (deny)', false, () =>
  updateDoc(doc(fresh, 'users', 'fresh'), { unitId: 'U1' }));
await check('approved U2 user moves to U1 -> back to pending (allow)', true, () =>
  updateDoc(doc(fresh, 'users', 'fresh'), { unitId: 'U1', approved: false }));

// ---- duty roster: duty_schedules/{force} ----
// NOTE: must run BEFORE the self-profile-update block below, which promotes
// staffA to a Trưởng CA (boss) and would invalidate the "plain staff" cases.
const dutyDoc = (db, force = 'CA') => doc(db, 'units', 'U1', 'duty_schedules', force);
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
// Khoá đặt theo LOẠI văn bản (id = typeId), không phải một khoá chung cả sổ.
const lockDoc = (db, typeId = 'QD') => doc(db, 'units', 'U1', 'doc_number_locks', typeId);
const counterDoc = (db, id = '2026-QD') =>
  doc(db, 'units', 'U1', 'doc_number_counters', id);
const mkLock = (uid, typeId = 'QD') => ({
  uid, name: uid, unit: 'U', position: '',
  typeId, typeLabel: typeId === 'QD' ? 'Quyết định (cá biệt)' : 'Báo cáo',
  acquiredAt: Date.now(), expiresAt: Date.now() + 60_000,
});
const counter = (next, year = 2026, typeId = 'QD') => ({ year, typeId, next });
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
// the lock document must name the loại its id stands for, otherwise the typeId
// the counter rules look the lock up by would be free-form.
await check('staff writes lock with wrong typeId (deny)', false, () =>
  setDoc(lockDoc(staffA, 'BC'), mkLock('staffA', 'QD')));
// khoá theo loại: một loại đang bị giữ KHÔNG khoá các loại còn lại
await check('other staff takes a DIFFERENT type lock', true, () =>
  setDoc(lockDoc(staffB, 'BC'), mkLock('staffB', 'BC')));
// a number can only be taken by whoever holds the lock
await check('staff bumps counter without lock (deny)', false, () =>
  setDoc(counterDoc(staffB), counter(2)));
// ...and holding one type's lock does not open another type's counter
await check('BC holder bumps QD counter (deny)', false, () =>
  setDoc(counterDoc(staffB), counter(2)));
await check('BC holder bumps BC counter', true, () =>
  setDoc(counterDoc(staffB, '2026-BC'), counter(2, 2026, 'BC')));
// the counter id must spell out the (năm, loại) it counts, or the lock check
// could be passed with a typeId that has nothing to do with the document.
await check('counter id disagrees with its fields (deny)', false, () =>
  setDoc(counterDoc(staffB, '2026-XX'), counter(3, 2026, 'BC')));
await check('staff releases own BC lock', true, () =>
  deleteDoc(lockDoc(staffB, 'BC')));
await check('lock holder bumps counter', true, () =>
  setDoc(counterDoc(staffA), counter(2)));
// sang năm mới là một document đếm khác, nên số bắt đầu lại từ 1 (next == 2)
await check('lock holder opens next year counter', true, () =>
  setDoc(counterDoc(staffA, '2027-QD'), counter(2, 2027)));
// the counter may only ever step forward by exactly one
await check('counter skips a number (deny)', false, () =>
  setDoc(counterDoc(staffA), counter(5)));
await check('counter goes backwards (deny)', false, () =>
  setDoc(counterDoc(staffA), counter(2)));
await check('counter steps by one', true, () =>
  setDoc(counterDoc(staffA), counter(3)));
// writing the issued number itself, under the caller's own name
await check('staff issues a doc number', true, () =>
  setDoc(doc(staffA, 'units', 'U1', 'doc_numbers', 'dn1'), mkEntry('staffA')));
await check('staff issues under other name (deny)', false, () =>
  setDoc(doc(staffB, 'units', 'U1', 'doc_numbers', 'dn2'), mkEntry('staffA')));
// the sổ is a permanent record: no edits, no deletes, not even by its author
await check('staff edits issued number (deny)', false, () =>
  setDoc(doc(staffA, 'units', 'U1', 'doc_numbers', 'dn1'), { ...mkEntry('staffA'), summary: 'khác' }));
await check('staff deletes issued number (deny)', false, () =>
  deleteDoc(doc(staffA, 'units', 'U1', 'doc_numbers', 'dn1')));
await check('chief deletes issued number (deny)', false, () =>
  deleteDoc(doc(chief, 'units', 'U1', 'doc_numbers', 'dn1')));
// the whole unit reads the sổ; outsiders and pending users do not
await check('staff reads the sổ số văn bản', true, () =>
  getDoc(doc(staffA, 'units', 'U1', 'doc_numbers', 'dn1')));
await check('anon reads the sổ (deny)', false, () =>
  getDoc(doc(anon, 'units', 'U1', 'doc_numbers', 'dn1')));
await check('pending reads the sổ (deny)', false, () =>
  getDoc(doc(selfP, 'units', 'U1', 'doc_numbers', 'dn1')));
// releasing: not someone else's live lock, but your own is fine
await check('staff releases other live lock (deny)', false, () =>
  deleteDoc(lockDoc(staffB)));
await check('staff releases own lock', true, () => deleteDoc(lockDoc(staffA)));
// a lock left behind by a crashed app expires, and anyone may then take it
await env.withSecurityRulesDisabled(async ctx => {
  await setDoc(doc(ctx.firestore(), 'units', 'U1', 'doc_number_locks', 'QD'), {
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
  tx.set(doc(db, 'units', 'U1', 'doc_numbers', 'dn3'), { ...mkEntry('staffA'), seq: 3, number: '3/QĐ' });
  tx.delete(lockDoc(db));
});
await check('staff re-takes the lock', true, () =>
  setDoc(lockDoc(staffA), mkLock('staffA')));
// someone who does NOT hold the lock cannot slip a number through the same way
await check('non-holder issues in one transaction (deny)', false, () => issueTx(staffB));
await check('lock holder issues in one transaction', true, () => issueTx(staffA));

// ---- so phu: doc_number_suffixes ----
// Cung luat voi bo dem chinh, nhung dem chu cai cho MOT so cu the (12A, 12B).
const suffixDoc = (db, id = '2026-QD-5') =>
  doc(db, 'units', 'U1', 'doc_number_suffixes', id);
const sfx = (next, year = 2026, seq = 5) => ({ year, typeId: 'QD', seq, next });
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
// id phai khop voi (nam, loai, so) ghi trong document
await check('suffix id disagrees with its fields (deny)', false, () =>
  setDoc(suffixDoc(staffA, '2026-QD-9'), sfx(2, 2026, 5)));
// Khoa dat theo LOAI chu khong theo nam, nen chu phu cho mot van ban cua nam
// truoc (dau thang 1 van gap) van di qua dung cai khoa dang giu.
await check('lock holder takes suffix on LAST YEAR base', true, () =>
  setDoc(suffixDoc(staffA, '2025-QD-7'), sfx(2, 2025, 7)));
// van ban so phu ghi vao so binh thuong (van bi ep createdBy)
await check('staff writes a suffixed doc number', true, () =>
  setDoc(doc(staffA, 'units', 'U1', 'doc_numbers', 'dn5A'), { ...mkEntry('staffA'), seq: 5, suffix: 'A', number: '5A/QĐ' }));
await check('staff releases own lock (2)', true, () => deleteDoc(lockDoc(staffA)));

// ---- danh muc nguoi ky / don vi: doc_number_options ----
const optDoc = (db, id = 'lists') => doc(db, 'units', 'U1', 'doc_number_options', id);
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

// ---- danh muc LOAI VAN BAN nam trong cung document -------------------------
// De trong du lieu chu khong trong ma nguon: them/bot mot loai van ban khong
// phai ra ban cap nhat app.
const withTypes = types => ({ ...opts, types });
await check('chief them loai van ban', true, () =>
  setDoc(optDoc(chief), withTypes([
    { id: 'QD', label: 'Quyết định (cá biệt)', abbr: 'QĐ' },
    { id: 'BB', label: 'Biên bản', abbr: 'BB' },
  ])));
// ca don vi doc duoc danh muc loai (de do vao dropdown lay so)
await check('staff doc danh muc loai', true, () => getDoc(optDoc(staffA)));
// ...nhung khong sua duoc: them mot loai la them mot day so moi cho ca don vi
await check('staff them loai van ban (deny)', false, () =>
  setDoc(optDoc(staffA), withTypes([{ id: 'BB', label: 'Biên bản', abbr: 'BB' }])));
// types phai la mang
await check('chief ghi types khong phai mang (deny)', false, () =>
  setDoc(optDoc(chief), withTypes({ id: 'BB' })));
// va khong duoc nhoi mot danh muc khong lo
await check('chief ghi 101 loai (deny)', false, () =>
  setDoc(optDoc(chief), withTypes(
    Array.from({ length: 101 }, (_, i) => ({ id: `L${i}`, label: `Loại ${i}`, abbr: '' })),
  )));
// bo `types` di thi van ghi duoc (app cu chi sua nguoi ky / don vi)
await check('chief ghi danh muc khong kem types', true, () =>
  setDoc(optDoc(chief), opts));

// ---- self profile update: role must follow chức vụ ----
const selfDoc = () => doc(staffA, 'users', 'staffA');
const base = { uid: 'staffA', approved: true, active: true, unitId: 'U1' };
// self sets role=boss but position is NOT Trưởng CA → denied (role must match position)
await check('self sets role=boss with wrong position (deny)', false, () =>
  setDoc(selfDoc(), { ...base, role: 'boss', position: 'Cán bộ' }));
// self tries to flip active → denied
await check('self flips active (deny)', false, () =>
  setDoc(selfDoc(), { ...base, active: false, role: 'staff', position: 'Cán bộ' }));
// self tries to grant themselves the dev role → denied
await check('self sets role=dev (deny)', false, () =>
  setDoc(selfDoc(), { ...base, role: 'dev', position: 'Trưởng CA' }));
// self picks "Trưởng CA" chức vụ: only together with claiming the unit's slot
await check('self picks Trưởng CA without claim (deny)', false, () =>
  setDoc(selfDoc(), { ...base, approved: false, role: 'staff', position: 'Trưởng CA' }));
await check('self picks Trưởng CA + claim but stays approved (deny)', false, () => {
  const b = writeBatch(staffA);
  b.set(doc(staffA, 'unit_chiefs', 'U1'), { uid: 'staffA' });
  b.set(selfDoc(), { ...base, role: 'boss', position: 'Trưởng CA' });
  return b.commit();
});
await check('self picks Trưởng CA + claims U1 slot -> chờ dev duyệt (allow)', true, () => {
  const b = writeBatch(staffA);
  b.set(doc(staffA, 'unit_chiefs', 'U1'), { uid: 'staffA' });
  b.set(selfDoc(), { ...base, approved: false, role: 'staff', position: 'Trưởng CA' });
  return b.commit();
});
await check('pending chief request has no boss read (deny)', false, () =>
  getDocs(entriesCol(staffA, yest)));
await check('pending chief request lists unit users (deny)', false, () =>
  getDocs(query(collection(staffA, 'users'), where('unitId', '==', 'U1'))));
await check('pending chief request self-approves (deny)', false, () =>
  updateDoc(selfDoc(), { approved: true, role: 'boss' }));
await check('U1 Trưởng CA approves chief request (deny, chỉ dev)', false, () =>
  updateDoc(doc(chief, 'users', 'staffA'), { approved: true, role: 'boss' }));
// dev: thấy yêu cầu Trưởng CA của mọi đơn vị và duyệt
await check('dev lists chief requests across units (allow)', true, () =>
  getDocs(query(collection(dev, 'users'), where('position', '==', 'Trưởng CA'), where('approved', '==', false))));
await check('dev reads profile of OTHER unit (allow)', true, () =>
  getDoc(doc(dev, 'users', 'staffC')));
await check('dev cannot read OTHER unit data (deny)', false, () =>
  getDocs(collection(dev, 'units', 'U2', 'doc_numbers')));
await check('dev approves chief request (allow)', true, () => {
  const b = writeBatch(dev);
  b.set(doc(dev, 'unit_chiefs', 'U1'), { uid: 'staffA', at: 1 });
  b.update(doc(dev, 'users', 'staffA'), { approved: true, active: true, role: 'boss' });
  return b.commit();
});
await check('dev moves user to another unit (deny)', false, () =>
  updateDoc(doc(dev, 'users', 'staffC'), { unitId: 'U1' }));
await check('dev rejects chief request (allow)', true, () =>
  updateDoc(doc(dev, 'users', 'chiefReq'), { position: '', role: 'staff', approved: false }));

// ---- pending user self-approves ONLY by picking Trưởng CA ----
const selfPDoc = () => doc(selfP, 'users', 'selfP');
// pending user tries to self-approve with a non-Trưởng chức vụ → denied
// (runs first, while selfP is still approved:false)
await check('pending self-approves as Cán bộ (deny)', false, () =>
  setDoc(selfPDoc(), { uid: 'selfP', active: true, role: 'staff', approved: true, position: 'Cán bộ' }));
// pending user picks Trưởng CA → role=boss AND approved=true → allowed (auto-approve)
// U1 slot is now held by staffA → selfP cannot also become Trưởng CA of U1
await check('pending claims TAKEN Trưởng CA slot (deny)', false, () => {
  const b = writeBatch(selfP);
  b.set(doc(selfP, 'unit_chiefs', 'U2'), { uid: 'selfP' });
  b.set(selfPDoc(), { uid: 'selfP', active: true, role: 'staff', approved: false, position: 'Trưởng CA', unitId: 'U2' });
  return b.commit();
});
// a free unit's slot → role=boss AND approved=true → allowed (auto-approve)
await env.withSecurityRulesDisabled(ctx =>
  setDoc(doc(ctx.firestore(), 'units', 'U3'), { name: 'Xã U3' }));
await check('pending picks free U3 + Trưởng CA, self-approved (deny)', false, () => {
  const b = writeBatch(selfP);
  b.set(doc(selfP, 'unit_chiefs', 'U3'), { uid: 'selfP' });
  b.set(selfPDoc(), { uid: 'selfP', active: true, role: 'boss', approved: true, position: 'Trưởng CA', unitId: 'U3' });
  return b.commit();
});
await check('pending picks free U3 + Trưởng CA -> chờ dev (allow)', true, () => {
  const b = writeBatch(selfP);
  b.set(doc(selfP, 'unit_chiefs', 'U3'), { uid: 'selfP' });
  b.set(selfPDoc(), { uid: 'selfP', active: true, role: 'staff', approved: false, position: 'Trưởng CA', unitId: 'U3' });
  return b.commit();
});
await check('another user requests the TAKEN U3 slot (deny)', false, () => {
  const b = writeBatch(chiefReq);
  b.set(doc(chiefReq, 'unit_chiefs', 'U3'), { uid: 'chiefReq' });
  b.update(doc(chiefReq, 'users', 'chiefReq'), { role: 'staff', approved: false, position: 'Trưởng CA', unitId: 'U3' });
  return b.commit();
});

// ---- Cài đặt → chuyển đơn vị: luôn về chờ duyệt (userService.changeUnit) ----
await check('Trưởng CA U3 chuyển sang U2 mà vẫn approved (deny)', false, () =>
  setDoc(selfPDoc(), { uid: 'selfP', active: true, role: 'staff', approved: true, position: 'Cán bộ', unitId: 'U2' }));
await check('Trưởng CA U3 chuyển sang U2 → staff, chờ duyệt, trả slot U3 (allow)', true, () => {
  const b = writeBatch(selfP);
  b.delete(doc(selfP, 'unit_chiefs', 'U3'));
  b.set(selfPDoc(), { uid: 'selfP', active: true, role: 'staff', approved: false, position: '', unitId: 'U2' });
  return b.commit();
});

await check('dev tự chuyển đơn vị U1 -> U2 (allow)', true, () =>
  updateDoc(doc(dev, 'users', 'dev1'), { unitId: 'U2', unit: 'Xã U2' }));
await check('dev chuyển sang đơn vị không có (deny)', false, () =>
  updateDoc(doc(dev, 'users', 'dev1'), { unitId: 'U9' }));

// ---- "Cán bộ (admin)": mỗi đơn vị một admin, quản trị CHỈ đơn vị mình ----
await env.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'units', 'U4'), { name: 'Xã U4' });
  await setDoc(doc(db, 'units', 'U5'), { name: 'Xã U5' });
  await setDoc(doc(db, 'users', 'adm4'), { role: 'staff', position: 'Cán bộ', approved: true, active: true, uid: 'adm4', unitId: 'U4' });
  await setDoc(doc(db, 'users', 'req4'), { role: 'staff', position: 'Trưởng CA', approved: false, active: true, uid: 'req4', unitId: 'U4' });
  await setDoc(doc(db, 'unit_chiefs', 'U4'), { uid: 'req4' });
  await setDoc(doc(db, 'users', 'new5'), { role: 'staff', position: '', approved: false, active: true, uid: 'new5', unitId: '' });
  await setDoc(doc(db, 'users', 'p4'), { role: 'staff', position: 'Cán bộ', approved: false, active: true, uid: 'p4', unitId: 'U4' });
});
const adm4 = env.authenticatedContext('adm4').firestore();
const req4 = env.authenticatedContext('req4').firestore();
const new5 = env.authenticatedContext('new5').firestore();
const ADMIN = 'Cán bộ (admin)';
await check('admin tự nhận mà không giữ chỗ (deny)', false, () =>
  updateDoc(doc(adm4, 'users', 'adm4'), { position: ADMIN, role: 'admin', approved: true }));
await check('cán bộ U4 nhận admin U4 (chỗ trống) (allow)', true, () => {
  const b = writeBatch(adm4);
  b.set(doc(adm4, 'unit_admins', 'U4'), { uid: 'adm4' });
  b.update(doc(adm4, 'users', 'adm4'), { position: ADMIN, role: 'admin', approved: true });
  return b.commit();
});
await check('người thứ hai nhận admin U4 (đã có, deny)', false, () => {
  const b = writeBatch(req4);
  b.set(doc(req4, 'unit_admins', 'U4'), { uid: 'req4' });
  b.update(doc(req4, 'users', 'req4'), { position: ADMIN, role: 'admin', approved: true });
  return b.commit();
});
await check('admin U4 liệt kê người dùng U4 (allow)', true, () =>
  getDocs(query(collection(adm4, 'users'), where('unitId', '==', 'U4'))));
await check('admin U4 liệt kê người dùng U2 (deny)', false, () =>
  getDocs(query(collection(adm4, 'users'), where('unitId', '==', 'U2'))));
await check('admin U4 duyệt cán bộ U4 (allow)', true, () =>
  updateDoc(doc(adm4, 'users', 'p4'), { approved: true }));
await check('admin U4 duyệt cán bộ U2 (deny)', false, () =>
  updateDoc(doc(adm4, 'users', 'staffC'), { active: false }));
await check('admin U4 trao admin cho người khác (deny)', false, () =>
  updateDoc(doc(adm4, 'users', 'p4'), { position: ADMIN, role: 'admin' }));
await check('admin U4 duyệt yêu cầu Trưởng CA U4 (allow)', true, () => {
  const b = writeBatch(adm4);
  b.set(doc(adm4, 'unit_chiefs', 'U4'), { uid: 'req4', at: 1 });
  b.update(doc(adm4, 'users', 'req4'), { approved: true, active: true, role: 'boss' });
  return b.commit();
});
await check('admin U4 đọc lịch sử quá khứ U1 (deny)', false, () =>
  getDocs(entriesCol(adm4, yest)));
await check('admin U4 đăng lịch trực U4 như cán bộ (allow)', true, () =>
  setDoc(doc(adm4, 'units', 'U4', 'duty_schedules', 'CA'), { force: 'CA', uploadedBy: 'adm4' }));
await check('người đầu tiên của U5 tự làm admin (allow)', true, () => {
  const b = writeBatch(new5);
  b.set(doc(new5, 'unit_admins', 'U5'), { uid: 'new5' });
  b.update(doc(new5, 'users', 'new5'), { unitId: 'U5', unit: 'Xã U5', position: ADMIN, role: 'admin', approved: true });
  return b.commit();
});
await check('admin U4 chuyển sang U2 giữ quyền admin (deny)', false, () =>
  updateDoc(doc(adm4, 'users', 'adm4'), { unitId: 'U2' }));
await check('admin U4 chuyển sang U2 → chờ duyệt, trả chỗ (allow)', true, () => {
  const b = writeBatch(adm4);
  b.delete(doc(adm4, 'unit_admins', 'U4'));
  b.update(doc(adm4, 'users', 'adm4'), { unitId: 'U2', position: '', role: 'staff', approved: false });
  return b.commit();
});
await check('dev trao admin cho người khác (deny)', false, () =>
  updateDoc(doc(dev, 'users', 'p4'), { position: ADMIN, role: 'admin' }));

// ---- Giao / thu / chuyển chức Trưởng CA & admin: Trưởng CA đơn vị hoặc dev ----
await env.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'units', 'U6'), { name: 'Xã U6' });
  const u = (id, extra) => setDoc(doc(db, 'users', id), { uid: id, active: true, unitId: 'U6', ...extra });
  await u('c6', { role: 'boss', position: 'Trưởng CA', approved: true });
  await u('a6', { role: 'admin', position: 'Cán bộ (admin)', approved: true });
  await u('s6', { role: 'staff', position: 'Cán bộ', approved: true });
  await u('t6', { role: 'staff', position: 'Cán bộ', approved: true });
  await u('p6', { role: 'staff', position: 'Cán bộ', approved: false });
  await setDoc(doc(db, 'unit_chiefs', 'U6'), { uid: 'c6' });
  await setDoc(doc(db, 'unit_admins', 'U6'), { uid: 'a6' });
});
const c6 = env.authenticatedContext('c6').firestore();
const s6 = env.authenticatedContext('s6').firestore();
const giveAdmin = (dbx, from, to) => {
  const b = writeBatch(dbx);
  if (from) b.update(doc(dbx, 'users', from), { position: 'Cán bộ', role: 'staff' });
  b.set(doc(dbx, 'unit_admins', 'U6'), { uid: to, at: 1 });
  b.update(doc(dbx, 'users', to), { position: ADMIN, role: 'admin', approved: true, active: true });
  return b.commit();
};
await check('Trưởng CA khác đơn vị giao admin U6 (deny)', false, () => giveAdmin(chiefC, 'a6', 's6'));
await check('Trưởng CA U6 giao admin cho người chưa duyệt (deny)', false, () => giveAdmin(c6, 'a6', 'p6'));
await check('Trưởng CA U6 chuyển admin a6 → s6 (allow)', true, () => giveAdmin(c6, 'a6', 's6'));
await check('admin U6 tự chuyển admin cho t6 (deny)', false, () => giveAdmin(s6, 's6', 't6'));
await check('admin U6 hạ chức Trưởng CA (deny)', false, () =>
  updateDoc(doc(s6, 'users', 'c6'), { position: 'Cán bộ', role: 'staff' }));
await check('Trưởng CA U6 thu admin của s6 (allow)', true, () => {
  const b = writeBatch(c6);
  b.delete(doc(c6, 'unit_admins', 'U6'));
  b.update(doc(c6, 'users', 's6'), { position: 'Cán bộ', role: 'staff' });
  return b.commit();
});
await check('Trưởng CA U6 giao chức Trưởng CA cho t6, mình về Cán bộ (allow)', true, () => {
  const b = writeBatch(c6);
  b.update(doc(c6, 'users', 'c6'), { position: 'Cán bộ', role: 'staff' });
  b.set(doc(c6, 'unit_chiefs', 'U6'), { uid: 't6', at: 1 });
  b.update(doc(c6, 'users', 't6'), { position: 'Trưởng CA', role: 'boss', approved: true, active: true });
  return b.commit();
});
await check('cựu Trưởng CA lấy lại chức (deny)', false, () => {
  const b = writeBatch(c6);
  b.update(doc(c6, 'users', 't6'), { position: 'Cán bộ', role: 'staff' });
  b.set(doc(c6, 'unit_chiefs', 'U6'), { uid: 'c6', at: 1 });
  b.update(doc(c6, 'users', 'c6'), { position: 'Trưởng CA', role: 'boss' });
  return b.commit();
});
await check('dev chuyển Trưởng CA U6 t6 → s6 (allow)', true, () => {
  const b = writeBatch(dev);
  b.update(doc(dev, 'users', 't6'), { position: 'Cán bộ', role: 'staff' });
  b.set(doc(dev, 'unit_chiefs', 'U6'), { uid: 's6', at: 1 });
  b.update(doc(dev, 'users', 's6'), { position: 'Trưởng CA', role: 'boss', approved: true, active: true });
  return b.commit();
});
await check('dev giao admin U6 cho c6 (allow)', true, () => giveAdmin(dev, null, 'c6'));

await env.cleanup();

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
