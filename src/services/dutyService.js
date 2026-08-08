import {
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
} from '@react-native-firebase/firestore';
import { utils } from '@react-native-firebase/app';
import {
  deleteObject,
  getDownloadURL,
  putFile,
  ref,
  writeToFile,
} from '@react-native-firebase/storage';
import { viewDocument } from '@react-native-documents/viewer';
import ImageCropPicker from 'react-native-image-crop-picker';
import {
  errorCodes,
  isErrorWithCode,
  keepLocalCopy,
  pick,
  types,
} from '@react-native-documents/picker';
import { db, storage } from './firebase';
import { displayNameOf } from './userService';
import { DUTY_MAX_FILE_BYTES } from '../config/constants';

/**
 * Lịch trực của từng lực lượng (CA / ANCS).
 *
 * Mỗi lực lượng giữ ĐÚNG MỘT bản hiện hành tại:
 *   duty_schedules/{force}        force = 'CA' | 'ANCS'
 * Đăng bản mới ghi đè document đó và xoá tệp cũ trên Storage — KHÔNG lưu lịch
 * sử các bản đã thay thế. Bù lại, document luôn ghi rõ ai đăng và lúc nào
 * (`uploadedBy` / `uploadedByName` / `uploadedAt`) để truy được nguồn.
 *
 * Tệp gốc nằm ở  duty/{force}/{timestamp}-{tên tệp}. Tên có timestamp để mỗi
 * lần đăng lại sinh một URL khác — nếu dùng đường dẫn cố định thì app và CDN
 * sẽ tiếp tục hiển thị ảnh cũ đã cache.
 */

const MIME_DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function scheduleRef(force) {
  return doc(db, 'duty_schedules', force);
}

/**
 * Tên tệp an toàn cho đường dẫn Storage: bỏ dấu tiếng Việt và mọi ký tự lạ
 * (dấu cách, dấu ngoặc...) để URL tải về không bị mã hoá lung tung.
 */
function safeFileName(name) {
  const base = (name ?? 'lich-truc').trim();
  return (
    base
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(-80) || 'lich-truc'
  );
}

/** Bản lịch trực hiện hành của một lực lượng, cập nhật theo thời gian thực. */
export function subscribeDutySchedule(force, onChange, onError) {
  return onSnapshot(
    scheduleRef(force),
    snap => onChange(snap.exists() ? snap.data() : null),
    err => onError?.(err),
  );
}

/**
 * Mở thư viện ảnh để chọn ảnh chụp bảng lịch trực.
 * Trả về tệp đã chuẩn hoá, hoặc null nếu người dùng bấm huỷ.
 */
export async function pickScheduleImage() {
  try {
    const image = await ImageCropPicker.openPicker({
      mediaType: 'photo',
      cropping: false,
      // Ảnh chụp bảng lịch phải ĐỌC ĐƯỢC CHỮ, nên chỉ thu nhỏ nhẹ và nén ít —
      // khác hẳn ảnh đại diện (512px, chất lượng 0.7) ở SettingsScreen.
      //
      // KHÔNG ép sang JPEG: lịch trực thường là ảnh chụp màn hình file Word,
      // vốn là PNG. Nén JPEG lên chữ nhỏ và đường kẻ bảng sẽ tạo viền nhoè,
      // đúng chỗ người dùng cần phóng to để đọc tên và số điện thoại.
      // (compressImageQuality chỉ áp dụng cho ảnh JPEG, PNG giữ nguyên.)
      compressImageMaxWidth: 2400,
      compressImageMaxHeight: 2400,
      compressImageQuality: 0.9,
    });
    return {
      uri: image.path,
      name: image.filename ?? `lich-truc-${image.modificationDate ?? ''}.jpg`,
      type: image.mime ?? 'image/jpeg',
      size: image.size ?? null,
      kind: 'image',
    };
  } catch (e) {
    if (e?.code === 'E_PICKER_CANCELLED') {
      return null;
    }
    throw e;
  }
}

/**
 * Mở trình chọn tệp, giới hạn ở .doc/.docx.
 * Trả về tệp đã chuẩn hoá, hoặc null nếu người dùng bấm huỷ.
 */
export async function pickScheduleDocx() {
  try {
    const [picked] = await pick({
      mode: 'import',
      type: [types.docx, types.doc],
    });
    const name = picked.name ?? 'lich-truc.docx';
    // Android trả về `content://` (và có thể là tệp ảo trên Drive), nên phải
    // sao vào thư mục cache của app để putFile có đường dẫn tệp thật.
    const [copy] = await keepLocalCopy({
      files: [{ uri: picked.uri, fileName: name }],
      destination: 'cachesDirectory',
    });
    if (copy.status !== 'success') {
      throw new Error(copy.copyError || 'Không đọc được tệp đã chọn.');
    }
    return {
      uri: copy.localUri,
      name,
      type: picked.type ?? MIME_DOCX,
      size: picked.size ?? null,
      kind: 'docx',
    };
  } catch (e) {
    if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) {
      return null;
    }
    throw e;
  }
}

/**
 * Đăng lịch trực mới cho `force`, THAY THẾ bản đang có.
 *
 * Thứ tự cố ý: tải tệp mới lên → ghi document → mới xoá tệp cũ. Nếu bước nào
 * hỏng giữa chừng thì bản cũ vẫn còn nguyên, người dùng không bị mất lịch.
 */
export async function uploadDutySchedule({ force, user, file, note = '' }) {
  if (file.size && file.size > DUTY_MAX_FILE_BYTES) {
    throw new Error(
      `Tệp quá lớn (tối đa ${Math.round(
        DUTY_MAX_FILE_BYTES / 1024 / 1024,
      )}MB). Vui lòng chọn tệp nhỏ hơn.`,
    );
  }
  const previous = await getDoc(scheduleRef(force));
  const storagePath = `duty/${force}/${Date.now()}-${safeFileName(file.name)}`;
  const fileRef = ref(storage, storagePath);
  await putFile(fileRef, file.uri, {
    contentType: file.type ?? undefined,
  });
  const fileUrl = await getDownloadURL(fileRef);
  await setDoc(scheduleRef(force), {
    force,
    fileType: file.kind,
    fileName: file.name,
    mimeType: file.type ?? null,
    size: file.size ?? null,
    storagePath,
    fileUrl,
    note: note.trim(),
    uploadedBy: user.uid,
    uploadedByName: displayNameOf(user),
    uploadedAt: Date.now(),
  });

  // Bản cũ đã bị thay thế → dọn tệp trên Storage. Lỗi ở đây không ảnh hưởng
  // người dùng (bản mới đã lưu xong), chỉ để lại một tệp mồ côi.
  const oldPath = previous.exists() ? previous.data().storagePath : null;
  if (oldPath && oldPath !== storagePath) {
    await deleteObject(ref(storage, oldPath)).catch(() => {});
  }
}

/**
 * Mở tệp Word bằng trình xem tài liệu có sẵn của hệ điều hành.
 *
 * React Native không hiển thị được .docx trong app, nên phải tải tệp về thư
 * mục cache rồi nhờ hệ điều hành mở: iOS dùng QuickLook (đọc .docx sẵn, không
 * cần cài Word), Android bắn intent cho ứng dụng đọc văn bản trên máy.
 *
 * Luôn tải lại chứ không dùng bản cache cũ — lịch trực có thể vừa bị thay thế.
 * Ném lỗi nếu máy không có ứng dụng nào mở được .docx (chỉ xảy ra trên
 * Android); màn hình gọi hàm này sẽ đề nghị mở bằng trình duyệt thay thế.
 */
export async function openScheduleDocument(schedule) {
  const dir = utils.FilePath.CACHES_DIRECTORY;
  const localPath = `${dir}/duty-${schedule.force}-${safeFileName(
    schedule.fileName,
  )}`;
  await writeToFile(ref(storage, schedule.storagePath), localPath);
  await viewDocument({
    uri: `file://${localPath}`,
    mimeType: schedule.mimeType ?? undefined,
    headerTitle: schedule.fileName,
    // Android: tệp nằm trong vùng lưu trữ riêng của app, phải cấp quyền đọc
    // cho ứng dụng được gọi để mở.
    grantPermissions: 'read',
  });
}

/** Gỡ hẳn lịch trực của một lực lượng (document + tệp trên Storage). */
export async function deleteDutySchedule(force) {
  const snap = await getDoc(scheduleRef(force));
  if (!snap.exists()) {
    return;
  }
  const { storagePath } = snap.data();
  await deleteDoc(scheduleRef(force));
  if (storagePath) {
    await deleteObject(ref(storage, storagePath)).catch(() => {});
  }
}
