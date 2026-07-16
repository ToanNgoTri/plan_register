import { useEffect, useRef } from 'react';
import { subscribeDailyEntries } from '../services/planService';
import { displayBossAlert } from '../services/notificationService';
/**
 * Mounted only for the boss. Listens to today's registrations in real time and
 * fires a local notification whenever a NEW plan is registered.
 *
 * This is the no-server substitute for FCM push: it works while the boss's app
 * is running (foreground/background). True push while the app is killed would
 * require a server (Cloud Functions) to send FCM to the stored fcmToken.
 */
export default function BossAlertListener() {
  const seen = useRef(null);
  useEffect(() => {
    const unsub = subscribeDailyEntries(new Date(), entries => {
      // First snapshot establishes the baseline without alerting.
      if (seen.current === null) {
        seen.current = new Set(entries.map(e => e.uid));
        return;
      }
      for (const e of entries) {
        if (!seen.current.has(e.uid)) {
          seen.current.add(e.uid);
          displayBossAlert(
            `${e.displayName} vừa đăng ký công tác`,
            e.content, // show WHAT was registered, not a generic message
          ).catch(() => {});
        }
      }
    });
    return unsub;
  }, []);
  return null;
}
