import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, spacing } from '../theme';

/**
 * Bắt mọi lỗi render/runtime ở cây con → hiện màn hình lỗi thay vì sập app.
 *
 * Hữu ích cho crash "đôi lúc" lúc mở lại app sau thời gian dài (dữ liệu null,
 * native module chưa sẵn sàng...) — người dùng bấm "Thử lại" thay vì phải tắt
 * hẳn app rồi mở lại.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info?.componentStack);
  }

  retry = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Đã xảy ra lỗi</Text>
        <Text style={styles.message}>
          Ứng dụng gặp sự cố. Vui lòng thử lại.
        </Text>
        {error.message ? (
          <Text style={styles.detail}>{String(error.message)}</Text>
        ) : null}
        <TouchableOpacity
          style={styles.button}
          activeOpacity={0.85}
          onPress={this.retry}
        >
          <Text style={styles.buttonText}>Thử lại</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.bg,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  message: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  detail: {
    fontSize: 12,
    color: colors.danger,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  button: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderRadius: 10,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
});
