import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import {
  subscribeUnitAdmin,
  subscribeUnitChief,
  updateProfileInfo,
} from '../services/userService';
import PositionSelect from '../components/PositionSelect';
import UnitSelect from '../components/UnitSelect';
import { unitName } from '../config/units';
import { ADMIN_POSITION, BOSS_POSITION, POSITIONS } from '../config/constants';
import { colors, spacing } from '../theme';

/**
 * Shown to signed-in but not-yet-approved staff (and to any account that has
 * not picked a đơn vị yet). They cannot use any feature; they pick their đơn vị
 * (xã/phường) + chức vụ, then wait for THAT unit's Trưởng CA to approve them.
 * "Trưởng CA" chỉ chọn được khi đơn vị chưa có ai; khi đó là YÊU CẦU chờ admin
 * đơn vị (hoặc dev) duyệt. "Cán bộ (admin)" chọn được khi đơn vị chưa có admin
 * và vào được ngay — người đầu tiên của đơn vị mới tự làm admin.
 */
export default function PendingApprovalScreen() {
  const { profile, signOut } = useAuth();
  const [fullName, setFullName] = useState(profile?.fullName ?? '');
  const [position, setPosition] = useState(profile?.position ?? '');
  const [unitId, setUnitId] = useState(profile?.unitId ?? '');
  const [saving, setSaving] = useState(false);
  // True once the user starts editing the name — so we stop auto-syncing it.
  const [nameTouched, setNameTouched] = useState(false);
  // Hide the "Trưởng CA" chức vụ once the CHOSEN unit already has one (only
  // the first person may claim it here; a boss can still assign it in Quản lý
  // người dùng).
  const [chiefUid, setChiefUid] = useState(null);
  useEffect(
    () => subscribeUnitChief(unitId, setChiefUid, () => setChiefUid(null)),
    [unitId],
  );
  // Tương tự cho "Cán bộ (admin)": mỗi đơn vị một người.
  const [adminUid, setAdminUid] = useState(null);
  useEffect(
    () => subscribeUnitAdmin(unitId, setAdminUid, () => setAdminUid(null)),
    [unitId],
  );
  const chiefExists = !!chiefUid && chiefUid !== profile?.uid;
  const adminExists = !!adminUid && adminUid !== profile?.uid;
  const positionOptions = POSITIONS.filter(
    p =>
      !(chiefExists && p === BOSS_POSITION) &&
      !(adminExists && p === ADMIN_POSITION),
  );
  // Đổi sang đơn vị đã có người giữ chức đó thì bỏ chọn.
  useEffect(() => {
    if (
      (chiefExists && position === BOSS_POSITION) ||
      (adminExists && position === ADMIN_POSITION)
    ) {
      setPosition('');
    }
  }, [chiefExists, adminExists, position]);

  // The name from Sign in with Apple / Google is written to the profile a moment
  // AFTER this screen mounts, so seed it once it arrives (unless the user has
  // already started typing).
  useEffect(() => {
    if (!nameTouched && profile?.fullName) {
      setFullName(profile.fullName);
    }
  }, [profile?.fullName, nameTouched]);
  // True once info has been saved — locks the button into a "pending" state.
  const [saved, setSaved] = useState(!!(profile?.unitId && profile?.position));
  const save = async () => {
    if (!profile) {
      return;
    }
    // Họ tên KHÔNG bắt buộc: it is pre-filled from the sign-in provider (Apple /
    // Google). Forcing it here would violate App Store Guideline 4 for users who
    // signed in with Apple. Only chức vụ + đơn vị are required.
    if (!unitId) {
      Alert.alert('Thiếu đơn vị', 'Vui lòng chọn xã / phường.');
      return;
    }
    if (!position) {
      Alert.alert('Thiếu chức vụ', 'Vui lòng chọn chức vụ.');
      return;
    }
    try {
      setSaving(true);
      await updateProfileInfo(profile.uid, {
        fullName: fullName.trim(),
        position,
        unitId,
        previous: profile,
      });
      setSaved(true);
      Alert.alert(
        'Đã lưu',
        position === ADMIN_POSITION
          ? `Bạn là Cán bộ (admin) của ${unitName(unitId)}.`
          : position === BOSS_POSITION
          ? `Đã gửi yêu cầu làm Trưởng CA ${unitName(
              unitId,
            )}. Vui lòng chờ Cán bộ (admin) của đơn vị duyệt.`
          : `Đã gửi yêu cầu vào ${unitName(
              unitId,
            )}. Vui lòng chờ Trưởng CA của đơn vị duyệt.`,
      );
    } catch (e) {
      Alert.alert('Lỗi', e?.message ?? 'Không lưu được.');
    } finally {
      setSaving(false);
    }
  };
  return (
    // Android 15+ ép edge-to-edge nên adjustResize không còn thu nhỏ màn hình khi
    // bàn phím mở — phải tự chừa chỗ bằng padding trên CẢ HAI nền tảng.
    <KeyboardAvoidingView style={styles.flex} behavior="padding">
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.badge}>
          <Text style={styles.badgeEmoji}>⏳</Text>
        </View>
        <Text style={styles.title}>Tài khoản chưa được duyệt</Text>
        <Text style={styles.desc}>
          Xin chào {profile?.displayName}.{' '}
          {profile?.unitId && profile?.position === BOSS_POSITION
            ? `Yêu cầu làm Trưởng CA ${unitName(
                profile.unitId,
              )} đang chờ Cán bộ (admin) của đơn vị duyệt. Bạn sẽ dùng được ứng dụng ngay sau khi được duyệt.`
            : profile?.unitId
            ? `Tài khoản của bạn đang chờ Trưởng CA ${unitName(
                profile.unitId,
              )} phê duyệt. Bạn sẽ dùng được ứng dụng ngay sau khi được duyệt.`
            : 'Hãy chọn đơn vị (xã / phường) và chức vụ của bạn. Bạn chỉ thấy dữ liệu của đơn vị mình sau khi Trưởng CA đơn vị duyệt.'}
        </Text>

        <Text style={styles.label}>Đơn vị (xã / phường)</Text>
        <UnitSelect
          value={unitId}
          onChange={id => {
            setUnitId(id);
            setSaved(false);
          }}
        />

        <Text style={[styles.label, styles.labelSpaced]}>
          Họ và tên (không bắt buộc)
        </Text>
        <TextInput
          style={styles.input}
          value={fullName}
          onChangeText={t => {
            setNameTouched(true);
            setFullName(t);
            setSaved(false); // editing again re-enables saving
          }}
          placeholder="Nhập họ và tên của bạn"
          placeholderTextColor={colors.textMuted}
        />

        <Text style={[styles.label, styles.labelSpaced]}>Chức vụ</Text>
        <PositionSelect
          value={position}
          options={positionOptions}
          onChange={p => {
            setPosition(p);
            setSaved(false); // editing again re-enables saving
          }}
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flexGrow: 1,
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
