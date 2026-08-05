import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { fromDateKey, toDateKey } from '../utils/date';

/**
 * "Hôm nay" luôn cập nhật, kể cả khi app mở xuyên qua nửa đêm.
 *
 * Trước đây mỗi màn hình gọi `new Date()` một lần lúc mount, nên nếu app cứ mở
 * (hoặc chỉ nằm ở background) qua ngày mới thì màn hình vẫn treo ở ngày cũ.
 * Hook này phát hiện đổi ngày theo 3 nguồn:
 *   1. Hẹn giờ đúng thời điểm nửa đêm kế tiếp (app đang chạy foreground).
 *   2. Khi app quay lại foreground (đã bị OS treo timer lúc ở background).
 *   3. Nhịp kiểm tra mỗi phút — lưới an toàn cho trường hợp timer bị OS bóp,
 *      người dùng đổi múi giờ hoặc chỉnh lại đồng hồ máy.
 */

const CHECK_INTERVAL_MS = 60 * 1000;

/** Số ms còn lại tới 00:00:00 của ngày kế tiếp (giờ địa phương). */
function msUntilNextMidnight(now = new Date()) {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return Math.max(1000, next.getTime() - now.getTime());
}

/** Ngày hiện tại dạng "YYYY-MM-DD", tự đổi khi sang ngày mới. */
export function useTodayKey() {
  const [key, setKey] = useState(() => toDateKey());
  useEffect(() => {
    let midnightTimer = null;
    let alive = true;
    const sync = () => {
      if (!alive) {
        return;
      }
      const now = toDateKey();
      setKey(prev => (prev === now ? prev : now));
    };
    const armMidnight = () => {
      if (midnightTimer) {
        clearTimeout(midnightTimer);
      }
      // +1s để chắc chắn đồng hồ đã bước sang ngày mới khi callback chạy.
      midnightTimer = setTimeout(() => {
        sync();
        armMidnight();
      }, msUntilNextMidnight() + 1000);
    };
    armMidnight();
    const interval = setInterval(sync, CHECK_INTERVAL_MS);
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        // Timer bị treo khi ở background → kiểm tra lại và hẹn giờ lại ngay.
        sync();
        armMidnight();
      }
    });
    return () => {
      alive = false;
      if (midnightTimer) {
        clearTimeout(midnightTimer);
      }
      clearInterval(interval);
      sub.remove();
    };
  }, []);
  return key;
}

/**
 * Như `useTodayKey` nhưng trả về `Date` (0h00 hôm nay). Tham chiếu chỉ đổi khi
 * sang ngày mới, nên dùng trực tiếp làm dependency của useEffect/useCallback.
 */
export function useToday() {
  const key = useTodayKey();
  return useMemo(() => fromDateKey(key), [key]);
}

/**
 * Cho màn hình có ngày do người dùng chọn (lịch sử): khi sang ngày mới, nếu
 * người dùng đang xem "hôm nay" thì tự chuyển sang ngày mới; nếu họ đang xem
 * một ngày quá khứ thì giữ nguyên. Trả về date key của hôm nay.
 */
export function useFollowToday(setDate) {
  const todayKey = useTodayKey();
  const prevKey = useRef(todayKey);
  useEffect(() => {
    const before = prevKey.current;
    if (before === todayKey) {
      return;
    }
    prevKey.current = todayKey;
    setDate(prev =>
      toDateKey(prev) === before ? fromDateKey(todayKey) : prev,
    );
  }, [todayKey, setDate]);
  return todayKey;
}
