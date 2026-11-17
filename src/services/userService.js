import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from '@react-native-firebase/firestore';
import { deleteToken } from '@react-native-firebase/messaging';
import { db, messaging } from './firebase';
import { ADMIN_POSITION, BOSS_POSITION } from '../config/constants';
import { unitName } from '../config/units';
import { getCurrentUnitId } from './unitScope';
const usersCol = () => collection(db, 'users');

/**
 * `unit_chiefs/{unitId}` = { uid } : ai đang là Trưởng CA của đơn vị đó.
 *
 * Mỗi đơn vị chỉ MỘT Trưởng CA tự nhận được: rules chỉ cho tự chọn chức vụ
 * "Trưởng CA" khi cùng lượt ghi đó tạo được document này mang uid của mình —
 * mà document đã có (của người khác) thì không ghi đè được. Nhờ vậy người lạ
 * không thể chọn đơn vị X + "Trưởng CA" để tự duyệt mình và đọc dữ liệu của X.
 */
const chiefRef = unitId => doc(db, 'unit_chiefs', unitId);

/**
 * `unit_admins/{unitId}` = { uid } : "Cán bộ (admin)" (role admin) của đơn vị —
 * mỗi đơn vị một admin, quản trị (duyệt người, duyệt Trưởng CA) CHỈ đơn vị đó.
 * Tự nhận được khi chỗ còn trống, cùng cơ chế giữ chỗ như unit_chiefs.
 */
const adminRef = unitId => doc(db, 'unit_admins', unitId);

/**
 * The role implied by a chức vụ: "Trưởng CA" ⇒ boss, "Cán bộ (admin)" ⇒ admin,
 * anything else ⇒ staff.
 */
export function roleForPosition(position) {
  if (position === ADMIN_POSITION) {
    return 'admin';
  }
  return position === BOSS_POSITION ? 'boss' : 'staff';
}
const userDoc = uid => doc(db, 'users', uid);

/**
 * Ensures a Firestore profile exists for a freshly authenticated Google user.
 * New profiles default to role 'staff', approved=false, active=true — a boss
 * must approve them. Existing profiles are returned untouched (so we never
 * overwrite an approval, a role, or an active flag set elsewhere).
 */
export async function ensureUserProfile(params) {
  const ref = userDoc(params.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return snap.data();
  }
  const profile = {
    uid: params.uid,
    email: params.email,
    displayName: params.displayName || params.email,
    fullName: '',
    position: '',
    photoURL: params.photoURL ?? null,
    // Đơn vị (xã/phường) chọn ở màn chờ duyệt — xem config/units.
    unitId: '',
    unit: '',
    role: 'staff',
    approved: false,
    active: true,
    createdAt: Date.now(),
    fcmToken: null,
  };
  await setDoc(ref, profile);
  return profile;
}

/**
 * Uid Trưởng CA của một đơn vị (null nếu đơn vị chưa có), theo thời gian thực.
 * Dùng để ẩn lựa chọn "Trưởng CA" khi đơn vị đã có người. Ai đăng nhập cũng
 * đọc được (chỉ lộ uid).
 */
export function subscribeUnitChief(unitId, onChange, onError) {
  if (!unitId) {
    onChange(null);
    return () => {};
  }
  return onSnapshot(
    chiefRef(unitId),
    snap => onChange(snap.exists() ? snap.data()?.uid ?? null : null),
    err => onError?.(err),
  );
}

/** Uid admin của một đơn vị (null nếu chưa có), theo thời gian thực. */
export function subscribeUnitAdmin(unitId, onChange, onError) {
  if (!unitId) {
    onChange(null);
    return () => {};
  }
  return onSnapshot(
    adminRef(unitId),
    snap => onChange(snap.exists() ? snap.data()?.uid ?? null : null),
    err => onError?.(err),
  );
}

/** Xoá giấy giữ chỗ (Trưởng CA / admin) của đơn vị nếu đúng `uid` đang giữ. */
async function releaseSlotIfHeld(batch, refOf, unitId, uid) {
  if (!unitId) {
    return;
  }
  const snap = await getDoc(refOf(unitId));
  if (snap.exists() && snap.data()?.uid === uid) {
    batch.delete(refOf(unitId));
  }
}
const releaseChiefIfHeld = (batch, unitId, uid) =>
  releaseSlotIfHeld(batch, chiefRef, unitId, uid);

function slotTakenError(kind) {
  const e = new Error(
    kind === 'admin'
      ? 'Đơn vị này đã có Cán bộ (admin). Vui lòng chọn chức vụ khác.'
      : 'Đơn vị này đã có Trưởng CA. Vui lòng chọn chức vụ khác hoặc liên hệ Trưởng CA của đơn vị.',
  );
  e.code = kind === 'admin' ? 'unit/admin-taken' : 'unit/chief-taken';
  return e;
}

/** Live updates for the signed-in user's own profile (approval/role/active). */
export function subscribeToProfile(uid, onChange, onError) {
  return onSnapshot(
    userDoc(uid),
    // Always derive uid from the document id so downstream code (e.g. building
    // Firestore entry paths) never sees an undefined uid — even if a doc was
    // created by hand without the `uid` field.
    snap => onChange(snap.exists() ? { ...snap.data(), uid: snap.id } : null),
    err => onError?.(err),
  );
}
export async function updateUnit(uid, unit) {
  await updateDoc(userDoc(uid), {
    unit,
  });
}
export async function updateFullName(uid, fullName) {
  await updateDoc(userDoc(uid), {
    fullName,
  });
}
export async function updatePosition(uid, position) {
  await updateDoc(userDoc(uid), {
    position,
  });
}

/**
 * Update the user-editable profile fields (họ tên, chức vụ, đơn vị) at once.
 * Quyền đi theo chức vụ (rules ép đúng như vậy):
 *  - "Cán bộ (admin)" ⇒ role admin, ĐƯỢC DUYỆT NGAY — chỉ khi đơn vị chưa có
 *    admin (giữ chỗ unit_admins). Người đầu tiên của đơn vị mới tự làm admin.
 *  - "Trưởng CA" ⇒ YÊU CẦU (giữ chỗ unit_chiefs, chờ admin của đơn vị duyệt).
 *  - chức vụ khác ⇒ staff.
 * Đổi đơn vị = xin vào đơn vị mới: tài khoản trở về CHỜ DUYỆT (trừ khi nhận
 * luôn chỗ admin còn trống của đơn vị mới).
 */
export async function updateProfileInfo(
  uid,
  { fullName, position, unitId, previous },
) {
  const prevUnitId = previous?.unitId || '';
  const prevChief = previous?.position === BOSS_POSITION;
  const prevAdmin = previous?.position === ADMIN_POSITION;
  const isChief = position === BOSS_POSITION;
  const isAdmin = position === ADMIN_POSITION;
  const unitChanged = unitId !== prevUnitId;
  if (previous?.role === 'dev') {
    // dev (quản trị tổng): giữ role/approved, không giữ chỗ gì.
    await updateDoc(userDoc(uid), {
      fullName,
      position,
      unitId,
      unit: unitName(unitId),
    });
    return;
  }
  const patch = {
    fullName,
    position,
    unitId,
    unit: unitName(unitId),
    role: 'staff',
  };
  const batch = writeBatch(db);
  if (isAdmin && (!prevAdmin || unitChanged)) {
    // Nhận chỗ admin: chỉ khi đơn vị chưa có (hoặc đã là mình) → duyệt ngay.
    const snap = await getDoc(adminRef(unitId));
    if (snap.exists() && snap.data()?.uid !== uid) {
      throw slotTakenError('admin');
    }
    batch.set(adminRef(unitId), { uid, at: Date.now() });
    patch.role = 'admin';
    patch.approved = true;
  } else if (isChief && (!prevChief || unitChanged)) {
    // Xin làm Trưởng CA: chỉ khi chỗ của đơn vị còn trống (hoặc đã là mình).
    const snap = await getDoc(chiefRef(unitId));
    if (snap.exists() && snap.data()?.uid !== uid) {
      throw slotTakenError('chief');
    }
    batch.set(chiefRef(unitId), { uid, at: Date.now() });
    patch.approved = false;
  } else if ((isChief && prevChief) || (isAdmin && prevAdmin)) {
    // Giữ nguyên chức vụ đặc biệt: giữ nguyên role/approved.
    delete patch.role;
  } else if (unitChanged) {
    patch.approved = false;
  }
  if (prevChief && (!isChief || unitChanged)) {
    await releaseSlotIfHeld(batch, chiefRef, prevUnitId, uid);
  }
  if (prevAdmin && (!isAdmin || unitChanged)) {
    await releaseSlotIfHeld(batch, adminRef, prevUnitId, uid);
  }
  batch.update(userDoc(uid), patch);
  try {
    await batch.commit();
  } catch (e) {
    // Hai người cùng nhận một chỗ một lúc: người sau bị rules chặn.
    if (
      (isChief || isAdmin) &&
      /permission/i.test(String(e?.code ?? e?.message))
    ) {
      throw slotTakenError(isAdmin ? 'admin' : 'chief');
    }
    throw e;
  }
}

/**
 * Tự chuyển sang đơn vị khác (từ Cài đặt) — ai cũng làm được, kể cả Trưởng CA
 * và admin. Tài khoản LUÔN trở về chờ duyệt ở đơn vị mới: role=staff,
 * approved=false, trả chỗ Trưởng CA / admin ở đơn vị cũ. Chức vụ Trưởng CA /
 * admin không mang sang được — ở màn chờ duyệt người dùng chọn lại (nhận admin
 * nếu đơn vị mới chưa có thì vào được ngay).
 */
export async function changeUnit(profile, { unitId, fullName, position }) {
  if (profile.role === 'dev') {
    // dev (quản trị tổng): chuyển thẳng, không cần duyệt.
    await updateDoc(userDoc(profile.uid), {
      fullName,
      position,
      unitId,
      unit: unitName(unitId),
    });
    return;
  }
  const batch = writeBatch(db);
  if (profile.position === BOSS_POSITION) {
    await releaseSlotIfHeld(batch, chiefRef, profile.unitId, profile.uid);
  }
  if (profile.position === ADMIN_POSITION) {
    await releaseSlotIfHeld(batch, adminRef, profile.unitId, profile.uid);
  }
  const special = position === BOSS_POSITION || position === ADMIN_POSITION;
  batch.update(userDoc(profile.uid), {
    fullName,
    position: special ? '' : position,
    unitId,
    unit: unitName(unitId),
    role: 'staff',
    approved: false,
  });
  await batch.commit();
}

/**
 * Quản lý đổi chức vụ của một người trong đơn vị (role đi theo chức vụ).
 *
 * Giao chức "Trưởng CA" / "Cán bộ (admin)" (chỉ Trưởng CA đơn vị hoặc dev —
 * rules ép): người nhận phải đã được duyệt; nếu chức đó đang có người giữ thì
 * đây là CHUYỂN CHỨC — người cũ trở về "Cán bộ". Thu chức (đổi sang chức vụ
 * thường) thì trả chỗ giữ của đơn vị.
 */
export async function setUserPosition(user, position) {
  if (!position || position === user.position) {
    return;
  }
  if (user.role === 'dev') {
    throw new Error('Không đổi chức vụ của tài khoản dev.');
  }
  const special = position === BOSS_POSITION || position === ADMIN_POSITION;
  if (special && !user.approved) {
    throw new Error(
      'Chỉ giao chức Trưởng CA / Cán bộ (admin) cho người đã được duyệt.',
    );
  }
  const batch = writeBatch(db);
  const patch = { position, role: roleForPosition(position) };
  if (user.position === BOSS_POSITION) {
    await releaseSlotIfHeld(batch, chiefRef, user.unitId, user.uid);
  }
  if (user.position === ADMIN_POSITION) {
    await releaseSlotIfHeld(batch, adminRef, user.unitId, user.uid);
  }
  if (special) {
    const ref =
      position === BOSS_POSITION
        ? chiefRef(user.unitId)
        : adminRef(user.unitId);
    const snap = await getDoc(ref);
    const holder = snap.exists() ? snap.data()?.uid : null;
    if (holder && holder !== user.uid) {
      // Chuyển chức: người đang giữ trở về cán bộ thường.
      const holderSnap = await getDoc(userDoc(holder));
      if (holderSnap.exists()) {
        batch.update(userDoc(holder), { position: 'Cán bộ', role: 'staff' });
      }
    }
    batch.set(ref, { uid: user.uid, at: Date.now() });
    patch.approved = true;
    patch.active = true;
  }
  batch.update(userDoc(user.uid), patch);
  await batch.commit();
}

/** Preferred display name: the manually-entered full name, else Google name. */
export function displayNameOf(u) {
  return u.fullName && u.fullName.trim() ? u.fullName.trim() : u.displayName;
}
/**
 * Lưu token FCM của máy này kèm thời điểm. `fcmTokenAt` cho Cloud Function biết
 * ai là người đăng nhập GẦN NHẤT trên máy khi nhiều tài khoản từng dùng chung
 * một máy (cùng một token) — chỉ người đó mới được nhận thông báo.
 */
export async function updateFcmToken(uid, token) {
  await updateDoc(userDoc(uid), {
    fcmToken: token,
    fcmTokenAt: Date.now(),
  });
}

/**
 * Đăng xuất: xoá token khỏi hồ sơ VÀ huỷ token trên máy, để tài khoản đăng nhập
 * sau trên cùng máy nhận một token mới, không trùng với tài khoản cũ.
 */
export async function clearFcmToken(uid) {
  await updateDoc(userDoc(uid), { fcmToken: null, fcmTokenAt: Date.now() });
  await deleteToken(messaging).catch(() => {});
}

/**
 * Approved AND active staff — the boss daily table's audience, live: the table
 * stays correct when a user is approved / deactivated / deleted while the
 * screen is open. Manager-only (a manager may read every user doc per rules).
 */
export function subscribeApprovedStaff(onChange, onError) {
  const q = query(
    usersCol(),
    where('unitId', '==', getCurrentUnitId()),
    where('role', 'in', ['staff', 'admin']),
    where('approved', '==', true),
    where('active', '==', true),
  );
  return onSnapshot(
    q,
    snap => onChange(snap.docs.map(d => ({ ...d.data(), uid: d.id }))),
    err => onError?.(err),
  );
}

/**
 * Live list of EVERY user account (staff, boss, and dev — any state). The
 * management screen splits it into pending / active / inactive. Allowed for a
 * manager (boss/dev), who may read all user docs per the security rules.
 */
export function subscribeToUsers(onChange, onError) {
  return onSnapshot(
    // Chỉ người CÙNG ĐƠN VỊ — rules từ chối truy vấn thiếu điều kiện này.
    query(usersCol(), where('unitId', '==', getCurrentUnitId())),
    snap => onChange(snap.docs.map(d => ({ ...d.data(), uid: d.id }))),
    err => onError?.(err),
  );
}

/** Boss actions on a user account. */
export async function approveUser(user) {
  const patch = { approved: true, active: true };
  if (user.position === BOSS_POSITION && user.role !== 'dev') {
    // Yêu cầu Trưởng CA → thành Trưởng CA (giữ chỗ đã có sẵn từ lúc xin).
    patch.role = 'boss';
  }
  await updateDoc(userDoc(user.uid), patch);
}

/** Người đang chờ duyệt làm Trưởng CA (admin đơn vị hoặc dev duyệt). */
export function isChiefRequest(u) {
  return u.position === BOSS_POSITION && !u.approved && u.role !== 'dev';
}

/**
 * DEV (quản trị tổng): yêu cầu làm Trưởng CA đang chờ duyệt của TẤT CẢ đơn vị
 * (rules cho dev đọc hồ sơ mọi đơn vị). Admin đơn vị duyệt trong danh sách
 * chờ duyệt của đơn vị mình.
 */
export function subscribeChiefRequests(onChange, onError) {
  return onSnapshot(
    query(
      usersCol(),
      where('position', '==', BOSS_POSITION),
      where('approved', '==', false),
    ),
    snap =>
      onChange(
        snap.docs.map(d => ({ ...d.data(), uid: d.id })).filter(isChiefRequest),
      ),
    err => onError?.(err),
  );
}

/** DEV / ADMIN đơn vị: duyệt yêu cầu Trưởng CA — thành boss của đơn vị, giữ chỗ unit_chiefs. */
export async function approveChiefRequest(user) {
  const batch = writeBatch(db);
  batch.set(chiefRef(user.unitId), { uid: user.uid, at: Date.now() });
  batch.update(userDoc(user.uid), {
    approved: true,
    active: true,
    role: 'boss',
  });
  await batch.commit();
}

/**
 * DEV / ADMIN đơn vị: từ chối yêu cầu Trưởng CA — bỏ chức vụ, trả chỗ; người đó vẫn ở màn chờ
 * duyệt để chọn chức vụ khác.
 */
export async function rejectChiefRequest(user) {
  const batch = writeBatch(db);
  await releaseChiefIfHeld(batch, user.unitId, user.uid);
  batch.update(userDoc(user.uid), {
    position: '',
    role: 'staff',
    approved: false,
  });
  await batch.commit();
}

/** Deactivate (soft): keep history, but lock out and hide from the table. */
export async function deactivateUser(uid) {
  await updateDoc(userDoc(uid), {
    active: false,
  });
}
export async function reactivateUser(uid) {
  await updateDoc(userDoc(uid), {
    active: true,
  });
}

/**
 * Delete (hard): removes the user profile document. Access is revoked
 * immediately (security rules key off this doc). Their past plan entries are
 * left intact for the record. Note: this does NOT delete the Firebase Auth
 * account — see functions/deleteUserAccount for that (admin-only).
 */
export async function deleteUser(user) {
  const batch = writeBatch(db);
  await releaseChiefIfHeld(batch, user.unitId, user.uid);
  await releaseSlotIfHeld(batch, adminRef, user.unitId, user.uid);
  batch.delete(userDoc(user.uid));
  await batch.commit();
}

/**
 * Self-service delete: a user removes their own profile document. Access is
 * revoked immediately (security rules key off this doc), and the app drops them
 * back to the login screen once the doc is gone. Past plan entries are kept for
 * the record. The Firebase Auth account is left intact (a boss can fully purge
 * it via functions/deleteUserAccount).
 */
export async function deleteOwnAccount(profile) {
  const batch = writeBatch(db);
  await releaseChiefIfHeld(batch, profile.unitId, profile.uid);
  await releaseSlotIfHeld(batch, adminRef, profile.unitId, profile.uid);
  batch.delete(userDoc(profile.uid));
  await batch.commit();
}
