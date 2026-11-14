/**
 * @format
 */

import { AppRegistry } from 'react-native';
import notifee, { EventType } from '@notifee/react-native';
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';
import App from './App';
import {
  handleTaskNotificationEvent,
  syncTaskFromPush,
} from './src/services/taskNotificationService';
import { name as appName } from './app.json';

// Handle notification interactions while the app is in the background / quit.
notifee.onBackgroundEvent(async event => {
  // Nút "Hoàn thành" / "Hoãn" trên thông báo nhiệm vụ đến hạn.
  if (await handleTaskNotificationEvent(event).catch(() => false)) {
    return;
  }
  // No special routing needed; pressing the notification opens the app.
  if (event.type === EventType.PRESS) {
    // Optionally deep-link here.
  }
});

// Required so FCM data messages don't crash when received in the background.
// (Real push delivery needs a server; this just keeps the handler registered.)
try {
  setBackgroundMessageHandler(getMessaging(), async message => {
    // Push sự kiện nhiệm vụ → hẹn ngay chuông đến hạn trên máy này.
    if (message?.data?.kind === 'task') {
      await syncTaskFromPush(message.data.taskId, message.data.toUid).catch(
        () => {},
      );
    }
  });
} catch {
  // messaging may be unavailable in some dev setups; ignore.
}

AppRegistry.registerComponent(appName, () => App);
