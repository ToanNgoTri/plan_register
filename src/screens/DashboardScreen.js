import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
} from 'react-native';
import DailyStatusTable from '../components/DailyStatusTable';
import { subscribeDailyStatus } from '../services/planService';
import { useToday } from '../hooks/useToday';
import { formatDateVi } from '../utils/date';
import { colors, spacing } from '../theme';
/** Boss home: today's registration status for all approved staff. */
export default function DashboardScreen() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  // Tự đổi khi sang ngày mới, kể cả khi app mở suốt qua nửa đêm.
  const today = useToday();
  // Bảng cập nhật theo thời gian thực: có người đăng ký / sửa kế hoạch, hoặc
  // danh sách cán bộ thay đổi → tự vẽ lại, không cần kéo để tải lại.
  // `retry` chỉ dùng khi listener bị lỗi (mất mạng / hết phiên) để nối lại.
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setLoading(true);
    const unsub = subscribeDailyStatus(
      today,
      next => {
        setRows(next);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [today, retry]);
  const reconnect = useCallback(() => setRetry(n => n + 1), []);
  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={reconnect} />
      }
    >
      <Text style={styles.date}>{formatDateVi(today)}</Text>
      {loading && rows.length === 0 ? (
        <ActivityIndicator
          style={{
            marginTop: spacing.xl,
          }}
        />
      ) : (
        <DailyStatusTable rows={rows} />
      )}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  date: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.md,
  },
});
