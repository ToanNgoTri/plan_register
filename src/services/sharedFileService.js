/**
 * Nhận tệp "chuyển lịch" người dùng chia sẻ từ Zalo sang app.
 *
 * Module native sống trong chính app (android/app/.../sharedfile,
 * ios/PlanRegister/SharedFile.mm) nên bản JS chạy trên một bản build cũ sẽ
 * không có nó. Vì vậy mọi thứ ở đây phải chịu được trường hợp không có native:
 * không có thì đơn giản là không bao giờ có tệp nào tới.
 *
 * Ngoài phần bọc native, file này giữ MỘT tệp đang chờ đăng (`incoming`):
 * listener nhận tệp ở cấp điều hướng, còn màn hình Lịch trực mới là nơi mở
 * bảng đăng — mà màn hình đó có thể chưa được dựng lúc tệp tới (tab lười).
 */
let Native = null;
try {
  Native = require('../specs/NativeSharedFile').default;
} catch (e) {
  Native = null;
}

/**
 * Lấy tệp đang chờ (nếu app vừa được mở bằng một tệp chia sẻ) và đánh dấu đã
 * nhận. Trả về null khi không có gì — đây là trường hợp thường gặp nhất.
 */
export async function takePendingFile() {
  if (!Native) {
    return null;
  }
  try {
    return await Native.takePendingFile();
  } catch (e) {
    console.log('Không đọc được tệp chia sẻ:', e?.message);
    return null;
  }
}

/**
 * Nghe sự kiện "vừa có tệp mới chia sẻ sang" (app đang chạy sẵn). Trả về hàm gỡ
 * listener — gọi trong cleanup của useEffect.
 */
export function addFileSharedListener(handler) {
  if (!Native || !Native.onFileShared) {
    return () => {};
  }
  const subscription = Native.onFileShared(handler);
  return () => subscription.remove();
}

// ===== Tệp đang chờ đăng =====

let incoming = null;
const listeners = new Set();

/** Ghi nhận tệp vừa nhận (đã chuẩn hoá) và báo cho màn hình đang nghe. */
export function setIncomingDutyFile(file) {
  incoming = file;
  listeners.forEach(listener => listener(file));
}

/**
 * Lấy tệp đang chờ và XOÁ khỏi hàng chờ — mỗi tệp chỉ mở bảng đăng đúng một
 * lần, quay lại tab Lịch trực sau đó không bật lại bảng.
 */
export function takeIncomingDutyFile() {
  const file = incoming;
  incoming = null;
  return file;
}

/** Nghe tệp mới tới. Trả về hàm huỷ đăng ký. */
export function subscribeIncomingDutyFile(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
