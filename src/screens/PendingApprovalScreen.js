import React, { useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { updateProfileInfo } from '../services/userService';
import PositionSelect from '../components/PositionSelect';
import { colors, spacing } from '../theme';

/**
 * Shown to signed-in but not-yet-approved staff. They cannot use any feature;
 * they may only set their unit (to help the boss identify them) and sign out.
 */
export default function PendingApprovalScreen() {
  const { profile, signOut } = useAuth();
  const [fullName, setFullName] = useState(profile?.fullName ?? '');
  const [position, setPosition] = useState(profile?.position ?? '');
  const [unit, setUnit] = useState(profile?.unit || 'Công an phường Hàng Gòn');
  const [saving, setSaving] = useState(false);
  // True once info has been saved — locks the button into a "pending" state.
  const [saved, setSaved] = useState(
    !!(profile?.fullName && profile.fullName.trim()),
  );
  const save = async () => {
    if (!profile) {
      return;
    }
    // Họ tên KHÔNG bắt buộc: it is pre-filled from the sign-in provider (Apple /
    // Google). Forcing it here would violate App Store Guideline 4 for users who
    // signed in with Apple. Only chức vụ + đơn vị are required.
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
        currentRole: profile.role,
      });
      setSaved(true);
      Alert.alert('Đã lưu', 'Thông tin của bạn đã được cập nhật.');
    } catch (e) {
      Alert.alert('Lỗi', e?.message ?? 'Không lưu được.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <View style={styles.container}>
      <View style={styles.badge}>
        <Text style={styles.badgeEmoji}>⏳</Text>
      </View>
      <Text style={styles.title}>Tài khoản chưa được duyệt</Text>
      <Text style={styles.desc}>
        Xin chào {profile?.displayName}. Tài khoản của bạn đang chờ quản lý phê
        duyệt. Bạn sẽ dùng được ứng dụng ngay sau khi được duyệt.
      </Text>

      <Text style={styles.label}>Họ và tên (không bắt buộc)</Text>
      <TextInput
        style={styles.input}
        value={fullName}
        onChangeText={t => {
          setFullName(t);
          setSaved(false); // editing again re-enables saving
        }}
        placeholder="Nhập họ và tên của bạn"
        placeholderTextColor={colors.textMuted}
      />

      <Text style={[styles.label, styles.labelSpaced]}>Chức vụ</Text>
      <PositionSelect
        value={position}
        onChange={p => {
          setPosition(p);
          setSaved(false); // editing again re-enables saving
        }}
      />

      <Text style={[styles.label, styles.labelSpaced]}>Đơn vị / Phòng ban</Text>
      <TextInput
        style={styles.input}
        value={unit}
        onChangeText={t => {
          setUnit(t);
          setSaved(false); // editing again re-enables saving
        }}
        placeholder="VD: Phòng Kỹ thuật Hình sự"
        placeholderTextColor={colors.textMuted}
      />
      <TouchableOpacity
        style={[styles.saveBtn, saved && styles.saveBtnDone]}
        onPress={save}
        disabled={saving || saved}
        activeOpacity={0.85}
      >
        <Text style={[styles.saveText, saved && styles.saveTextDone]}>
          {saving
            ? 'Đang lưu…'
            : saved
            ? 'Tài khoản đang chờ phê duyệt…'
            : 'Lưu thông tin'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={signOut} style={styles.signOut}>
        <Text style={styles.signOutText}>Đăng xuất</Text>
      </TouchableOpacity>
    </View>
  );
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    padding: spacing.xl,
  },
  badge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.warningBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  badgeEmoji: {
    fontSize: 40,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  desc: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    lineHeight: 22,
  },
  label: {
    alignSelf: 'flex-start',
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
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    borderRadius: 10,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  saveText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  saveBtnDone: {
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  saveTextDone: {
    color: colors.warning,
  },
  signOut: {
    marginTop: spacing.xl,
  },
  signOutText: {
    color: colors.danger,
    fontWeight: '600',
    fontSize: 15,
  },
});
