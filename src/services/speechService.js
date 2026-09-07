import { PermissionsAndroid, Platform } from 'react-native';

/**
 * Lớp mỏng bọc module đọc chính tả native.
 *
 * Module sống trong chính app (android/app/.../speech, ios/PlanRegister/
 * SpeechRecognizer.mm) nên bản JS chạy trên một bản build cũ sẽ không có nó.
 * Vì vậy mọi thứ ở đây phải chịu được trường hợp không có native: `isSupported()`
 * trả về false và màn hình chỉ việc không hiện nút mic.
 */
let Native = null;
try {
  Native = require('../specs/NativeSpeechRecognizer').default;
} catch (e) {
  Native = null;
}

/** Bản build hiện tại có module native không. */
export function isSupported() {
  return Native != null;
}

/** Máy có bộ nhận dạng giọng nói dùng được không. */
export async function isAvailable() {
  if (!Native) {
    return false;
  }
  try {
    return await Native.isAvailable();
  } catch (e) {
    return false;
  }
}

/**
 * Xin quyền micro. iOS tự xin trong lúc start (cần cả quyền nhận dạng giọng
 * nói), nên ở đây chỉ lo phần Android.
 */
export async function ensureMicPermission() {
  if (Platform.OS !== 'android') {
    return true;
  }
  const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
  if (await PermissionsAndroid.check(permission)) {
    return true;
  }
  const result = await PermissionsAndroid.request(permission, {
    title: 'Cho phép dùng micro',
    message: 'Ứng dụng cần micro để đọc trích yếu văn bản thành chữ.',
    buttonPositive: 'Cho phép',
    buttonNegative: 'Không',
  });
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

/**
 * Bắt đầu nghe. Trả về false nếu người dùng từ chối quyền — khi đó màn hình nên
 * im lặng quay về trạng thái cũ chứ không báo lỗi.
 */
export async function start({ locale = 'vi-VN', punctuate = true } = {}) {
  if (!Native) {
    return false;
  }
  if (!(await ensureMicPermission())) {
    return false;
  }
  return Native.start({ locale, punctuate });
}

/** Dừng nghe, vẫn nhận nốt kết quả cuối của đoạn đang nói. */
export async function stop() {
  if (Native) {
    await Native.stop();
  }
}

/** Huỷ hẳn, bỏ luôn đoạn đang nói. */
export async function cancel() {
  if (Native) {
    await Native.cancel();
  }
}

/**
 * Đăng ký các callback. Trả về hàm gỡ tất cả — gọi trong cleanup của useEffect.
 * Callback nào không truyền thì bỏ qua.
 */
export function addListeners({
  onStart,
  onPartial,
  onFinal,
  onVolume,
  onEnd,
  onError,
} = {}) {
  if (!Native) {
    return () => {};
  }

  const pairs = [
    [Native.onSpeechStart, onStart],
    [Native.onSpeechPartial, onPartial],
    [Native.onSpeechFinal, onFinal],
    [Native.onSpeechVolume, onVolume],
    [Native.onSpeechEnd, onEnd],
    [Native.onSpeechError, onError],
  ];

  const subscriptions = pairs
    .filter(([emitter, handler]) => emitter && handler)
    .map(([emitter, handler]) => emitter(handler));

  return () => {
    subscriptions.forEach(sub => sub.remove());
  };
}
