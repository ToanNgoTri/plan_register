import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  AppleButton,
  appleAuth,
} from '@invertase/react-native-apple-authentication';
import { statusCodes } from '@react-native-google-signin/google-signin';
import { useAuth } from '../context/AuthContext';
import { colors, spacing } from '../theme';

// The user tapping "cancel" in the native sheet is not a failure worth alerting.
function isCancellation(e) {
  return (
    e?.code === appleAuth.Error.CANCELED ||
    e?.code === statusCodes.SIGN_IN_CANCELLED
  );
}

export default function LoginScreen() {
  const { signIn, signInApple, signInEmail } = useAuth();
  // Track which provider is signing in so only its own button shows a spinner.
  const [pending, setPending] = useState(null); // 'google' | 'apple' | 'email' | null
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const showAppleButton = Platform.OS === 'ios' && appleAuth.isSupported;

  const runSignIn = async (provider, fn) => {
    if (pending) {
      return;
    }
    try {
      setPending(provider);
      await fn();
    } catch (e) {
      if (!isCancellation(e)) {
        Alert.alert('Đăng nhập thất bại', e?.message ?? 'Có lỗi xảy ra.');
      }
    } finally {
      setPending(null);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.logoBox}>
        <Text style={styles.logoEmoji}>🗂️</Text>
      </View>
      <Text style={styles.title}>Đăng ký Kế hoạch</Text>
      <Text style={styles.subtitle}>Đăng ký kế hoạch công tác hằng ngày</Text>

      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder="Tài khoản (email)"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        editable={!pending}
      />
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        placeholder="Mật khẩu"
        placeholderTextColor={colors.textMuted}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        editable={!pending}
      />
      <TouchableOpacity
        style={styles.button}
        onPress={() => runSignIn('email', () => signInEmail(email, password))}
        disabled={!!pending}
        activeOpacity={0.85}
      >
        {pending === 'email' ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Đăng nhập</Text>
        )}
      </TouchableOpacity>

      <View style={styles.dividerRow}>
        <View style={styles.divider} />
        <Text style={styles.dividerText}>hoặc</Text>
        <View style={styles.divider} />
      </View>

      <TouchableOpacity
        style={[styles.button, styles.googleButton]}
        onPress={() => runSignIn('google', signIn)}
        disabled={!!pending}
        activeOpacity={0.85}
      >
        {pending === 'google' ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Đăng nhập bằng Google</Text>
        )}
      </TouchableOpacity>

      {showAppleButton && (
        <AppleButton
          style={styles.appleButton}
          cornerRadius={12}
          buttonStyle={AppleButton.Style.BLACK}
          buttonType={AppleButton.Type.SIGN_IN}
          onPress={() => runSignIn('apple', signInApple)}
        />
      )}
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
  logoBox: {
    width: 96,
    height: 96,
    borderRadius: 24,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    elevation: 2,
  },
  logoEmoji: {
    fontSize: 48,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textMuted,
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
    textAlign: 'center',
  },
  input: {
    width: 260,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
    marginBottom: spacing.sm,
  },
  button: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
    borderRadius: 12,
    minWidth: 260,
    alignItems: 'center',
  },
  googleButton: {
    marginTop: 0,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 260,
    marginVertical: spacing.md,
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    color: colors.textMuted,
    marginHorizontal: spacing.sm,
    fontSize: 13,
  },
  appleButton: {
    width: 260,
    height: 48,
    marginTop: spacing.md,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
