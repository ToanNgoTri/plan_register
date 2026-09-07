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
  DEFAULT_DOC_TYPES,
  DEFAULT_ISSUING_UNITS,
  DEFAULT_SIGNERS,
  DOC_LOCK_TTL_MS,
} from '../config/constants';

/**
 * Sổ số văn bản: cấp số cho từng văn bản đi và lưu lại lịch sử đã cấp.
 *
 * Firestore:
 *   doc_numbers/{autoId}                       – một văn bản đã lấy số
 *   doc_number_counters/{năm}-{loại}           – { next } : số sẽ cấp tiếp theo
 *   doc_number_suffixes/{năm}-{loại}-{số}      – { next } : chữ cái phụ kế tiếp
 *   doc_number_locks/{loại}                    – ai đang lấy số của loại đó
 *   doc_number_options/lists                   – danh mục người ký / đơn vị
 *
 * HAI thứ phải tuyệt đối không được chạy song song, và cả hai đều dựa trên
 * transaction chứ không dựa vào giao diện:
 *
 *  1. KHOÁ NHẬP LIỆU, MỖI LOẠI VĂN BẢN MỘT KHOÁ. Cùng một loại thì mỗi lần chỉ
 *     một người được mở form; người khác thấy tên người đang nhập và không bấm
 *     được. Khoá đặt theo LOẠI chứ không theo năm: chữ phụ của một văn bản năm
 *     trước vẫn đi qua đúng cái khoá của loại đó, nên không có khe hở nào ở
 *     thời điểm chuyển năm. Hai loại khác nhau là hai dãy số độc lập, khoá
 *     chung cả sổ chỉ làm cả đơn vị xếp hàng vô cớ.
 *
 *  2. CẤP SỐ. Số tiếp theo được đọc và tăng trong cùng một transaction với việc
 *     ghi văn bản, nên kể cả khi khoá bị hết hạn và hai người cùng bấm lưu thì
 *     vẫn không ai lấy trùng số của ai.
 *
 * Bộ đếm mang năm trong id (`2026-QD`), nên sang năm mới là một bộ đếm khác và
 * số tự bắt đầu lại từ 01 — không cần ai đi "reset" bằng tay, nhưng cũng có
 * nghĩa số MỚI phải luôn cấp theo năm hiện tại (xem `currentDocYear`), không
 * theo năm mà người dùng đang chọn để xem lịch sử.
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

const numbersCol = () => collection(db, 'doc_numbers');
const locksCol = () => collection(db, 'doc_number_locks');
const lockRef = typeId => doc(db, 'doc_number_locks', typeId);
const counterRef = (year, typeId) =>
  doc(db, 'doc_number_counters', `${year}-${typeId}`);
const suffixRef = (year, typeId, seq) =>
  doc(db, 'doc_number_suffixes', `${year}-${typeId}-${seq}`);
const optionsRef = () => doc(db, 'doc_number_options', 'lists');

/**
 * Loại văn bản theo id trong danh mục đang dùng, hoặc null nếu id lạ — loại đã
 * bị xoá khỏi danh mục vẫn còn nguyên trong các văn bản đã cấp số, nên người
 * gọi phải chịu được `null` thay vì coi đó là lỗi.
 */
export function docTypeById(types, typeId) {
  return types.find(t => t.id === typeId) ?? null;
}

/** Bỏ dấu tiếng Việt, giữ nguyên hoa/thường: "QĐ" → "QD", "CTr" → "CTr". */
function withoutDiacritics(s) {
  return s
    .normalize('NFD')
    .split('')
    .filter(c => c.charCodeAt(0) < 0x0300 || c.charCodeAt(0) > 0x036f)
    .join('')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/**
 * Sinh `id` cho một loại văn bản mới. Id là thứ VĨNH VIỄN (nằm trong id bộ đếm,
 * id khoá và trong từng văn bản đã cấp), nên phải chỉ gồm chữ và số — id có dấu
 * hoặc có khoảng trắng sẽ đẻ ra document id khó đọc và khó tra tay trên Console.
 *
 * Lấy từ chữ viết tắt nếu có ("QĐ" → "QD"), không thì lấy chữ cái đầu của tên
 * ("Công văn" → "CV"). Trùng với id đã có thì thêm số ("BC" → "BC2") chứ tuyệt
 * đối không dùng lại id cũ: dùng lại là nối vào dãy số của một loại khác.
 */
export function docTypeIdFrom(label, abbr, taken = []) {
  const fromAbbr = withoutDiacritics(abbr ?? '').replace(/[^A-Za-z0-9]/g, '');
  const fromLabel = withoutDiacritics(label ?? '')
    .split(/\s+/)
    .map(w => w.charAt(0))
    .join('')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
  const base = (fromAbbr || fromLabel).slice(0, 12) || 'VB';
  let id = base;
  let n = 2;
  while (taken.includes(id)) {
    id = `${base}${n}`;
    n += 1;
  }
  return id;
}

/**
 * Làm sạch danh mục loại văn bản trước khi ghi: bỏ dòng trống, sinh id cho dòng
 * mới, bỏ dòng trùng id. Giữ NGUYÊN id của những dòng đã có id — đổi id của một
 * loại đang dùng là cắt rời nó khỏi bộ đếm và khỏi các văn bản đã cấp số.
 */
export function cleanDocTypes(list) {
  const out = [];
  list.forEach(t => {
    const label = String(t?.label ?? '').trim();
    if (!label) {
      return;
    }
    const abbr = String(t?.abbr ?? '').trim();
    const id =
      String(t?.id ?? '').trim() ||
      docTypeIdFrom(
        label,
        abbr,
        out.map(x => x.id),
      );
    if (!/^[A-Za-z0-9]{1,16}$/.test(id) || out.some(x => x.id === id)) {
      return;
    }
    out.push({ id, label, abbr });
  });
  return out;
}

/**
 * Năm đang cấp số. Số MỚI luôn thuộc năm này, kể cả khi màn hình đang xem lịch
 * sử của năm cũ: bộ đếm tách theo năm nên cấp lẫn năm là cấp trùng số của một
 * dãy đã đóng. Đọc lại mỗi lần gọi (không cache) để app mở suốt qua đêm 31/12
 * là sang số của năm mới ngay.
 */
export function currentDocYear() {
  return new Date().getFullYear();
}

/**
 * Số văn bản hoàn chỉnh: 12 + "QĐ" → "12/QĐ", thêm chữ phụ → "12A/QĐ".
 * Công văn không có chữ viết tắt nên chỉ còn phần số ("12", "12A").
 *
 * Số dưới 10 viết hai chữ số ("01/QĐ") theo lối trình bày văn bản hành chính.
 * Tính từ `seq` chứ không đọc trường `number` đã lưu, nên các số cấp trước khi
 * có phần đệm này cũng hiển thị đúng một kiểu.
 */
export function formatDocNumber(seq, abbr, suffix = '') {
  const num = `${String(seq).padStart(2, '0')}${suffix || ''}`;
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
    `${holder.name} đang lấy số ${holder.typeLabel ?? 'văn bản'}. ` +
      'Vui lòng đợi hoặc lấy số của loại khác.',
  );
  e.code = 'doc-number/locked';
  e.holder = holder;
  return e;
}

/**
 * Ai đang giữ khoá của loại nào, cập nhật theo thời gian thực. Trả về một đối
 * tượng { [typeId]: khoá } — loại không có mặt trong đó là loại đang trống.
 *
 * Lắng nghe cả collection (một document mỗi loại, tối đa bằng số loại văn bản)
 * chứ không lắng nghe từng loại: màn hình phải nói được "loại nào đang có người
 * nhập" cho cả danh sách, không chỉ cho loại đang chọn.
 *
 * Chỉ nhận document TỰ KHAI đúng loại của mình (`typeId` bằng id document).
 * Không đối chiếu với danh mục loại: danh mục nằm trong dữ liệu và có thể đổi
 * bất cứ lúc nào, mà khoá của một loại vừa bị xoá khỏi danh mục thì vẫn phải
 * thấy — người đang giữ nó cần nhập nốt. Điều kiện này cũng loại được khoá
 * chung `doc_number_locks/global` của bản cũ (document đó không có `typeId`).
 */
export function subscribeDocNumberLocks(onChange, onError) {
  return onSnapshot(
    locksCol(),
    snap => {
      const byType = {};
      snap.docs.forEach(d => {
        if (d.data()?.typeId === d.id) {
          byType[d.id] = { ...d.data(), typeId: d.id };
        }
      });
      onChange(byType);
    },
    err => onError?.(err),
  );
}

/**
 * Giành khoá nhập liệu CỦA MỘT LOẠI văn bản. Ném lỗi `doc-number/locked` (kèm
 * `holder`) nếu người khác đang giữ khoá của đúng loại đó; các loại khác không
 * liên quan. Giành lại được khoá của chính mình (mở lại form) và khoá của người
 * khác đã hết hạn.
 */
export async function acquireDocNumberLock(user, type) {
  return runTransaction(db, async tx => {
    const now = Date.now();
    const ref = lockRef(type.id);
    const snap = await tx.get(ref);
    const current = snap.exists() ? snap.data() : null;
    if (current && current.uid !== user.uid && current.expiresAt > now) {
      throw lockedError(current);
    }
    const lock = {
      uid: user.uid,
      name: displayNameOf(user),
      unit: user.unit ?? '',
      position: user.position ?? '',
      // Loại nằm trong chính document (không chỉ trong id) để rules đối chiếu
      // được, và để màn hình gọi tên loại mà không phải tra lại danh mục.
      typeId: type.id,
      typeLabel: type.label,
      // Giữ nguyên thời điểm bắt đầu khi tự gia hạn, để người khác thấy đúng
      // "đang nhập từ lúc nào" chứ không phải lúc gia hạn gần nhất.
      acquiredAt: current?.uid === user.uid ? current.acquiredAt : now,
      expiresAt: now + DOC_LOCK_TTL_MS,
    };
    tx.set(ref, lock);
    return lock;
  });
}

/**
 * Gia hạn khoá đang giữ. Không làm gì nếu khoá đã bị người khác lấy mất —
 * người gọi nhận biết qua listener chứ không qua hàm này.
 */
export async function renewDocNumberLock(uid, typeId) {
  await runTransaction(db, async tx => {
    const ref = lockRef(typeId);
    const snap = await tx.get(ref);
    if (!snap.exists() || snap.data().uid !== uid) {
      return;
    }
    tx.update(ref, { expiresAt: Date.now() + DOC_LOCK_TTL_MS });
  });
}

/** Nhả khoá của một loại (chỉ khi đúng là mình đang giữ). */
export async function releaseDocNumberLock(uid, typeId) {
  await runTransaction(db, async tx => {
    const ref = lockRef(typeId);
    const snap = await tx.get(ref);
    if (!snap.exists() || snap.data().uid !== uid) {
      return;
    }
    tx.delete(ref);
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
 * Các số GỐC đã cấp của một loại, mới nhất trước — để người dùng chọn số cần
 * thêm chữ phụ.
 *
 * Lấy năm nay VÀ năm trước: chữ phụ bám vào một văn bản đã phát hành, mà những
 * ngày đầu tháng 1 thì văn bản gốc còn nằm ở năm cũ. Số MỚI thì ngược lại,
 * luôn thuộc năm hiện tại.
 *
 * Lọc bỏ văn bản đã có chữ phụ ngay tại đây thay vì thêm một điều kiện `where`:
 * chữ phụ luôn bám vào số gốc, nên "12A" không bao giờ là gốc của "12AA". Lọc
 * phía client cũng tránh phải tạo thêm một index tổ hợp nữa.
 */
export async function fetchBaseNumbers(typeId, years) {
  const q = query(
    numbersCol(),
    where('year', 'in', years),
    where('typeId', '==', typeId),
    orderBy('createdAt', 'desc'),
    limit(DOC_HISTORY_LIMIT),
  );
  const snap = await getDocs(q);
  return snap.docs
    .map(d => d.data())
    .filter(x => !x.suffix)
    .sort((a, b) => b.year - a.year || b.seq - a.seq);
}

/**
 * Cấp số cho một văn bản và ghi vào sổ. Người gọi phải đang giữ khoá CỦA LOẠI
 * văn bản này.
 *
 * `baseSeq = null` → cấp SỐ MỚI: tăng bộ đếm chính của loại đó. `year` phải là
 *                    năm hiện tại (`currentDocYear`).
 * `baseSeq = 12`   → cấp SỐ PHỤ của số 12: tăng bộ đếm chữ phụ của riêng số
 *                    12, bộ đếm chính không đổi (số kế tiếp của sổ vẫn nguyên).
 *                    `year` là năm của văn bản gốc, có thể là năm trước.
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
    const lockSnap = await tx.get(lockRef(type.id));
    const lock = lockSnap.exists() ? lockSnap.data() : null;
    if (!lock || lock.uid !== user.uid || lock.expiresAt <= now) {
      const e = new Error(
        isLockActive(lock, now)
          ? `${lock.name} đã lấy quyền nhập ${type.label}. Văn bản chưa được cấp số.`
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
    tx.delete(lockRef(type.id));
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
        // Danh mục loại văn bản cũng nằm ở đây: thêm/bớt một loại là sửa dữ
        // liệu, không phải ra bản cập nhật app. Danh sách rỗng (hoặc chưa có
        // document) thì lùi về danh mục mặc định, để không bao giờ có tình
        // trạng mở app ra không lấy được số nào.
        types: data?.types?.length ? cleanDocTypes(data.types) : DEFAULT_DOC_TYPES,
        // Phân biệt "đang dùng mặc định" với "đã có danh mục riêng", để màn
        // hình quản lý nói rõ cho người dùng biết họ đang sửa cái gì.
        fromDefaults: !data,
      });
    },
    err => onError?.(err),
  );
}

/**
 * Ghi lại danh mục người ký / đơn vị / loại văn bản. Chỉ Trưởng CA (hoặc dev)
 * làm được.
 *
 * `types` bỏ qua (undefined) thì giữ nguyên danh mục loại đang có — để một màn
 * hình chỉ sửa người ký không vô tình xoá sạch danh mục loại.
 */
export async function saveDocNumberOptions({ signers, units, types }, user) {
  const clean = list => [
    ...new Set(list.map(x => x.trim()).filter(Boolean)),
  ];
  await setDoc(
    optionsRef(),
    {
      signers: clean(signers),
      units: clean(units),
      ...(types ? { types: cleanDocTypes(types) } : {}),
      updatedAt: Date.now(),
      updatedBy: user.uid,
      updatedByName: displayNameOf(user),
    },
    { merge: !types },
  );
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
