import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  where,
} from '@react-native-firebase/firestore';
import { db } from './firebase';
import { displayNameOf } from './userService';
import {
  DEFAULT_ISSUING_UNITS,
  DEFAULT_SIGNERS,
  DOC_LOCK_TTL_MS,
  DOC_TYPES,
} from '../config/constants';

/**
 * Sổ số văn bản: cấp số cho từng văn bản đi và lưu lại lịch sử đã cấp.
 *
 * Firestore:
 *   doc_numbers/{autoId}                       – một văn bản đã lấy số
 *   doc_number_counters/{năm}-{loại}           – { next } : số sẽ cấp tiếp theo
 *   doc_number_suffixes/{năm}-{loại}-{số}      – { next } : chữ cái phụ kế tiếp
 *   doc_number_locks/global                    – ai đang mở form lấy số
 *   doc_number_options/lists                   – danh mục người ký / đơn vị
 *
 * HAI thứ phải tuyệt đối không được chạy song song, và cả hai đều dựa trên
 * transaction chứ không dựa vào giao diện:
 *
 *  1. KHOÁ NHẬP LIỆU. Mỗi lần chỉ một người được mở form lấy số; những người
 *     khác nhìn thấy tên người đang nhập và không bấm được. Đây là ràng buộc
 *     nghiệp vụ (sổ số văn bản chỉ có một, một người cầm một lúc), nên khoá là
 *     khoá CHUNG cho mọi loại văn bản chứ không phải mỗi loại một khoá.
 *
 *  2. CẤP SỐ. Số tiếp theo được đọc và tăng trong cùng một transaction với việc
 *     ghi văn bản, nên kể cả khi khoá bị hết hạn và hai người cùng bấm lưu thì
 *     vẫn không ai lấy trùng số của ai.
 *
 * Có HAI kiểu cấp số, dùng hai bộ đếm khác nhau:
 *
 *   - SỐ MỚI  → lấy số tiếp theo của loại đó trong năm (12, 13, 14...).
 *   - SỐ PHỤ  → giữ nguyên một số đã cấp và thêm chữ cái (12A, 12B...). Dùng
 *               khi văn bản mới gắn liền với một văn bản đã phát hành. Số phụ
 *               KHÔNG đụng vào bộ đếm chính, nên không làm nhảy số của cả sổ.
 *
 * Khoá tự hết hạn (`expiresAt`) vì không thể tin app luôn nhả khoá — người
 * dùng có thể tắt máy giữa chừng. Hạn dùng đồng hồ của máy người giữ khoá; lệch
 * giờ vài phút chỉ làm khoá hết hạn sớm/muộn tương ứng, không cấp trùng số
 * (điểm 2 mới là thứ bảo đảm số không trùng).
 */

const LOCK_ID = 'global';

const numbersCol = () => collection(db, 'doc_numbers');
const lockRef = () => doc(db, 'doc_number_locks', LOCK_ID);
const counterRef = (year, typeId) =>
  doc(db, 'doc_number_counters', `${year}-${typeId}`);
const suffixRef = (year, typeId, seq) =>
  doc(db, 'doc_number_suffixes', `${year}-${typeId}-${seq}`);
const optionsRef = () => doc(db, 'doc_number_options', 'lists');

/** Loại văn bản theo id, hoặc null nếu id lạ (dữ liệu cũ). */
export function docTypeById(typeId) {
  return DOC_TYPES.find(t => t.id === typeId) ?? null;
}

/**
 * Số văn bản hoàn chỉnh: 12 + "QĐ" → "12/QĐ", thêm chữ phụ → "12A/QĐ".
 * Công văn không có chữ viết tắt nên chỉ còn phần số ("12", "12A").
 */
export function formatDocNumber(seq, abbr, suffix = '') {
  const num = `${seq}${suffix || ''}`;
  return abbr ? `${num}/${abbr}` : num;
}

/**
 * Chữ cái phụ thứ `n` (1-based): 1→A, 2→B, … 26→Z, 27→AA.
 * Quá 26 gần như không xảy ra, nhưng để tràn về rỗng thì sẽ cấp trùng số.
 */
export function suffixForIndex(n) {
  let s = '';
  let x = n;
  while (x > 0) {
    s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/** Khoá còn hiệu lực? (khoá đã hết hạn coi như không có ai đang nhập) */
export function isLockActive(lock, now = Date.now()) {
  return !!lock && lock.expiresAt > now;
}

function lockedError(holder) {
  const e = new Error(
    `${holder.name} đang lấy số văn bản. Vui lòng đợi và thử lại.`,
  );
  e.code = 'doc-number/locked';
  e.holder = holder;
  return e;
}

/** Ai đang giữ khoá nhập liệu, cập nhật theo thời gian thực (null = trống). */
export function subscribeDocNumberLock(onChange, onError) {
  return onSnapshot(
    lockRef(),
    snap => onChange(snap.exists() ? snap.data() : null),
    err => onError?.(err),
  );
}

/**
 * Giành khoá nhập liệu. Ném lỗi `doc-number/locked` (kèm `holder`) nếu người
 * khác đang giữ. Giành lại được khoá của chính mình (mở lại form) và khoá của
 * người khác đã hết hạn.
 */
export async function acquireDocNumberLock(user) {
  return runTransaction(db, async tx => {
    const now = Date.now();
    const snap = await tx.get(lockRef());
    const current = snap.exists() ? snap.data() : null;
    if (current && current.uid !== user.uid && current.expiresAt > now) {
      throw lockedError(current);
    }
    const lock = {
      uid: user.uid,
      name: displayNameOf(user),
      unit: user.unit ?? '',
      position: user.position ?? '',
      // Giữ nguyên thời điểm bắt đầu khi tự gia hạn, để người khác thấy đúng
      // "đang nhập từ lúc nào" chứ không phải lúc gia hạn gần nhất.
      acquiredAt: current?.uid === user.uid ? current.acquiredAt : now,
      expiresAt: now + DOC_LOCK_TTL_MS,
    };
    tx.set(lockRef(), lock);
    return lock;
  });
}

/**
 * Gia hạn khoá đang giữ. Không làm gì nếu khoá đã bị người khác lấy mất —
 * người gọi nhận biết qua listener chứ không qua hàm này.
 */
export async function renewDocNumberLock(uid) {
  await runTransaction(db, async tx => {
    const snap = await tx.get(lockRef());
    if (!snap.exists() || snap.data().uid !== uid) {
      return;
    }
    tx.update(lockRef(), { expiresAt: Date.now() + DOC_LOCK_TTL_MS });
  });
}

/** Nhả khoá (chỉ khi đúng là mình đang giữ). */
export async function releaseDocNumberLock(uid) {
  await runTransaction(db, async tx => {
    const snap = await tx.get(lockRef());
    if (!snap.exists() || snap.data().uid !== uid) {
      return;
    }
    tx.delete(lockRef());
  });
}

/** Số sắp được cấp cho một loại trong năm — chỉ để xem trước, không giữ chỗ. */
export async function peekNextDocNumber(year, typeId) {
  const snap = await getDoc(counterRef(year, typeId));
  return snap.exists() ? snap.data().next : 1;
}

/** Chữ phụ sắp cấp cho một số đã có ("A" nếu số đó chưa có văn bản phụ nào). */
export async function peekNextSuffix(year, typeId, seq) {
  const snap = await getDoc(suffixRef(year, typeId, seq));
  return suffixForIndex(snap.exists() ? snap.data().next : 1);
}

/**
 * Các số GỐC đã cấp của một loại trong năm, mới nhất trước — để người dùng
 * chọn số cần thêm chữ phụ.
 *
 * Lọc bỏ văn bản đã có chữ phụ ngay tại đây thay vì thêm một điều kiện `where`:
 * chữ phụ luôn bám vào số gốc, nên "12A" không bao giờ là gốc của "12AA". Lọc
 * phía client cũng tránh phải tạo thêm một index tổ hợp nữa.
 */
export async function fetchBaseNumbers(year, typeId) {
  const q = query(
    numbersCol(),
    where('year', '==', year),
    where('typeId', '==', typeId),
    orderBy('createdAt', 'desc'),
    limit(DOC_HISTORY_LIMIT),
  );
  const snap = await getDocs(q);
  return snap.docs
    .map(d => d.data())
    .filter(x => !x.suffix)
    .sort((a, b) => b.seq - a.seq);
}

/**
 * Cấp số cho một văn bản và ghi vào sổ. Người gọi phải đang giữ khoá.
 *
 * `baseSeq = null` → cấp SỐ MỚI: tăng bộ đếm chính của loại đó.
 * `baseSeq = 12`   → cấp SỐ PHỤ của số 12: tăng bộ đếm chữ phụ của riêng số
 *                    12, bộ đếm chính không đổi (số kế tiếp của sổ vẫn nguyên).
 *
 * Đọc bộ đếm, tăng bộ đếm, ghi văn bản và nhả khoá nằm trong CÙNG một
 * transaction: hoặc văn bản có số và bộ đếm nhảy, hoặc không có gì xảy ra.
 * Ném lỗi `doc-number/lock-lost` nếu khoá đã hết hạn hoặc bị người khác lấy —
 * lúc đó nội dung nhập dở vẫn còn trên màn hình để lưu lại.
 *
 * Việc `baseSeq` phải là một số CÓ THẬT do màn hình bảo đảm (chỉ cho chọn
 * trong danh sách số đã cấp). Rules không kiểm được điều này vì không thể truy
 * vấn trong rules; bù lại bộ đếm chữ phụ vẫn bảo đảm không có hai văn bản nào
 * cùng chữ phụ trên cùng một số.
 */
export async function issueDocNumber({
  user,
  type,
  summary,
  signer,
  unit,
  year,
  baseSeq = null,
}) {
  return runTransaction(db, async tx => {
    const now = Date.now();
    // Mọi lệnh đọc phải xong trước lệnh ghi đầu tiên của transaction.
    const lockSnap = await tx.get(lockRef());
    const lock = lockSnap.exists() ? lockSnap.data() : null;
    if (!lock || lock.uid !== user.uid || lock.expiresAt <= now) {
      const e = new Error(
        isLockActive(lock, now)
          ? `${lock.name} đã lấy quyền nhập. Văn bản chưa được cấp số.`
          : 'Phiên nhập đã hết hạn. Vui lòng lấy lại quyền nhập.',
      );
      e.code = 'doc-number/lock-lost';
      e.holder = isLockActive(lock, now) ? lock : null;
      throw e;
    }

    const isSuffix = baseSeq != null;
    const cRef = isSuffix
      ? suffixRef(year, type.id, baseSeq)
      : counterRef(year, type.id);
    const cSnap = await tx.get(cRef);
    const nextIndex = cSnap.exists() ? cSnap.data().next : 1;
    const seq = isSuffix ? baseSeq : nextIndex;
    const suffix = isSuffix ? suffixForIndex(nextIndex) : '';

    const entryRef = doc(numbersCol());
    const entry = {
      seq,
      suffix,
      year,
      number: formatDocNumber(seq, type.abbr, suffix),
      typeId: type.id,
      typeAbbr: type.abbr,
      typeLabel: type.label,
      summary: summary.trim(),
      signer: signer.trim(),
      unit: unit.trim(),
      createdBy: user.uid,
      createdByName: displayNameOf(user),
      createdAt: now,
    };
    tx.set(cRef, {
      year,
      typeId: type.id,
      ...(isSuffix ? { seq: baseSeq } : {}),
      next: nextIndex + 1,
    });
    tx.set(entryRef, entry);
    // Lấy số xong là nhả khoá ngay, người sau không phải chờ hết hạn.
    tx.delete(lockRef());
    return { ...entry, id: entryRef.id };
  });
}

/**
 * Danh mục NGƯỜI KÝ và ĐƠN VỊ BAN HÀNH, cập nhật theo thời gian thực.
 *
 * Để trong database chứ không phải trong mã nguồn: đơn vị thay cán bộ hoặc đổi
 * tên tổ thì Trưởng CA sửa ngay trên app, không phải chờ bản cập nhật mới.
 * Chưa có document (lần chạy đầu) thì lùi về danh mục mặc định trong
 * config/constants, để màn hình không bao giờ hiện dropdown rỗng.
 */
export function subscribeDocNumberOptions(onChange, onError) {
  return onSnapshot(
    optionsRef(),
    snap => {
      const data = snap.exists() ? snap.data() : null;
      onChange({
        signers: data?.signers?.length ? data.signers : DEFAULT_SIGNERS,
        units: data?.units?.length ? data.units : DEFAULT_ISSUING_UNITS,
        // Phân biệt "đang dùng mặc định" với "đã có danh mục riêng", để màn
        // hình quản lý nói rõ cho người dùng biết họ đang sửa cái gì.
        fromDefaults: !data,
      });
    },
    err => onError?.(err),
  );
}

/** Ghi lại danh mục người ký / đơn vị. Chỉ Trưởng CA (hoặc dev) làm được. */
export async function saveDocNumberOptions({ signers, units }, user) {
  const clean = list => [
    ...new Set(list.map(x => x.trim()).filter(Boolean)),
  ];
  await setDoc(optionsRef(), {
    signers: clean(signers),
    units: clean(units),
    updatedAt: Date.now(),
    updatedBy: user.uid,
    updatedByName: displayNameOf(user),
  });
}

/**
 * Số dòng lịch sử tải về nhiều nhất trong một lần. Màn hình phải NÓI RA khi
 * chạm trần, nếu không người dùng tưởng những văn bản cũ hơn đã biến mất.
 */
export const DOC_HISTORY_LIMIT = 300;

/**
 * Lịch sử các văn bản đã lấy số trong `year`, mới nhất trước.
 * `typeId` rỗng = tất cả các loại. Cần index tổ hợp — xem firestore.indexes.json.
 */
export function subscribeDocNumbers({ year, typeId }, onChange, onError) {
  const filters = [where('year', '==', year)];
  if (typeId) {
    filters.push(where('typeId', '==', typeId));
  }
  const q = query(
    numbersCol(),
    ...filters,
    orderBy('createdAt', 'desc'),
    limit(DOC_HISTORY_LIMIT),
  );
  return onSnapshot(
    q,
    snap => onChange(snap.docs.map(d => ({ ...d.data(), id: d.id }))),
    err => onError?.(err),
  );
}
