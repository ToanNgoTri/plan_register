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

/**
 * Các loại văn bản có thể lấy số (theo danh mục tên loại và chữ viết tắt của
 * Nghị định 30/2020/NĐ-CP, rút gọn cho phần việc của đơn vị).
 *
 *   id    – khoá kỹ thuật, CHỈ dùng ASCII vì nó nằm trong id document đếm số
 *           (`doc_number_counters/{năm}-{id}`) và trong truy vấn lọc.
 *   abbr  – chữ viết tắt in ra trong số văn bản, giữ nguyên dấu tiếng Việt.
 *           Công văn không có chữ viết tắt → số văn bản chỉ có phần số.
 *   label – tên loại văn bản hiển thị cho người dùng.
 *
 * Mỗi loại có MỘT dãy số riêng, đếm lại từ 1 mỗi năm — xem docNumberService.
 * Không đổi `id` của một loại đã dùng, nếu không dãy số của nó sẽ bị đếm lại.
 */
/**
 * Danh mục loại văn bản MẶC ĐỊNH — chỉ dùng khi đơn vị chưa có danh mục riêng.
 * Danh mục thật nằm trong Firestore (`doc_number_options/lists.types`) để Trưởng
 * CA thêm/bớt loại ngay trên app, không phải chờ bản cập nhật; xem
 * `subscribeDocNumberOptions`.
 *
 * `id` là thứ đi vào id của bộ đếm (`2026-QD`), của khoá (`QD`) và vào từng văn
 * bản đã cấp số, nên KHÔNG bao giờ được đổi hay dùng lại cho loại khác.
 */
export const DEFAULT_DOC_TYPES = [
  { id: 'NQ', abbr: 'NQ', label: 'Nghị quyết (cá biệt)' },
  { id: 'QD', abbr: 'QĐ', label: 'Quyết định (cá biệt)' },
  { id: 'CT', abbr: 'CT', label: 'Chỉ thị' },
  { id: 'QC', abbr: 'QC', label: 'Quy chế' },
  { id: 'QYD', abbr: 'QYĐ', label: 'Quy định' },
  { id: 'TC', abbr: 'TC', label: 'Thông cáo' },
  { id: 'TB', abbr: 'TB', label: 'Thông báo' },
  { id: 'HD', abbr: 'HD', label: 'Hướng dẫn' },
  { id: 'CTr', abbr: 'CTr', label: 'Chương trình' },
  { id: 'KH', abbr: 'KH', label: 'Kế hoạch' },
  { id: 'PA', abbr: 'PA', label: 'Phương án' },
  { id: 'DA', abbr: 'ĐA', label: 'Đề án' },
  { id: 'BC', abbr: 'BC', label: 'Báo cáo' },
  { id: 'TTr', abbr: 'TTr', label: 'Tờ trình' },
  { id: 'CV', abbr: '', label: 'Công văn' },
  { id: 'GUQ', abbr: 'GUQ', label: 'Giấy ủy quyền' },
  { id: 'GM', abbr: 'GM', label: 'Giấy mời' },
  { id: 'GGT', abbr: 'GGT', label: 'Giấy giới thiệu' },
  { id: 'GNP', abbr: 'GNP', label: 'Giấy nghỉ phép' },
  { id: 'DN', abbr: 'ĐN', label: 'Đề nghị' },
  { id: 'NX', abbr: 'NX', label: 'Nhận xét' },
];

/**
 * Khoá "đang lấy số", MỖI LOẠI VĂN BẢN MỘT KHOÁ: cùng một loại thì mỗi lần chỉ
 * một người được nhập (để không lấy trùng số), còn hai loại khác nhau là hai
 * dãy số độc lập nên chạy song song được.
 *
 * Khoá tự hết hạn sau DOC_LOCK_TTL_MS nếu app của người giữ bị tắt đột ngột
 * (không nhả khoá được); trong lúc còn mở form, màn hình gia hạn khoá mỗi
 * DOC_LOCK_HEARTBEAT_MS. Nhịp gia hạn phải NGẮN HƠN HẲN thời gian sống, nếu
 * không khoá sẽ hết hạn ngay giữa lúc người ta đang gõ.
 */
export const DOC_LOCK_TTL_MS = 2 * 60 * 1000;
export const DOC_LOCK_HEARTBEAT_MS = 30 * 1000;

/**
 * Danh mục NGƯỜI KÝ và ĐƠN VỊ BAN HÀNH mặc định.
 *
 * Đây chỉ là bản dự phòng dùng khi `doc_number_options/lists` chưa có trên
 * Firestore. Danh mục thật nằm trong database để Trưởng CA sửa được ngay trên
 * app (thêm/bớt cán bộ, đổi tên tổ) mà không phải phát hành bản cập nhật —
 * xem subscribeDocNumberOptions trong services/docNumberService.
 */
export const DEFAULT_SIGNERS = [
  'Phạm Nguyên Khánh',
  'Nguyễn Minh Sang',
  'Nguyễn Phi Viết',
  'Nguyễn Việt Mạnh',
  'Hoàng Ngọc Thắng',
  'Nguyễn Văn Quyết',
];
export const DEFAULT_ISSUING_UNITS = [
  'Tổ An ninh',
  'Tổ PCTP',
  'Tổ CSKV',
  'Tổ Trật tự',
  'Tổ Tổng hợp',
];
