import { Platform } from 'react-native';

/**
 * App-wide configuration.
 *
 * IMPORTANT: replace WEB_CLIENT_ID with the "Web client (auto created by
 * Google Service)" OAuth 2.0 client ID from the Firebase console:
 *   Firebase Console → Authentication → Sign-in method → Google → Web SDK
 *   configuration → Web client ID
 * (It is the same value found in google-services.json under
 *  client[].oauth_client[] with client_type == 3.)
 */
export const WEB_CLIENT_ID =
  '811727600503-s8qc79js99cfth5k4bl93vc4qk0s85ef.apps.googleusercontent.com';

/** Hour (24h, device local time) at which staff get the daily reminder. */
export const REMINDER_HOUR = 8;
export const REMINDER_MINUTE = 0;

/** Notifee channel id used for the daily reminder + boss alerts (Android). */
export const ANDROID_CHANNEL_ID = 'plan-register-default';

/**
 * Chức vụ (job title / rank) options a user can pick for their profile.
 *
 * NOTE: the `BOSS_POSITION` chức vụ grants boss permissions on its own —
 * anyone whose position is "Trưởng CA" is treated as a boss (full management +
 * approval), regardless of the stored `role`. Keep this string in sync with
 * the same literal in firestore.rules.
 */
export const POSITIONS = ['Trưởng CA', 'Phó Trưởng CA', 'Cán bộ'];
export const BOSS_POSITION = 'Trưởng CA';

/**
 * Các lực lượng có lịch trực riêng (2 tab con của màn hình Lịch trực).
 *
 * Mỗi lực lượng chỉ giữ ĐÚNG MỘT bản lịch hiện hành: đăng bản mới sẽ thay thế
 * bản cũ (document `duty_schedules/{id}` bị ghi đè, tệp cũ bị xoá khỏi
 * Storage) — xem services/dutyService. Giữ các `id` này khớp với danh sách
 * trong firestore.rules và storage.rules.
 */
export const FORCES = [
  { id: 'CA', label: 'CA', title: 'Công an' },
  { id: 'ANCS', label: 'ANCS', title: 'An ninh cơ sở' },
];

/** Kích thước tối đa của một tệp lịch trực. Phải khớp với storage.rules. */
export const DUTY_MAX_FILE_BYTES = 15 * 1024 * 1024;

/**
 * Trang cài đặt app trên store, theo từng nền tảng. Nút "Cập nhật ngay" của
 * ForceUpdateGate mở đúng link của nền tảng đang chạy (xem
 * versionService.resolveUpdateUrl để biết thứ tự ưu tiên).
 */
export const APP_STORE_URL = 'https://apps.apple.com/app/id6792317913';
export const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.planregister';
export const STORE_URL = Platform.select({
  ios: APP_STORE_URL,
  android: PLAY_STORE_URL,
  default: PLAY_STORE_URL,
});
