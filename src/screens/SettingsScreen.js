import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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
  deleteOwnAccount,
  displayNameOf,
  updateProfileInfo,
} from '../services/userService';
import { clearAvatar, getAvatar, setAvatar } from '../services/avatarStore';
import PositionSelect from '../components/PositionSelect';
import { colors, spacing } from '../theme';

/**
 * Settings tab: avatar (stored locally on device), họ tên, and account actions
 * — edit profile info (which also contains delete-account) and sign out.
 */
export default function SettingsScreen() {
  const { profile, signOut } = useAuth();
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
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.container}
    >
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
      {profile?.unit ? <Text style={styles.sub}>{profile.unit}</Text> : null}
      <Text style={styles.email}>{profile?.email}</Text>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.btn}
          activeOpacity={0.85}
          onPress={() => setEditing(true)}
        >
          <Text style={styles.btnText}>Chỉnh sửa thông tin</Text>
        </TouchableOpacity>

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

/** Modal form: edit họ tên / chức vụ / đơn vị, plus a delete-account action. */
function EditProfileModal({ visible, profile, onClose, onDeleted }) {
  const [fullName, setFullName] = useState('');
  const [position, setPosition] = useState('');
  const [unit, setUnit] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Seed the form each time it opens with the current profile values.
  useEffect(() => {
    if (visible && profile) {
      setFullName(profile.fullName ?? '');
      setPosition(profile.position ?? '');
      setUnit(profile.unit ?? '');
    }
  }, [visible, profile]);

  const save = async () => {
    if (!fullName.trim()) {
      Alert.alert('Thiếu họ tên', 'Vui lòng nhập họ và tên.');
      return;
    }
    if (!position) {
      Alert.alert('Thiếu chức vụ', 'Vui lòng chọn chức vụ.');
      return;
    }
    if (!unit.trim()) {
      Alert.alert('Thiếu đơn vị', 'Vui lòng nhập đơn vị.');
      return;
    }
    try {
      setSaving(true);
      await updateProfileInfo(profile.uid, {
        fullName: fullName.trim(),
        position,
        unit: unit.trim(),
      });
      onClose();
    } catch (e) {
      Alert.alert('Lỗi', e?.message ?? 'Không lưu được.');
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    try {
      setDeleting(true);
      await clearAvatar(profile.uid);
      await deleteOwnAccount(profile.uid);
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
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet}>
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
          <PositionSelect value={position} onChange={setPosition} />

          <Text style={[styles.label, styles.labelSpaced]}>
            Đơn vị / Phòng ban
          </Text>
          <TextInput
            style={styles.input}
            value={unit}
            onChangeText={setUnit}
            placeholder="VD: Công an phường Hàng Gòn"
            placeholderTextColor={colors.textMuted}
          />

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
        </Pressable>
      </Pressable>
    </Modal>
  );
}
const AVATAR = 120;
const styles = StyleSheet.create({
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
  btnOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.danger,
  },
  btnOutlineText: {
    color: colors.danger,
  },
  // Edit modal
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
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
