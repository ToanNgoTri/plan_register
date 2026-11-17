import { doc, collection } from '@react-native-firebase/firestore';
import { db } from './firebase';

/**
 * Đơn vị (xã/phường) của người đang đăng nhập — gốc của mọi đường dẫn dữ liệu
 * nghiệp vụ: `units/{unitId}/history/...`, `units/{unitId}/duty_schedules/...`,
 * `units/{unitId}/doc_numbers/...`.
 *
 * AuthContext đặt giá trị này NGAY KHI nhận hồ sơ (trước khi render các tab),
 * nên service không phải nhận unitId qua từng lời gọi. Chưa có đơn vị thì ném
 * lỗi thay vì lặng lẽ ghi vào một đường dẫn sai.
 */
let currentUnitId = '';

export function setCurrentUnitId(id) {
  currentUnitId = id || '';
}

export function getCurrentUnitId() {
  if (!currentUnitId) {
    throw new Error('Tài khoản chưa chọn đơn vị.');
  }
  return currentUnitId;
}

/** collection(db, 'units', unitId, ...segments) */
export function unitCollection(...segments) {
  return collection(db, 'units', getCurrentUnitId(), ...segments);
}

/** doc(db, 'units', unitId, ...segments) */
export function unitDoc(...segments) {
  return doc(db, 'units', getCurrentUnitId(), ...segments);
}
