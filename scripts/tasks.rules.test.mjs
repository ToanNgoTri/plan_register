/**
 * Kiểm tra firestore.rules cho nhiệm vụ (tasks/{id}).
 * Chạy:  npm run test:tasks
 */
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080').split(':');
const results = [];
async function check(name, shouldPass, fn) {
  let ok;
  try {
    await (shouldPass ? assertSucceeds(fn()) : assertFails(fn()));
    ok = true;
  } catch (e) {
    ok = false;
    console.log('   ', e.message);
  }
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}

const env = await initializeTestEnvironment({
  projectId: 'demo-planregister',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host, port: Number(port) },
});

const H = 3600 * 1000;
const future = () => Date.now() + 2 * H;
const baseTask = (over = {}) => ({
  title: 'Xác minh đơn',
  content: '',
  assignerUid: 'chief',
  assignerName: 'Chief',
  assigneeUid: 'staffA',
  assigneeName: 'A',
  dueAt: future(),
  status: 'pending',
  rejectReason: null,
  rejectCount: 0,
  postponeCount: 0,
  lastPostponeReason: null,
  submittedAt: null,
  approvedAt: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  log: [],
  ...over,
});

await env.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'users', 'chief'), { role: 'boss', position: 'Trưởng CA', approved: true, active: true, unitId: 'U1' });
  await setDoc(doc(db, 'users', 'deputy'), { role: 'staff', position: 'Phó Trưởng CA', approved: true, active: true, unitId: 'U1' });
  await setDoc(doc(db, 'users', 'devCB'), { role: 'dev', position: 'Cán bộ', approved: true, active: true, unitId: 'U1' });
  await setDoc(doc(db, 'users', 'deputy2'), { role: 'staff', position: 'Phó Trưởng CA', approved: true, active: true, unitId: 'U1' });
  await setDoc(doc(db, 'users', 'deputyPending'), { role: 'staff', position: 'Phó Trưởng CA', approved: false, active: true, unitId: 'U1' });
  await setDoc(doc(db, 'users', 'staffA'), { role: 'staff', position: 'Cán bộ', approved: true, active: true, unitId: 'U1' });
  await setDoc(doc(db, 'users', 'staffB'), { role: 'staff', position: 'Cán bộ', approved: true, active: true, unitId: 'U1' });
  // Cán bộ của đơn vị KHÁC: không giao được nhiệm vụ sang.
  await setDoc(doc(db, 'users', 'otherUnit'), { role: 'staff', position: 'Cán bộ', approved: true, active: true, unitId: 'U2' });
  await setDoc(doc(db, 'tasks', 'T1'), baseTask());
  await setDoc(doc(db, 'tasks', 'T2'), baseTask({ assignerUid: 'deputy', assigneeUid: 'staffB' }));
});

const as = uid => env.authenticatedContext(uid).firestore();
const chief = as('chief');
const deputy = as('deputy');
const staffA = as('staffA');
const staffB = as('staffB');

// ---- tạo ----
await check('Trưởng CA giao nhiệm vụ', true, () => setDoc(doc(chief, 'tasks', 'N1'), baseTask()));
await check('Phó Trưởng CA giao nhiệm vụ', true, () =>
  setDoc(doc(deputy, 'tasks', 'N2'), baseTask({ assignerUid: 'deputy' })));
await check('Phó chưa duyệt giao (deny)', false, () =>
  setDoc(doc(as('deputyPending'), 'tasks', 'N3'), baseTask({ assignerUid: 'deputyPending' })));
await check('Trưởng CA giao cho Phó', true, () =>
  setDoc(doc(chief, 'tasks', 'R1'), baseTask({ assigneeUid: 'deputy' })));
await check('Phó giao ngược cho Trưởng (deny)', false, () =>
  setDoc(doc(deputy, 'tasks', 'R2'), baseTask({ assignerUid: 'deputy', assigneeUid: 'chief' })));
await check('Phó giao ngang cho Phó khác (deny)', false, () =>
  setDoc(doc(deputy, 'tasks', 'R3'), baseTask({ assignerUid: 'deputy', assigneeUid: 'deputy2' })));
await check('Trưởng CA giao cho người ĐƠN VỊ KHÁC (deny)', false, () =>
  setDoc(doc(chief, 'tasks', 'R5'), baseTask({ assigneeUid: 'otherUnit' })));
await check('giao cho người không tồn tại (deny)', false, () =>
  setDoc(doc(chief, 'tasks', 'R4'), baseTask({ assigneeUid: 'ghost' })));
await check('Cán bộ giao nhiệm vụ (deny)', false, () =>
  setDoc(doc(staffA, 'tasks', 'N4'), baseTask({ assignerUid: 'staffA', assigneeUid: 'staffB' })));
await check('giao mạo danh người khác (deny)', false, () =>
  setDoc(doc(deputy, 'tasks', 'N5'), baseTask({ assignerUid: 'chief' })));
// ---- tự giao (nhắc việc cá nhân) ----
await check('cán bộ tự giao cho bản thân', true, () =>
  setDoc(doc(staffA, 'tasks', 'S1'), baseTask({ assignerUid: 'staffA', assigneeUid: 'staffA' })));
await check('Trưởng tự giao cho bản thân', true, () =>
  setDoc(doc(chief, 'tasks', 'S2'), baseTask({ assigneeUid: 'chief' })));
await check('dev chức vụ Cán bộ giao cho người khác (deny)', false, () =>
  setDoc(doc(as('devCB'), 'tasks', 'S3'), baseTask({ assignerUid: 'devCB', assigneeUid: 'staffA' })));
await check('dev chức vụ Cán bộ tự giao', true, () =>
  setDoc(doc(as('devCB'), 'tasks', 'S4'), baseTask({ assignerUid: 'devCB', assigneeUid: 'devCB' })));
await check('tự giao: hoàn thành là xong luôn', true, () =>
  updateDoc(doc(staffA, 'tasks', 'S1'), { status: 'approved', approvedAt: Date.now(), submittedAt: Date.now() }));
await check('việc chỉ huy giao: lính tự duyệt (deny)', false, () =>
  updateDoc(doc(staffB, 'tasks', 'T2'), { status: 'approved' }));
await check('tự giao: người khác đọc (deny)', false, () =>
  getDoc(doc(staffB, 'tasks', 'S1')));
await check('hạn ở quá khứ (deny)', false, () =>
  setDoc(doc(chief, 'tasks', 'N7'), baseTask({ dueAt: Date.now() - H })));
await check('tạo sẵn trạng thái approved (deny)', false, () =>
  setDoc(doc(chief, 'tasks', 'N8'), baseTask({ status: 'approved' })));

// ---- đọc: chỉ người giao + người nhận ----
await check('người nhận đọc', true, () => getDoc(doc(staffA, 'tasks', 'T1')));
await check('người giao đọc', true, () => getDoc(doc(chief, 'tasks', 'T1')));
await check('người khác đọc (deny)', false, () => getDoc(doc(staffB, 'tasks', 'T1')));
await check('Trưởng CA đọc nhiệm vụ Phó giao người khác (deny)', false, () =>
  getDoc(doc(chief, 'tasks', 'T2')));
await check('query assigneeUid == me', true, () =>
  getDocs(query(collection(staffA, 'tasks'), where('assigneeUid', '==', 'staffA'))));
await check('query assignerUid == me', true, () =>
  getDocs(query(collection(chief, 'tasks'), where('assignerUid', '==', 'chief'))));
await check('query tất cả nhiệm vụ (deny)', false, () => getDocs(collection(chief, 'tasks')));
await check('Phó đọc danh sách cán bộ CÙNG đơn vị', true, () =>
  getDocs(query(collection(deputy, 'users'), where('unitId', '==', 'U1'), where('active', '==', true))));
await check('Phó đọc danh sách không lọc đơn vị (deny)', false, () =>
  getDocs(query(collection(deputy, 'users'), where('active', '==', true))));
await check('Phó đọc danh sách đơn vị KHÁC (deny)', false, () =>
  getDocs(query(collection(deputy, 'users'), where('unitId', '==', 'U2'), where('active', '==', true))));
await check('Cán bộ đọc danh sách cán bộ (deny)', false, () =>
  getDocs(query(collection(staffA, 'users'), where('active', '==', true))));

// ---- người nhận ----
const t1A = doc(staffA, 'tasks', 'T1');
await check('người nhận sửa tiêu đề (deny)', false, () => updateDoc(t1A, { title: 'x' }));
await check('người nhận tự duyệt (deny)', false, () => updateDoc(t1A, { status: 'approved' }));
await check('người nhận hoãn về quá khứ (deny)', false, () =>
  updateDoc(t1A, { dueAt: Date.now() - H, postponeCount: 1 }));
await check('người nhận chỉnh hạn sớm hơn hạn cũ (vẫn ở tương lai)', true, () =>
  updateDoc(t1A, { dueAt: Date.now() + H, postponeCount: 1 }));
await check('người nhận hoãn sang hạn muộn hơn', true, () =>
  updateDoc(t1A, { dueAt: Date.now() + 5 * H, postponeCount: 1, lastPostponeReason: 'bận' }));
await check('người khác báo hoàn thành (deny)', false, () =>
  updateDoc(doc(staffB, 'tasks', 'T1'), { status: 'submitted' }));
await check('người giao duyệt khi chưa báo xong (deny)', false, () =>
  updateDoc(doc(chief, 'tasks', 'T1'), { status: 'approved' }));
await check('người nhận báo hoàn thành', true, () =>
  updateDoc(t1A, { status: 'submitted', submittedAt: Date.now() }));
await check('người nhận hoãn khi đã chờ duyệt (deny)', false, () =>
  updateDoc(t1A, { dueAt: Date.now() + 9 * H }));

// ---- người giao ----
const t1C = doc(chief, 'tasks', 'T1');
await check('từ chối thiếu lý do (deny)', false, () =>
  updateDoc(t1C, { status: 'pending', rejectReason: '', dueAt: future() }));
await check('từ chối với hạn quá khứ (deny)', false, () =>
  updateDoc(t1C, { status: 'pending', rejectReason: 'thiếu', dueAt: Date.now() - H }));
await check('đổi người nhận (deny)', false, () =>
  updateDoc(t1C, { status: 'pending', rejectReason: 'x', dueAt: future(), assigneeUid: 'staffB' }));
await check('từ chối + lý do + hạn mới', true, () =>
  updateDoc(t1C, { status: 'pending', rejectReason: 'Thiếu biên bản', rejectCount: 1, dueAt: future() }));
await check('người nhận báo lại hoàn thành', true, () => updateDoc(t1A, { status: 'submitted' }));
await check('người giao duyệt', true, () =>
  updateDoc(t1C, { status: 'approved', approvedAt: Date.now() }));
await check('người nhận xoá (deny)', false, () => deleteDoc(t1A));
await check('người giao xoá', true, () => deleteDoc(t1C));

await env.cleanup();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
