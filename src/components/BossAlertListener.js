import { useEffect, useRef } from 'react';
import { subscribeDailyEntries } from '../services/planService';
import { displayBossAlert } from '../services/notificationService';
import { useToday } from '../hooks/useToday';
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
  // Sang ngày mới → chuyển listener sang ngày mới (nếu không, app mở qua đêm sẽ
  // vẫn theo dõi ngày cũ và không báo đăng ký của ngày hôm nay).
  const today = useToday();
  useEffect(() => {
    // Ngày mới → dựng lại baseline, tránh báo lại toàn bộ entry đầu tiên.
    seen.current = null;
    const unsub = subscribeDailyEntries(today, entries => {
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
  }, [today]);
  return null;
}
