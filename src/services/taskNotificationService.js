import notifee, {
  AlarmType,
  AndroidImportance,
  AndroidVisibility,
  EventType,
  TriggerType,
} from '@notifee/react-native';
import { onAuthStateChanged } from '@react-native-firebase/auth';
import { doc, getDoc } from '@react-native-firebase/firestore';
import { auth, db } from './firebase';
import { submitTaskById, TASK_STATUS } from './taskService';
import { TASK_CHANNEL_ID } from '../config/constants';
import { formatDateTimeVi } from '../utils/date';

/**
 * Thông báo nhiệm vụ.
 *
 * 1. ĐẾN HẠN — thông báo hẹn giờ cục bộ (notifee trigger) trên máy của CẢ người
 *    nhận lẫn người giao, đổ chuông đúng giờ kể cả khi app tắt. Lịch hẹn được
 *    đồng bộ lại mỗi khi danh sách nhiệm vụ đổi (xem TaskReminderSync). Thông
 *    báo của người nhận có hai nút: "Hoàn thành" và "Hoãn".
 * 2. SỰ KIỆN (giao mới, báo hoàn thành, duyệt, từ chối, hoãn) — Cloud Function
 *    `onTaskWritten` đẩy FCM cho bên còn lại; khi app đang mở thì hiện lại
 *    bằng notifee (FCM không tự hiện lúc app ở tiền cảnh).
 */

const DUE_ID_PREFIX = 'task-due-';
export const TASK_CATEGORY_ID = 'task-due';
export const ACTION_COMPLETE = 'task-complete';
export const ACTION_POSTPONE = 'task-postpone';

/** Kênh có chuông + danh mục nút bấm (iOS). Gọi một lần lúc khởi động. */
export async function setupTaskNotifications() {
  await notifee.createChannel({
    id: TASK_CHANNEL_ID,
    name: 'Nhiệm vụ & hạn hoàn thành',
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PUBLIC,
    sound: 'default',
    vibration: true,
  });
  await notifee.setNotificationCategories([
    {
      id: TASK_CATEGORY_ID,
      actions: [
        { id: ACTION_COMPLETE, title: 'Hoàn thành' },
        // "Hoãn" cần chọn hạn mới → mở app.
        { id: ACTION_POSTPONE, title: 'Hoãn', foreground: true },
      ],
    },
  ]);
}

const dueId = taskId => `${DUE_ID_PREFIX}${taskId}`;

function dueNotification(task, asAssignee) {
  const base = {
    id: dueId(task.id),
    title: asAssignee
      ? `⏰ Đến hạn: ${task.title}`
      : `⏰ Nhiệm vụ của ${task.assigneeName} đã đến hạn`,
    body: asAssignee
      ? `${task.content ? `${task.content}\n` : ''}Hạn ${formatDateTimeVi(
          task.dueAt,
        )}${
          task.assignerUid === task.assigneeUid
            ? ' — việc tự giao'
            : ` — người giao: ${task.assignerName}`
        }`
      : `${task.title} (hạn ${formatDateTimeVi(task.dueAt)})`,
    data: { taskId: task.id, kind: 'task' },
    android: {
      channelId: TASK_CHANNEL_ID,
      importance: AndroidImportance.HIGH,
      sound: 'default',
      pressAction: { id: 'default' },
      ...(asAssignee
        ? {
            actions: [
              // Không launchActivity → xử lý ngầm, không mở app.
              { title: 'Hoàn thành', pressAction: { id: ACTION_COMPLETE } },
              {
                title: 'Hoãn',
                pressAction: { id: ACTION_POSTPONE, launchActivity: 'default' },
              },
            ],
          }
        : {}),
    },
    ios: {
      sound: 'default',
      ...(asAssignee ? { categoryId: TASK_CATEGORY_ID } : {}),
    },
  };
  return base;
}

async function scheduleOne(notification, timestamp) {
  try {
    await notifee.createTriggerNotification(notification, {
      type: TriggerType.TIMESTAMP,
      timestamp,
      alarmManager: { type: AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE },
    });
  } catch {
    // Máy không cho hẹn giờ chính xác → hẹn giờ thường (có thể trễ vài phút).
    await notifee.createTriggerNotification(notification, {
      type: TriggerType.TIMESTAMP,
      timestamp,
    });
  }
}

// Chữ ký của lần hẹn gần nhất, để không tạo lại trigger khi không có gì đổi.
const scheduled = new Map();

/**
 * Đồng bộ lịch chuông "đến hạn" với danh sách nhiệm vụ hiện tại: hẹn cho mọi
 * nhiệm vụ đang làm có hạn ở tương lai, huỷ những cái không còn cần.
 */
export async function syncTaskReminders(myUid, { received, given }) {
  const now = Date.now();
  const wanted = new Map();
  for (const t of received) {
    if (t.status === TASK_STATUS.PENDING && t.dueAt > now) {
      wanted.set(dueId(t.id), { task: t, asAssignee: true });
    }
  }
  for (const t of given) {
    // Tự giao: đã hẹn ở vòng trên (bản có nút Hoàn thành / Hoãn).
    if (t.assigneeUid === myUid) {
      continue;
    }
    if (t.status === TASK_STATUS.PENDING && t.dueAt > now) {
      wanted.set(dueId(t.id), { task: t, asAssignee: false });
    }
  }

  const existing = await notifee.getTriggerNotificationIds();
  await Promise.all(
    existing
      .filter(id => id.startsWith(DUE_ID_PREFIX) && !wanted.has(id))
      .map(id => {
        scheduled.delete(id);
        return notifee.cancelTriggerNotification(id);
      }),
  );
  const existingSet = new Set(existing);

  // Nhiệm vụ đã xong / bị xoá → gỡ luôn thông báo đến hạn còn nằm trên máy.
  const doneIds = [...received, ...given]
    .filter(t => t.status !== TASK_STATUS.PENDING)
    .map(t => dueId(t.id));
  await Promise.all(
    doneIds.map(id => notifee.cancelDisplayedNotification(id).catch(() => {})),
  );

  for (const [id, { task, asAssignee }] of wanted) {
    const sig = `${task.dueAt}|${task.title}|${task.content}|${asAssignee}`;
    if (scheduled.get(id) === sig && existingSet.has(id)) {
      continue;
    }
    await scheduleOne(dueNotification(task, asAssignee), task.dueAt);
    scheduled.set(id, sig);
  }
}

/**
 * Push sự kiện nhiệm vụ tới khi app đang ở nền / đã tắt (index.js): hẹn (hoặc
 * huỷ) ngay chuông đến hạn của nhiệm vụ đó, để người vừa được giao vẫn được
 * báo đúng giờ dù chưa mở app lần nào.
 */
export async function syncTaskFromPush(taskId, toUid) {
  const user = await currentUserReady();
  if (!user || !taskId || (toUid && toUid !== user.uid)) {
    return;
  }
  const id = dueId(taskId);
  const snap = await getDoc(doc(db, 'tasks', taskId));
  const task = snap.exists() ? { ...snap.data(), id: snap.id } : null;
  if (
    !task ||
    task.status !== TASK_STATUS.PENDING ||
    task.dueAt <= Date.now()
  ) {
    await notifee.cancelNotification(id);
    return;
  }
  await scheduleOne(
    dueNotification(task, task.assigneeUid === user.uid),
    task.dueAt,
  );
}

export async function cancelTaskReminders() {
  scheduled.clear();
  const ids = await notifee.getTriggerNotificationIds();
  await Promise.all(
    ids
      .filter(id => id.startsWith(DUE_ID_PREFIX))
      .map(id => notifee.cancelTriggerNotification(id)),
  );
}

/** Hiện một thông báo sự kiện nhiệm vụ (FCM tới lúc app đang mở). */
export async function displayTaskEvent(title, body, taskId) {
  await notifee.displayNotification({
    title,
    body,
    data: { taskId: taskId || '', kind: 'task' },
    android: {
      channelId: TASK_CHANNEL_ID,
      sound: 'default',
      pressAction: { id: 'default' },
    },
    ios: { sound: 'default' },
  });
}

// ---- mở app từ thông báo -------------------------------------------------
// Người dùng bấm thông báo / nút "Hoãn" → cần mở màn Nhiệm vụ (và hộp hoãn).
// Sự kiện có thể tới trước khi màn hình được dựng, nên giữ lại ở đây.
let pendingOpen = null;
const openListeners = new Set();

export function setPendingOpen(value) {
  pendingOpen = value;
  openListeners.forEach(l => l(value));
}

/** Lấy (và xoá) yêu cầu mở nhiệm vụ đang chờ: { taskId, action } | null. */
export function takePendingTaskOpen() {
  const v = pendingOpen;
  pendingOpen = null;
  return v;
}

export function hasPendingTaskOpen() {
  return pendingOpen != null;
}

export function addTaskOpenListener(listener) {
  openListeners.add(listener);
  return () => openListeners.delete(listener);
}

/** Chờ Firebase Auth khôi phục phiên (app vừa được đánh thức ở nền). */
function currentUserReady() {
  if (auth.currentUser) {
    return Promise.resolve(auth.currentUser);
  }
  return new Promise(resolve => {
    const unsub = onAuthStateChanged(auth, user => {
      unsub();
      resolve(user);
    });
  });
}

async function completeFromNotification(taskId) {
  const user = await currentUserReady();
  if (!user) {
    return;
  }
  const snap = await getDoc(doc(db, 'users', user.uid));
  const me = snap.exists() ? { ...snap.data(), uid: user.uid } : null;
  if (!me) {
    return;
  }
  try {
    // Thành công thì không hiện gì thêm — người giao sẽ nhận thông báo "báo
    // hoàn thành"; người nhận không cần tự nhận thông báo của chính mình.
    await submitTaskById(taskId, me);
  } catch (e) {
    await notifee.displayNotification({
      title: 'Không báo hoàn thành được',
      body: e?.message ?? 'Mở app để thử lại.',
      data: { taskId, kind: 'task' },
      android: { channelId: TASK_CHANNEL_ID, pressAction: { id: 'default' } },
    });
  }
}

/**
 * Xử lý bấm vào thông báo nhiệm vụ — dùng chung cho onForegroundEvent và
 * onBackgroundEvent. Trả về true nếu đó là thông báo nhiệm vụ.
 */
export async function handleTaskNotificationEvent({ type, detail }) {
  const taskId = detail?.notification?.data?.taskId;
  if (!taskId || detail?.notification?.data?.kind !== 'task') {
    return false;
  }
  const actionId = detail.pressAction?.id;
  if (type === EventType.ACTION_PRESS && actionId === ACTION_COMPLETE) {
    if (detail.notification?.id) {
      await notifee.cancelNotification(detail.notification.id);
    }
    await completeFromNotification(taskId);
    return true;
  }
  if (type === EventType.ACTION_PRESS && actionId === ACTION_POSTPONE) {
    if (detail.notification?.id) {
      await notifee.cancelNotification(detail.notification.id);
    }
    setPendingOpen({ taskId, action: 'postpone' });
    return true;
  }
  if (type === EventType.PRESS) {
    setPendingOpen({ taskId, action: 'open' });
    return true;
  }
  return false;
}

/** App mở nguội bằng cách bấm thông báo / nút "Hoãn". */
export async function checkInitialTaskNotification() {
  const initial = await notifee.getInitialNotification();
  if (!initial) {
    return;
  }
  const taskId = initial.notification?.data?.taskId;
  if (!taskId || initial.notification?.data?.kind !== 'task') {
    return;
  }
  setPendingOpen({
    taskId,
    action: initial.pressAction?.id === ACTION_POSTPONE ? 'postpone' : 'open',
  });
}
