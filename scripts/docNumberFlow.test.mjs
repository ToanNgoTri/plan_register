/**
 * Chạy thử LUỒNG cấp số văn bản trên emulator, với rules bật đầy đủ.
 *
 * Khác với scripts/rules.test.mjs (kiểm từng phép ghi được/không được), file này
 * mô phỏng đúng chuỗi transaction mà app chạy — giành khoá theo loại, cấp số,
 * nhả khoá — rồi soi lại dữ liệu để trả lời hai câu:
 *
 *   1. Khoá theo TỪNG LOẠI: cùng loại thì người thứ hai bị chặn; khác loại thì
 *      hai người chạy song song và không ai đụng dãy số của ai.
 *   2. Sang năm mới số tự về 01, còn chữ phụ của văn bản năm cũ vẫn cấp được.
 *
 * Run:
 *   npm run test:flow
 */
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  where,
} from 'firebase/firestore';

const [host, port] = (
  process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080'
).split(':');

const TTL = 2 * 60 * 1000;
const QD = { id: 'QD', abbr: 'QĐ', label: 'Quyết định (cá biệt)' };
const BC = { id: 'BC', abbr: 'BC', label: 'Báo cáo' };

// ---- copy nguyên logic của src/services/docNumberService (web SDK) ----------
const lockRef = (db, typeId) => doc(db, 'doc_number_locks', typeId);
const counterRef = (db, year, typeId) =>
  doc(db, 'doc_number_counters', `${year}-${typeId}`);
const suffixRef = (db, year, typeId, seq) =>
  doc(db, 'doc_number_suffixes', `${year}-${typeId}-${seq}`);

function suffixForIndex(n) {
  let s = '';
  let x = n;
  while (x > 0) {
    s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}
function formatDocNumber(seq, abbr, suffix = '') {
  const num = `${String(seq).padStart(2, '0')}${suffix || ''}`;
  return abbr ? `${num}/${abbr}` : num;
}

async function acquire(db, uid, type) {
  return runTransaction(db, async tx => {
    const now = Date.now();
    const ref = lockRef(db, type.id);
    const snap = await tx.get(ref);
    const cur = snap.exists() ? snap.data() : null;
    if (cur && cur.uid !== uid && cur.expiresAt > now) {
      const e = new Error(`${cur.name} đang lấy số ${cur.typeLabel}`);
      e.code = 'doc-number/locked';
      throw e;
    }
    tx.set(ref, {
      uid,
      name: uid,
      unit: 'U',
      position: '',
      typeId: type.id,
      typeLabel: type.label,
      acquiredAt: cur?.uid === uid ? cur.acquiredAt : now,
      expiresAt: now + TTL,
    });
  });
}

async function issue(db, uid, type, year, baseSeq = null) {
  return runTransaction(db, async tx => {
    const now = Date.now();
    const lSnap = await tx.get(lockRef(db, type.id));
    const lock = lSnap.exists() ? lSnap.data() : null;
    if (!lock || lock.uid !== uid || lock.expiresAt <= now) {
      const e = new Error('mất khoá');
      e.code = 'doc-number/lock-lost';
      throw e;
    }
    const isSuffix = baseSeq != null;
    const cRef = isSuffix
      ? suffixRef(db, year, type.id, baseSeq)
      : counterRef(db, year, type.id);
    const cSnap = await tx.get(cRef);
    const nextIndex = cSnap.exists() ? cSnap.data().next : 1;
    const seq = isSuffix ? baseSeq : nextIndex;
    const suffix = isSuffix ? suffixForIndex(nextIndex) : '';
    const entryRef = doc(collection(db, 'doc_numbers'));
    const entry = {
      seq,
      suffix,
      year,
      number: formatDocNumber(seq, type.abbr, suffix),
      typeId: type.id,
      typeAbbr: type.abbr,
      typeLabel: type.label,
      summary: `Trích yếu ${type.abbr || type.id} ${seq}${suffix}`,
      signer: 'Ông A',
      unit: 'Tổ An ninh',
      createdBy: uid,
      createdByName: uid,
      createdAt: now,
    };
    tx.set(cRef, {
      year,
      typeId: type.id,
      ...(isSuffix ? { seq: baseSeq } : {}),
      next: nextIndex + 1,
    });
    tx.set(entryRef, entry);
    tx.delete(lockRef(db, type.id));
    return entry;
  });
}

// ---- khung kiểm ------------------------------------------------------------
const results = [];
function ok(name, pass, detail = '') {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
function eq(name, actual, expected) {
  ok(name, actual === expected, `được "${actual}", mong "${expected}"`);
}

const env = await initializeTestEnvironment({
  projectId: 'demo-planregister',
  firestore: {
    rules: readFileSync('firestore.rules', 'utf8'),
    host,
    port: Number(port),
  },
});
await env.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore();
  for (const uid of ['vanthu1', 'vanthu2']) {
    await setDoc(doc(db, 'users', uid), {
      uid,
      role: 'staff',
      approved: true,
      active: true,
    });
  }
});

const A = env.authenticatedContext('vanthu1').firestore();
const B = env.authenticatedContext('vanthu2').firestore();
const YEAR = 2026;

// == 1. Khoá theo từng loại ==================================================
await acquire(A, 'vanthu1', QD);
ok('vanthu1 giành được khoá Quyết định', true);

let blocked = null;
try {
  await acquire(B, 'vanthu2', QD);
} catch (e) {
  blocked = e;
}
ok(
  'vanthu2 bị chặn ở CÙNG loại (Quyết định)',
  blocked?.code === 'doc-number/locked',
  blocked?.message ?? 'không bị chặn!',
);

// khác loại thì không liên quan gì đến nhau
await acquire(B, 'vanthu2', BC);
ok('vanthu2 giành được khoá Báo cáo trong lúc Quyết định đang bị giữ', true);

// hai người cấp số song song, mỗi người một dãy
const [qd1, bc1] = await Promise.all([
  issue(A, 'vanthu1', QD, YEAR),
  issue(B, 'vanthu2', BC, YEAR),
]);
eq('số Quyết định đầu tiên', qd1.number, '01/QĐ');
eq('số Báo cáo đầu tiên', bc1.number, '01/BC');

// == 2. Dãy số của mỗi loại đi riêng =========================================
await acquire(A, 'vanthu1', QD);
const qd2 = await issue(A, 'vanthu1', QD, YEAR);
eq('Quyết định tiếp theo là 02, không bị Báo cáo đẩy số', qd2.number, '02/QĐ');
await acquire(B, 'vanthu2', BC);
const bc2 = await issue(B, 'vanthu2', BC, YEAR);
eq('Báo cáo tiếp theo là 02', bc2.number, '02/BC');

// cấp số xong là khoá tự nhả → người khác vào được ngay
await acquire(B, 'vanthu2', QD);
ok('cấp số xong khoá tự nhả, người khác vào được ngay', true);
const qd3 = await issue(B, 'vanthu2', QD, YEAR);
eq('người thứ hai lấy số 03', qd3.number, '03/QĐ');

// == 3. Sang năm mới về lại 01 ===============================================
await acquire(A, 'vanthu1', QD);
const next = await issue(A, 'vanthu1', QD, YEAR + 1);
eq(`sang năm ${YEAR + 1} về lại 01`, next.number, '01/QĐ');
const oldCounter = await getDoc(counterRef(A, YEAR, 'QD'));
eq(
  `bộ đếm năm ${YEAR} không bị năm mới đụng tới`,
  oldCounter.data().next,
  4,
);

// == 4. Chữ phụ của văn bản NĂM CŨ vẫn cấp được ==============================
// (khoá đặt theo loại chứ không theo năm, nên không có khe hở lúc giao năm)
await acquire(A, 'vanthu1', QD);
const sfx = await issue(A, 'vanthu1', QD, YEAR, 2);
eq(`chữ phụ cho số 02 của năm ${YEAR}`, sfx.number, '02A/QĐ');
eq('số phụ giữ đúng năm của văn bản gốc', sfx.year, YEAR);
const mainCounter = await getDoc(counterRef(A, YEAR + 1, 'QD'));
eq('số phụ KHÔNG làm nhảy bộ đếm chính', mainCounter.data().next, 2);

await acquire(A, 'vanthu1', QD);
const sfxB = await issue(A, 'vanthu1', QD, YEAR, 2);
eq('chữ phụ kế tiếp của cùng số gốc', sfxB.number, '02B/QĐ');

// == 5. Soi lại sổ ===========================================================
const all = await getDocs(
  query(collection(A, 'doc_numbers'), where('year', '==', YEAR)),
);
const qdOfYear = all.docs
  .map(d => d.data())
  .filter(x => x.typeId === 'QD')
  .map(x => x.number)
  .sort();
eq(
  `sổ Quyết định năm ${YEAR}`,
  qdOfYear.join(', '),
  '01/QĐ, 02A/QĐ, 02B/QĐ, 02/QĐ, 03/QĐ'
    .split(', ')
    .sort()
    .join(', '),
);
// không có số nào trùng nhau
const dup = qdOfYear.length !== new Set(qdOfYear).size;
ok('không có số nào bị cấp trùng', !dup);

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
await env.cleanup();
process.exit(passed === results.length ? 0 : 1);
