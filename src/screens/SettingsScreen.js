import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import ImageCropPicker from 'react-native-image-crop-picker';
import { useAuth } from '../context/AuthContext';
import {
  changeUnit,
  deleteOwnAccount,
  displayNameOf,
  subscribeChiefRequests,
  subscribeToUsers,
  subscribeUnitAdmin,
  subscribeUnitChief,
  updateProfileInfo,
} from '../services/userService';
import { clearAvatar, getAvatar, setAvatar } from '../services/avatarStore';
import PositionSelect from '../components/PositionSelect';
import UnitSelect from '../components/UnitSelect';
import { ADMIN_POSITION, BOSS_POSITION, POSITIONS } from '../config/constants';
import { unitName } from '../config/units';
import { colors, spacing } from '../theme';

/**
 * Settings tab: avatar (stored locally on device), họ tên, and account actions
 * — edit profile info (which also contains delete-account) and sign out.
 */
export default function SettingsScreen({ navigation }) {
  const { profile, signOut, isBoss, isDev, isAdmin } = useAuth();
  const canManage = isBoss || isDev || isAdmin;
  const pendingCount = usePendingCount(canManage, isDev);
  const [avatar, setAvatarState] = useState(null);
  const [editing, setEditing] = useState(false);

  // Load the locally-stored avatar for this user.
  useEffect(() => {
    let alive = true;
    if (profile?.uid) {
      getAvatar(profile.uid).then(v => {
        if (alive) {
          setAvatarState(v);
        }
      });
    }
    return () => {
      alive = false;
    };
  }, [profile?.uid]);

  const name = profile ? displayNameOf(profile) : '';
  const initial = name ? name.trim().charAt(0).toUpperCase() : '?';

  const pickAvatar = async () => {
    try {
      // Opens the library, then a crop screen where the user can pan/zoom to
      // frame the photo inside a circular overlay (avatar shape).
      const image = await ImageCropPicker.openPicker({
        width: 512,
        height: 512,
        cropping: true,
        cropperCircleOverlay: true,
        includeBase64: true,
        mediaType: 'photo',
        compressImageQuality: 0.7,
        cropperToolbarTitle: 'Căn chỉnh ảnh đại diện',
        cropperChooseText: 'Xong',
        cropperCancelText: 'Huỷ',
        // Android (uCrop): brand colors for the crop screen's status bar +
        // toolbar. NOTE: these only set colors — they do NOT position the
        // toolbar. Under Android 15/16 edge-to-edge, the toolbar would render
        // under the status bar; that is fixed natively in MainApplication.kt
        // (applyEdgeToEdgeFixForUCrop), which insets the uCrop content view.
        cropperStatusBarColor: colors.primaryDark,
        cropperToolbarColor: colors.primary,
        cropperToolbarWidgetColor: '#ffffff',
        cropperActiveWidgetColor: colors.primary,
      });
      if (!image?.data) {
        return;
      }
      const dataUri = `data:${image.mime ?? 'image/jpeg'};base64,${image.data}`;
      await setAvatar(profile.uid, dataUri);
      setAvatarState(dataUri);
    } catch (e) {
      // The user tapping "cancel" in the picker/cropper is not an error.
      if (e?.code === 'E_PICKER_CANCELLED') {
        return;
      }
      Alert.alert('Lỗi', e?.message ?? 'Không chọn được ảnh.');
    }
  };

  const removeAvatar = async () => {
    await clearAvatar(profile.uid);
    setAvatarState(null);
  };

  const onAvatarPress = () =>
    Alert.alert('Ảnh đại diện', 'Chọn thao tác', [
      { text: 'Chọn ảnh mới', onPress: pickAvatar },
      ...(avatar
        ? [{ text: 'Xoá ảnh', style: 'destructive', onPress: removeAvatar }]
        : []),
      { text: 'Huỷ', style: 'cancel' },
    ]);

  const confirmSignOut = () =>
    Alert.alert('Đăng xuất', 'Bạn có chắc muốn đăng xuất?', [
      { text: 'Huỷ', style: 'cancel' },
      { text: 'Đăng xuất', style: 'destructive', onPress: () => signOut() },
    ]);

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.container}>
      <TouchableOpacity
        style={styles.avatarWrap}
        activeOpacity={0.8}
        onPress={onAvatarPress}
      >
        {avatar ? (
          <Image source={{ uri: avatar }} style={styles.avatarImg} />
        ) : (
          <View style={[styles.avatarImg, styles.avatarPlaceholder]}>
            <Text style={styles.avatarInitial}>{initial}</Text>
          </View>
        )}
        <View style={styles.cameraBadge}>
          <Text style={styles.cameraEmoji}>📷</Text>
        </View>
      </TouchableOpacity>

      <Text style={styles.name}>{name || 'Chưa có tên'}</Text>
      {profile?.position ? (
        <Text style={styles.sub}>{profile.position}</Text>
      ) : null}
      {profile?.unitId ? (
        <Text style={styles.sub}>{unitName(profile.unitId)}</Text>
      ) : null}
      <Text style={styles.email}>{profile?.email}</Text>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.btn}
          activeOpacity={0.85}
          onPress={() => setEditing(true)}
        >
          <Text style={styles.btnText}>Chỉnh sửa thông tin</Text>
        </TouchableOpacity>

        {canManage ? (
          <TouchableOpacity
            style={[styles.btn, styles.btnManage]}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('ManageUsers')}
          >
            <Text style={styles.btnText}>
              👥 Phê duyệt người dùng
              {pendingCount ? `  (${pendingCount})` : ''}
            </Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={[styles.btn, styles.btnOutline]}
          activeOpacity={0.85}
          onPress={confirmSignOut}
        >
          <Text style={[styles.btnText, styles.btnOutlineText]}>Đăng xuất</Text>
        </TouchableOpacity>
      </View>

      <EditProfileModal
        visible={editing}
        profile={profile}
        onClose={() => setEditing(false)}
        onDeleted={signOut}
      />
    </ScrollView>
  );
}

/**
 * Số tài khoản đang chờ duyệt (đơn vị mình; dev cộng thêm yêu cầu Trưởng CA
 * mọi đơn vị) — hiện trên nút "Phê duyệt người dùng".
 */
function usePendingCount(enabled, isDev) {
  const [unitPending, setUnitPending] = useState([]);
  const [chiefReqs, setChiefReqs] = useState([]);
  useEffect(() => {
    if (!enabled) {
      setUnitPending([]);
      return undefined;
    }
    return subscribeToUsers(
      us => setUnitPending(us.filter(u => !u.approved)),
      () => {},
    );
  }, [enabled]);
  useEffect(() => {
    if (!enabled || !isDev) {
      setChiefReqs([]);
      return undefined;
    }
    return subscribeChiefRequests(setChiefReqs, () => {});
  }, [enabled, isDev]);
  const ids = new Set(unitPending.map(u => u.uid));
  chiefReqs.forEach(u => ids.add(u.uid));
  return ids.size;
}

/** Modal form: edit họ tên / chức vụ / đơn vị, plus a delete-account action. */
function EditProfileModal({ visible, profile, onClose, onDeleted }) {
  const [fullName, setFullName] = useState('');
  const [position, setPosition] = useState('');
  const [unitId, setUnitId] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Hide "Trưởng CA" if the unit already has one (unless this user IS that
  // Trưởng CA).
  const [chiefUid, setChiefUid] = useState(null);
  useEffect(
    () => subscribeUnitChief(profile?.unitId, setChiefUid, () => {}),
    [profile?.unitId],
  );
  const [adminUid, setAdminUid] = useState(null);
  useEffect(
    () => subscribeUnitAdmin(profile?.unitId, setAdminUid, () => {}),
    [profile?.unitId],
  );
  const chiefExists = !!chiefUid && chiefUid !== profile?.uid;
  const adminExists = !!adminUid && adminUid !== profile?.uid;
  const isDevAcc = profile?.role === 'dev';
  // dev (quản trị tổng) không giữ chức Trưởng CA / admin của đơn vị nào.
  const positionOptions = POSITIONS.filter(
    p =>
      p === position ||
      !(
        (p === BOSS_POSITION && (chiefExists || isDevAcc)) ||
        (p === ADMIN_POSITION && (adminExists || isDevAcc))
      ),
  );

  // Seed the form each time it opens with the current profile values.
  useEffect(() => {
    if (visible && profile) {
      setFullName(profile.fullName ?? '');
      setPosition(profile.position ?? '');
      setUnitId(profile.unitId ?? '');
    }
  }, [visible, profile]);

  const save = async () => {
    // Họ tên is optional (pre-filled from the sign-in provider); see the
    // Guideline 4 note in PendingApprovalScreen.
    if (!position) {
      Alert.alert('Thiếu chức vụ', 'Vui lòng chọn chức vụ.');
      return;
    }
    if (unitId && unitId !== profile.unitId) {
      confirmChangeUnit();
      return;
    }
    if (
      position === BOSS_POSITION &&
      profile.position !== BOSS_POSITION &&
      profile.role !== 'dev'
    ) {
      Alert.alert(
        'Xin làm Trưởng CA',
        `Gửi yêu cầu làm Trưởng CA ${unitName(
          profile.unitId,
        )}? Tài khoản sẽ trở về CHỜ DUYỆT cho đến khi Cán bộ (admin) của đơn vị duyệt.`,
        [
          { text: 'Huỷ', style: 'cancel' },
          { text: 'Gửi yêu cầu', onPress: doSave },
        ],
      );
      return;
    }
    doSave();
  };

  const doSave = async () => {
    try {
      setSaving(true);
      await updateProfileInfo(profile.uid, {
        fullName: fullName.trim(),
        position,
        unitId: profile.unitId,
        previous: profile,
      });
      onClose();
    } catch (e) {
      Alert.alert('Lỗi', e?.message ?? 'Không lưu được.');
    } finally {
      setSaving(false);
    }
  };

  // Đổi đơn vị: tài khoản về CHỜ DUYỆT — app tự chuyển sang màn chờ duyệt
  // (RootNavigator) ngay khi hồ sơ cập nhật.
  const confirmChangeUnit = () =>
    Alert.alert(
      'Chuyển đơn vị',
      profile.role === 'dev'
        ? `Chuyển sang ${unitName(
            unitId,
          )}? Ứng dụng sẽ hiển thị dữ liệu của đơn vị mới.`
        : `Chuyển sang ${unitName(
            unitId,
          )}? Tài khoản sẽ trở về trạng thái CHỜ DUYỆT và chỉ dùng lại được khi Trưởng CA ${unitName(
            unitId,
          )} phê duyệt.` +
            (profile.position === BOSS_POSITION
              ? ` Bạn sẽ thôi là Trưởng CA của ${unitName(profile.unitId)}.`
              : ''),
      [
        { text: 'Huỷ', style: 'cancel' },
        { text: 'Chuyển', style: 'destructive', onPress: doChangeUnit },
      ],
    );

  const doChangeUnit = async () => {
    try {
      setSaving(true);
      await changeUnit(profile, {
        unitId,
        fullName: fullName.trim(),
        position,
      });
      onClose();
    } catch (e) {
      Alert.alert('Lỗi', e?.message ?? 'Không chuyển được đơn vị.');
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    try {
      setDeleting(true);
      await clearAvatar(profile.uid);
      await deleteOwnAccount(profile);
      // Access is revoked; sign out to return to the login screen.
      onDeleted?.();
    } catch (e) {
      Alert.alert('Lỗi', e?.message ?? 'Không xoá được tài khoản.');
    } finally {
      setDeleting(false);
    }
  };

  const confirmDelete = () =>
    Alert.alert(
      'Xoá tài khoản',
      'Bạn có chắc muốn xoá tài khoản của mình? Bạn sẽ mất quyền truy cập ngay lập tức. (Lịch sử đã đăng ký được giữ lại.)',
      [
        { text: 'Huỷ', style: 'cancel' },
        { text: 'Xoá tài khoản', style: 'destructive', onPress: doDelete },
      ],
    );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      {/* Android 15+ ép edge-to-edge: modal không tự co lại khi bàn phím mở
          nữa, nên tự chừa chỗ bằng padding trên cả hai nền tảng. */}
      <KeyboardAvoidingView style={styles.modalFill} behavior="padding">
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.sheet}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>Chỉnh sửa thông tin</Text>

              <Text style={styles.label}>Họ và tên</Text>
              <TextInput
                style={styles.input}
                value={fullName}
                onChangeText={setFullName}
                placeholder="Nhập họ và tên"
                placeholderTextColor={colors.textMuted}
              />

              <Text style={[styles.label, styles.labelSpaced]}>Chức vụ</Text>
              <PositionSelect
                value={position}
                options={positionOptions}
                onChange={setPosition}
              />

              <Text style={[styles.label, styles.labelSpaced]}>Đơn vị</Text>
              <UnitSelect value={unitId} onChange={setUnitId} />
              {unitId !== profile?.unitId && profile?.role !== 'dev' ? (
                <Text style={styles.unitWarn}>
                  Đổi đơn vị: tài khoản sẽ chuyển về chờ Trưởng CA đơn vị mới
                  duyệt.
                </Text>
              ) : null}

              <TouchableOpacity
                style={[styles.btn, styles.saveBtn]}
                activeOpacity={0.85}
                onPress={save}
                disabled={saving || deleting}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.btnText}>Lưu thông tin</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.cancelBtn}
                activeOpacity={0.7}
                onPress={onClose}
                disabled={saving || deleting}
              >
                <Text style={styles.cancelText}>Huỷ</Text>
              </TouchableOpacity>

              <View style={styles.divider} />

              <TouchableOpacity
                style={styles.deleteBtn}
                activeOpacity={0.85}
                onPress={confirmDelete}
                disabled={saving || deleting}
              >
                {deleting ? (
                  <ActivityIndicator color={colors.danger} />
                ) : (
                  <Text style={styles.deleteText}>Xoá tài khoản</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const AVATAR = 120;
const styles = StyleSheet.create({
  unitWarn: {
    color: colors.warning,
    fontSize: 13,
    marginTop: spacing.xs,
  },
  flex: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    alignItems: 'center',
    padding: spacing.xl,
    paddingBottom: spacing.xl,
  },
  avatarWrap: {
    width: AVATAR,
    height: AVATAR,
    marginBottom: spacing.md,
  },
  avatarImg: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    backgroundColor: colors.card,
    borderWidth: 3,
    borderColor: colors.primary,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 48,
    fontWeight: '700',
    color: colors.primary,
  },
  cameraBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraEmoji: {
    fontSize: 18,
  },
  name: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.xs,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  sub: {
    fontSize: 15,
    color: colors.textMuted,
    marginTop: 2,
  },
  email: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  actions: {
    alignSelf: 'stretch',
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  btn: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  btnManage: {
    backgroundColor: colors.success,
  },
  btnOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.danger,
  },
  btnOutlineText: {
    color: colors.danger,
  },
  // Edit modal
  modalFill: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '90%',
    backgroundColor: colors.bg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: spacing.lg,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.md,
  },
  label: {
    color: colors.text,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  labelSpaced: {
    marginTop: spacing.md,
  },
  input: {
    width: '100%',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
  },
  inputReadOnly: {
    backgroundColor: colors.bg,
    color: colors.textMuted,
  },
  saveBtn: {
    marginTop: spacing.lg,
  },
  cancelBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  cancelText: {
    color: colors.textMuted,
    fontWeight: '600',
    fontSize: 15,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  deleteBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.dangerBg,
  },
  deleteText: {
    color: colors.danger,
    fontWeight: '700',
    fontSize: 15,
  },
});
