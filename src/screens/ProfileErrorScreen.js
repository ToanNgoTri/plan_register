import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { colors, spacing } from '../theme';

/**
 * Shown when the user is authenticated but their Firestore profile could not
 * be loaded/created — almost always a backend setup issue (Firestore database
 * not created, or security rules not deployed → permission-denied).
 */
export default function ProfileErrorScreen() {
  const { profileError, retryProfile, signOut } = useAuth();
  const msg = profileError?.message ?? 'Lỗi không xác định.';
  const isPermission = /permission|denied|insufficient/i.test(msg);
  return (
    <View style={styles.container}>
      <View style={styles.badge}>
        <Text style={styles.badgeEmoji}>⚠️</Text>
      </View>
      <Text style={styles.title}>Không tải được dữ liệu</Text>
      <Text style={styles.desc}>
        Đăng nhập thành công nhưng không đọc được hồ sơ từ Firestore.
      </Text>

      <View style={styles.hintBox}>
        <Text style={styles.hintTitle}>Cách khắc phục (phía Firebase):</Text>
        <Text style={styles.hint}>
          1. Firebase Console → Firestore Database → tạo database nếu chưa có.
        </Text>
        <Text style={styles.hint}>
          2. Deploy security rules (firestore.rules) — nếu để mặc định khóa, mọi
          truy cập sẽ bị từ chối.
        </Text>
        {isPermission && (
          <Text style={[styles.hint, styles.hintStrong]}>
            → Lỗi hiện tại là “permission-denied”: rules chưa được deploy.
          </Text>
        )}
      </View>

      <Text style={styles.errText} selectable>
        {msg}
      </Text>

      <TouchableOpacity style={styles.retry} onPress={retryProfile}>
        <Text style={styles.retryText}>Thử lại</Text>
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
  hintBox: {
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    alignSelf: 'stretch',
    marginBottom: spacing.md,
  },
  hintTitle: {
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  hint: {
    color: colors.textMuted,
    lineHeight: 20,
    marginBottom: 4,
  },
  hintStrong: {
    color: colors.danger,
    fontWeight: '600',
  },
  errText: {
    color: colors.danger,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  retry: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    paddingHorizontal: spacing.xl,
    borderRadius: 10,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  retryText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  signOut: {
    marginTop: spacing.md,
  },
  signOutText: {
    color: colors.danger,
    fontWeight: '600',
    fontSize: 15,
  },
});
