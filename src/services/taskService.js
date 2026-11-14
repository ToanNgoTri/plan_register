import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  updateDoc,
  where,
} from '@react-native-firebase/firestore';
import { db } from './firebase';
import { displayNameOf } from './userService';
import { BOSS_POSITION, DEPUTY_POSITION } from '../config/constants';

/**
 * Nhiệm vụ do chỉ huy (Trưởng / Phó Trưởng CA) giao cho MỘT cán bộ.
 *
 *   tasks/{id} = {
 *     title, content,
 *     assignerUid, assignerName,   – người giao
 *     assigneeUid, assigneeName,   – người nhận
 *     dueAt,                       – hạn hoàn thành (ms)
 *     status: 'pending' | 'submitted' | 'approved',
 *     rejectReason, rejectCount,   – lần từ chối gần nhất
 *     postponeCount, lastPostponeReason,
 *     submittedAt, approvedAt, createdAt, updatedAt,
 *     log: [{ type, at, byUid, byName, note, dueAt }]   – nhật ký
 *   }
 *
 * Chỉ người giao và người nhận đọc được (firestore.rules), nên mọi truy vấn
 * đều lọc theo đúng một trong hai trường uid đó.
 */
const tasksCol = () => collection(db, 'tasks');
const taskDoc = id => doc(db, 'tasks', id);

export const TASK_STATUS = {
  PENDING: 'pending',
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
};

/**
 * Cấp chỉ huy, tính theo CHỨC VỤ: 3 = Trưởng CA (hoặc role boss), 2 = Phó
 * Trưởng CA, 1 = cán bộ — tài khoản dev chức vụ "Cán bộ" vẫn là cán bộ.
 * Chỉ được giao nhiệm vụ cho người CẤP THẤP HƠN: Trưởng → Phó / cán bộ,
 * Phó → cán bộ. Giữ khớp commandRank() trong firestore.rules.
 */
export function commandRank(p) {
  if (!p) {
    return 0;
  }
  if (p.role === 'boss' || p.position === BOSS_POSITION) {
    return 3;
  }
  return p.position === DEPUTY_POSITION ? 2 : 1;
}

/** Người này có được giao nhiệm vụ cho NGƯỜI KHÁC không (Trưởng / Phó). */
export function isCommanderProfile(p) {
  const rank = commandRank(p);
  if (rank >= 3) {
    return true;
  }
  return rank === 2 && !!p.approved && p.active !== false;
}

/** Nhiệm vụ tự giao: người giao cũng là người nhận (nhắc việc cá nhân). */
export function isSelfTask(task) {
  return !!task && task.assignerUid === task.assigneeUid;
}

function logEntry(me, type, extra = {}) {
  return {
    type,
    at: Date.now(),
    byUid: me.uid,
    byName: displayNameOf(me),
    ...extra,
  };
}

const withId = d => ({ ...d.data(), id: d.id });

/**
 * Nhiệm vụ của tôi, live: `received` (tôi là người nhận) và `given` (tôi giao).
 * Chỉ gọi `onChange` khi cả hai truy vấn đã có snapshot đầu tiên.
 */
export function subscribeMyTasks(uid, onChange, onError) {
  let received = null;
  let given = null;
  const emit = () => {
    if (received && given) {
      onChange({ received, given });
    }
  };
  const fail = err => onError?.(err);
  const unsubA = onSnapshot(
    query(tasksCol(), where('assigneeUid', '==', uid)),
    snap => {
      received = snap.docs.map(withId);
      emit();
    },
    fail,
  );
  const unsubB = onSnapshot(
    query(tasksCol(), where('assignerUid', '==', uid)),
    snap => {
      given = snap.docs.map(withId);
      emit();
    },
    fail,
  );
  return () => {
    unsubA();
    unsubB();
  };
}

/**
 * Những người tôi được giao nhiệm vụ: tài khoản đang hoạt động, đã duyệt, và
 * CẤP THẤP HƠN tôi. Chỉ chỉ huy mới đọc được danh sách này (firestore.rules).
 */
export function subscribeAssignableUsers(me, onChange, onError) {
  const myRank = commandRank(me);
  return onSnapshot(
    query(collection(db, 'users'), where('active', '==', true)),
    snap => {
      const list = snap.docs
        .map(d => ({ ...d.data(), uid: d.id }))
        .filter(u => u.uid !== me.uid && u.approved)
        .filter(u => commandRank(u) < myRank)
        // Cấp cao trước (Phó trước cán bộ), cùng cấp thì theo tên.
        .sort(
          (a, b) =>
            commandRank(b) - commandRank(a) ||
            displayNameOf(a).localeCompare(displayNameOf(b), 'vi'),
        );
      onChange(list);
    },
    err => onError?.(err),
  );
}

/** `assignee` = chính `me` khi cán bộ tự giao nhiệm vụ cho bản thân. */
export async function createTask(me, assignee, { title, content, dueAt }) {
  const now = Date.now();
  await addDoc(tasksCol(), {
    title: title.trim(),
    content: (content || '').trim(),
    assignerUid: me.uid,
    assignerName: displayNameOf(me),
    assigneeUid: assignee.uid,
    assigneeName: displayNameOf(assignee),
    dueAt,
    status: TASK_STATUS.PENDING,
    rejectReason: null,
    rejectCount: 0,
    postponeCount: 0,
    lastPostponeReason: null,
    submittedAt: null,
    approvedAt: null,
    createdAt: now,
    updatedAt: now,
    log: [logEntry(me, 'created', { dueAt })],
  });
}

/** Người giao sửa tiêu đề / nội dung / hạn khi nhiệm vụ còn đang làm. */
export async function updateTaskInfo(me, task, { title, content, dueAt }) {
  await updateDoc(taskDoc(task.id), {
    title: title.trim(),
    content: (content || '').trim(),
    dueAt,
    updatedAt: Date.now(),
    log: arrayUnion(logEntry(me, 'edited', { dueAt })),
  });
}

/** Người nhận báo "Hoàn thành" → chờ người giao duyệt. */
export async function submitTask(me, task) {
  const now = Date.now();
  await updateDoc(taskDoc(task.id), {
    status: TASK_STATUS.SUBMITTED,
    submittedAt: now,
    updatedAt: now,
    log: arrayUnion(logEntry(me, 'submitted')),
  });
}

/** Người nhận "Hoãn": dời hạn sang thời điểm muộn hơn, kèm lý do. */
export async function postponeTask(me, task, newDueAt, reason) {
  const note = (reason || '').trim();
  await updateDoc(taskDoc(task.id), {
    dueAt: newDueAt,
    postponeCount: (task.postponeCount || 0) + 1,
    lastPostponeReason: note || null,
    updatedAt: Date.now(),
    log: arrayUnion(logEntry(me, 'postponed', { dueAt: newDueAt, note })),
  });
}

/** Nhiệm vụ tự giao: "Hoàn thành" là xong luôn, không qua bước duyệt. */
export async function completeSelfTask(me, task) {
  const now = Date.now();
  await updateDoc(taskDoc(task.id), {
    status: TASK_STATUS.APPROVED,
    submittedAt: now,
    approvedAt: now,
    updatedAt: now,
    log: arrayUnion(logEntry(me, 'completed')),
  });
}

/** Báo hoàn thành — tự giao thì xong luôn, việc được giao thì chờ duyệt. */
export async function finishTask(me, task) {
  if (isSelfTask(task)) {
    await completeSelfTask(me, task);
  } else {
    await submitTask(me, task);
  }
}

export async function approveTask(me, task) {
  const now = Date.now();
  await updateDoc(taskDoc(task.id), {
    status: TASK_STATUS.APPROVED,
    approvedAt: now,
    updatedAt: now,
    log: arrayUnion(logEntry(me, 'approved')),
  });
}

/** Từ chối: bắt buộc lý do + hạn mới; nhiệm vụ quay lại "đang làm". */
export async function rejectTask(me, task, reason, newDueAt) {
  const note = reason.trim();
  await updateDoc(taskDoc(task.id), {
    status: TASK_STATUS.PENDING,
    rejectReason: note,
    rejectCount: (task.rejectCount || 0) + 1,
    dueAt: newDueAt,
    updatedAt: Date.now(),
    log: arrayUnion(logEntry(me, 'rejected', { dueAt: newDueAt, note })),
  });
}

export async function deleteTask(task) {
  await deleteDoc(taskDoc(task.id));
}

/**
 * Báo hoàn thành chỉ từ id — dùng cho nút "Hoàn thành" ngay trên thông báo
 * (app có thể đang tắt, không có sẵn danh sách nhiệm vụ). Bỏ qua nếu nhiệm vụ
 * không còn ở trạng thái đang làm.
 */
export async function submitTaskById(taskId, me) {
  const snap = await getDoc(taskDoc(taskId));
  if (!snap.exists()) {
    return false;
  }
  const task = { ...snap.data(), id: snap.id };
  if (task.status !== TASK_STATUS.PENDING || task.assigneeUid !== me.uid) {
    return false;
  }
  await finishTask(me, task);
  return true;
}
