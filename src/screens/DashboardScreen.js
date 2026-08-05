import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import DailyStatusTable from '../components/DailyStatusTable';
import { getDailyStatus } from '../services/planService';
import { useToday } from '../hooks/useToday';
import { formatDateVi } from '../utils/date';
import { colors, spacing } from '../theme';
/** Boss home: today's registration status for all approved staff. */
export default function DashboardScreen() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  // Tự đổi khi sang ngày mới, kể cả khi app mở suốt qua nửa đêm.
  const today = useToday();
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await getDailyStatus(today));
    } finally {
      setLoading(false);
    }
  }, [today]);
  // `load` đổi khi sang ngày mới → useFocusEffect chạy lại và nạp bảng ngày mới
  // ngay cả khi màn hình đang mở sẵn.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
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
