import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { colors, spacing } from '../theme';

/**
 * Shown to a staff account that was approved but later deactivated by the boss
 * (e.g. moved elsewhere). They are fully locked out; only sign-out is allowed.
 */
export default function InactiveScreen() {
  const { profile, signOut } = useAuth();
  return (
    <View style={styles.container}>
      <View style={styles.badge}>
        <Text style={styles.badgeEmoji}>🚫</Text>
      </View>
      <Text style={styles.title}>Tài khoản đã ngừng hoạt động</Text>
      <Text style={styles.desc}>
        Xin chào {profile?.displayName}. Tài khoản của bạn hiện đã bị vô hiệu
        hóa và không thể sử dụng các chức năng. Vui lòng liên hệ quản lý nếu cần
        kích hoạt lại.
      </Text>
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
    backgroundColor: colors.dangerBg,
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
    textAlign: 'center',
  },
  desc: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    lineHeight: 22,
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
