/**
 * @format
 */

import { AppRegistry } from 'react-native';
import notifee, { EventType } from '@notifee/react-native';
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';
import App from './App';
import { name as appName } from './app.json';

// Handle notification interactions while the app is in the background / quit.
notifee.onBackgroundEvent(async ({ type }) => {
  // No special routing needed; pressing the notification opens the app.
  if (type === EventType.PRESS) {
    // Optionally deep-link here.
  }
});

// Required so FCM data messages don't crash when received in the background.
// (Real push delivery needs a server; this just keeps the handler registered.)
try {
  setBackgroundMessageHandler(getMessaging(), async () => {});
} catch {
  // messaging may be unavailable in some dev setups; ignore.
}

AppRegistry.registerComponent(appName, () => App);
