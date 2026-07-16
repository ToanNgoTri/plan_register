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
  doc,
  getDoc,
  getDocs,
  setDoc,
  collection,
  collectionGroup,
  query,
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
  const mk = (p, uid) => setDoc(entryRef(db, p, uid), { uid, displayName: uid, unit: 'U', date: `${p.year}-${p.month}-${p.day}`, content: 'x', createdAt: 1, updatedAt: 1 });
  await mk(today, 'staffA');
  await mk(today, 'staffB');
  await mk(yest, 'staffA');
  await mk(yest, 'staffB');
});

const staffA = env.authenticatedContext('staffA').firestore();
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

await env.cleanup();

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
