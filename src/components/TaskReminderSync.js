import { useEffect } from 'react';
import { AppState } from 'react-native';
import notifee from '@notifee/react-native';
import {
  getInitialNotification,
  onMessage,
  onNotificationOpenedApp,
} from '@react-native-firebase/messaging';
import { messaging } from '../services/firebase';
import { useAuth } from '../context/AuthContext';
import { subscribeMyTasks } from '../services/taskService';
import {
  addTaskOpenListener,
  checkInitialTaskNotification,
  displayTaskEvent,
  handleTaskNotificationEvent,
  hasPendingTaskOpen,
  setPendingOpen,
  syncTaskReminders,
} from '../services/taskNotificationService';
import { resetTaskState, setTaskState } from '../hooks/useTasks';
import { navigationRef } from '../navigation/navigationRef';

/**
 * Gắn khi đã đăng nhập và được dùng app (mọi vai trò). Nhiệm vụ:
 *  - giữ listener nhiệm vụ của tôi → đổ vào kho useTasks;
 *  - hẹn lại chuông "đến hạn" mỗi khi danh sách đổi (và khi app quay lại);
 *  - hiện FCM sự kiện nhiệm vụ khi app đang mở (FCM không tự hiện ở tiền cảnh);
 *  - bấm thông báo nhiệm vụ → chuyển sang tab Nhiệm vụ.
 */
export default function TaskReminderSync() {
  const { profile } = useAuth();
  const uid = profile?.uid;

  useEffect(() => {
    if (!uid) {
      return undefined;
    }
    let latest = null;
    const resync = () => {
      if (latest) {
        syncTaskReminders(uid, latest).catch(() => {});
      }
    };
    const unsub = subscribeMyTasks(
      uid,
      lists => {
        latest = lists;
        setTaskState({ ready: true, ...lists, error: null });
        resync();
      },
      error =>
        setTaskState({ ready: true, received: [], given: [], error }),
    );
    const appSub = AppState.addEventListener('change', s => {
      if (s === 'active') {
        resync();
      }
    });
    return () => {
      unsub();
      appSub.remove();
      resetTaskState();
    };
  }, [uid]);

  useEffect(() => {
    let alive = true;
    let timer = null;
    const goToTasks = (attempt = 0) => {
      if (!alive) {
        return;
      }
      if (navigationRef.isReady()) {
        navigationRef.navigate('Tasks');
      } else if (attempt < 20) {
        timer = setTimeout(() => goToTasks(attempt + 1), 250);
      }
    };
    const removeOpen = addTaskOpenListener(() => goToTasks());
    // Nút "Hoãn" có thể đã được xử lý ở onBackgroundEvent trước khi app dựng.
    if (hasPendingTaskOpen()) {
      goToTasks();
    }

    const unsubNotifee = notifee.onForegroundEvent(event => {
      handleTaskNotificationEvent(event).catch(() => {});
    });
    const unsubFcm = onMessage(messaging, msg => {
      if (msg?.data?.kind !== 'task') {
        return;
      }
      // Thông báo gửi cho tài khoản khác từng đăng nhập trên máy này → bỏ.
      if (msg.data.toUid && msg.data.toUid !== uid) {
        return;
      }
      displayTaskEvent(
        msg.notification?.title ?? 'Nhiệm vụ',
        msg.notification?.body ?? '',
        msg.data.taskId,
      ).catch(() => {});
    });
    const openFromFcm = msg => {
      if (msg?.data?.kind === 'task' && msg.data.taskId) {
        setPendingOpen({ taskId: msg.data.taskId, action: 'open' });
      }
    };
    const unsubOpened = onNotificationOpenedApp(messaging, openFromFcm);
    getInitialNotification(messaging).then(openFromFcm).catch(() => {});
    checkInitialTaskNotification().catch(() => {});

    return () => {
      alive = false;
      clearTimeout(timer);
      removeOpen();
      unsubNotifee();
      unsubFcm();
      unsubOpened();
    };
  }, [uid]);

  return null;
}
