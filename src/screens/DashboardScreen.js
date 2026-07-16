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
import { formatDateVi } from '../utils/date';
import { colors, spacing } from '../theme';
/** Boss home: today's registration status for all approved staff. */
export default function DashboardScreen() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const today = new Date();
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await getDailyStatus(today));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
