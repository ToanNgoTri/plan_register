import notifee, {
  AndroidImportance,
  AuthorizationStatus,
  TriggerType,
  TimestampTrigger,
} from '@notifee/react-native';
import { getMessaging, getToken } from '@react-native-firebase/messaging';
import { app } from './firebase';
import {
  ANDROID_CHANNEL_ID,
  REMINDER_HOUR,
  REMINDER_MINUTE,
} from '../config/constants';
import { isWeekend, toDateKey } from '../utils/date';
const REMINDER_ID_PREFIX = 'reminder-';

/** Ask for notification permission and create the Android channel. */
export async function setupNotifications() {
  const settings = await notifee.requestPermission();
  await notifee.createChannel({
    id: ANDROID_CHANNEL_ID,
    name: 'Nhắc đăng ký kế hoạch',
    importance: AndroidImportance.HIGH,
  });
  return (
    settings.authorizationStatus === AuthorizationStatus.AUTHORIZED ||
    settings.authorizationStatus === AuthorizationStatus.PROVISIONAL
  );
}

/** The upcoming `count` weekday reminder datetimes (08:00 local), future only. */
function nextWeekdayReminders(count) {
  const out = [];
  const cursor = new Date();
  // Look at most ~3 weeks ahead to gather `count` weekdays.
  for (let i = 0; i < 21 && out.length < count; i++) {
    const d = new Date(cursor);
    d.setDate(cursor.getDate() + i);
    if (isWeekend(d)) {
      continue;
    }
    d.setHours(REMINDER_HOUR, REMINDER_MINUTE, 0, 0);
    if (d.getTime() > Date.now()) {
      out.push(d);
    }
  }
  return out;
}

/**
 * (Re)schedules the daily 08:00 reminders for the upcoming weekdays, skipping
 * Sat/Sun. Call on every app launch (for approved staff only) so the schedule
 * stays topped up. Days the user has already registered can be passed in
 * `skipDateKeys` to avoid nagging.
 *
 * Note: bosses do not register, so this must NOT be called for them.
 */
export async function scheduleWeekdayReminders(skipDateKeys = []) {
  // Clear our previously scheduled reminders (leave other notifications alone).
  const ids = await notifee.getTriggerNotificationIds();
  await Promise.all(
    ids
      .filter(id => id.startsWith(REMINDER_ID_PREFIX))
      .map(id => notifee.cancelTriggerNotification(id)),
  );
  const skip = new Set(skipDateKeys);
  const targets = nextWeekdayReminders(10);
  for (const when of targets) {
    const key = toDateKey(when);
    if (skip.has(key)) {
      continue;
    }
    const trigger = {
      type: TriggerType.TIMESTAMP,
      timestamp: when.getTime(),
    };
    await notifee.createTriggerNotification(
      {
        id: `${REMINDER_ID_PREFIX}${key}`,
        title: 'Nhắc đăng ký kế hoạch',
        body: 'Bạn chưa đăng ký kế hoạch công tác hôm nay. Vào app để đăng ký nhé!',
        android: {
          channelId: ANDROID_CHANNEL_ID,
          pressAction: {
            id: 'default',
          },
        },
      },
      trigger,
    );
  }
}
export async function cancelAllReminders() {
  const ids = await notifee.getTriggerNotificationIds();
  await Promise.all(
    ids
      .filter(id => id.startsWith(REMINDER_ID_PREFIX))
      .map(id => notifee.cancelTriggerNotification(id)),
  );
}

/** Immediate local notification — used to alert the boss of a new plan. */
export async function displayBossAlert(title, body) {
  await notifee.displayNotification({
    title,
    body,
    android: {
      channelId: ANDROID_CHANNEL_ID,
      pressAction: {
        id: 'default',
      },
    },
  });
}

/**
 * Capture the FCM token (stored on the profile). Delivery of real push
 * notifications requires a server (e.g. Cloud Functions) and is out of scope
 * for the current no-server design, but the token is kept for future use.
 */
export async function getFcmToken() {
  try {
    return await getToken(getMessaging(app));
  } catch {
    return null;
  }
}
