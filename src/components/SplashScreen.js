import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors, spacing } from '../theme';

/** Sau chừng này mà vẫn chưa vào được app thì đề nghị thử lại. */
const SLOW_AFTER_MS = 10000;

/**
 * Màn hình chờ lúc mở app: chờ Firebase khôi phục phiên đăng nhập và đọc hồ sơ.
 *
 * Mạng chập chờn có thể làm bước đọc hồ sơ treo rất lâu — trước đây người dùng
 * chỉ thấy một vòng xoay trên nền trắng và tưởng app bị đơ. Quá SLOW_AFTER_MS
 * thì hiện lời nhắc kiểm tra mạng, kèm nút "Thử lại" nếu màn hình cha có cách
 * thử lại (`onRetry`).
 */
export default function SplashScreen({ onRetry }) {
  const pulse = useRef(new Animated.Value(0.3)).current;
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => {
      loop.stop();
      clearTimeout(timer);
    };
  }, [pulse]);

  const retry = () => {
    setSlow(false);
    onRetry?.();
  };

  return (
    <View style={styles.container}>
      <Image
        source={require('../assets/logo.png')}
        style={styles.logo}
        resizeMode="cover"
      />
      <Text style={styles.appName}>ĐƠN VỊ SỐ</Text>
      <Animated.Text style={[styles.loading, { opacity: pulse }]}>
        Đang tải...
      </Animated.Text>
      <ActivityIndicator size="large" color="#fff" style={styles.spinner} />
      {slow ? (
        <View style={styles.slow}>
          <Text style={styles.slowText}>
            Kết nối đang chậm. Kiểm tra mạng (Wi-Fi / 4G) rồi thử lại.
          </Text>
          {onRetry ? (
            <TouchableOpacity
              style={styles.retryBtn}
              activeOpacity={0.85}
              onPress={retry}
            >
              <Text style={styles.retryText}>Thử lại</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        <Text style={styles.subtitle}>Kiểm tra phiên đăng nhập</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.primaryDark,
  },
  logo: {
    width: 112,
    height: 112,
    borderRadius: 28,
    marginBottom: spacing.md,
  },
  appName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 1,
    marginBottom: spacing.lg,
  },
  loading: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  spinner: {
    marginVertical: spacing.lg,
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
  },
  slow: {
    alignItems: 'center',
  },
  slowText: {
    fontSize: 14,
    color: '#fff',
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: spacing.md,
    backgroundColor: '#fff',
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderRadius: 10,
  },
  retryText: {
    color: colors.primaryDark,
    fontWeight: '700',
    fontSize: 15,
  },
});
