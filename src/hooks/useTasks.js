import { useSyncExternalStore } from 'react';
import { TASK_STATUS } from '../services/taskService';

/**
 * Kho nhiệm vụ dùng chung: TaskReminderSync giữ MỘT listener Firestore và đổ
 * kết quả vào đây; màn Nhiệm vụ và số đỏ trên tab chỉ đọc lại, không mở thêm
 * listener riêng.
 */
const EMPTY = { ready: false, received: [], given: [], error: null };
let state = EMPTY;
const listeners = new Set();

export function setTaskState(next) {
  state = next;
  listeners.forEach(l => l());
}

export function resetTaskState() {
  setTaskState(EMPTY);
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => state;

export function useTasks() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Số việc cần tôi xử lý: nhiệm vụ được giao còn đang làm + nhiệm vụ tôi giao
 * đang chờ tôi duyệt. Hiện thành số đỏ trên tab "Nhiệm vụ".
 */
export function useTaskBadge() {
  const { received, given } = useTasks();
  const n =
    received.filter(t => t.status === TASK_STATUS.PENDING).length +
    given.filter(t => t.status === TASK_STATUS.SUBMITTED).length;
  return n > 0 ? n : undefined;
}
