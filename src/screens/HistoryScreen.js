import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import DailyStatusTable from '../components/DailyStatusTable';
import { getDailyStatus, getMyEntry } from '../services/planService';
import { formatDateVi, toDateKey } from '../utils/date';
import { colors, spacing } from '../theme';
/**
 * Boss: browse any day's full staff table (with red for missing).
 * Staff: their own registration history, newest first.
 */
export default function HistoryScreen() {
  const { isBoss } = useAuth();
  return isBoss ? <BossHistory /> : <StaffHistory />;
}
function BossHistory() {
  const [date, setDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const isToday = toDateKey(date) === toDateKey(new Date());
  const load = useCallback(async d => {
    setLoading(true);
    try {
      setRows(await getDailyStatus(d));
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      load(date);
    }, [load, date]),
  );
  const shiftDay = delta =>
    setDate(prev => {
      const d = new Date(prev);
      d.setDate(prev.getDate() + delta);
      return d.getTime() > Date.now() ? prev : d; // never past today
    });
  const onPickerChange = (event, selected) => {
    setShowPicker(Platform.OS === 'ios'); // iOS keeps the spinner open
    if (event.type === 'set' && selected) {
      setDate(selected);
    }
  };
  return (
    <View style={styles.flex}>
      <View style={styles.nav}>
        <TouchableOpacity style={styles.navBtn} onPress={() => shiftDay(-1)}>
          <Text style={styles.navText}>‹</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.dateBtn}
          onPress={() => setShowPicker(true)}
          activeOpacity={0.7}
        >
          <Text style={styles.navDate}>📅 {formatDateVi(date)}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.navBtn, isToday && styles.navBtnDisabled]}
          disabled={isToday}
          onPress={() => shiftDay(1)}
        >
          <Text style={styles.navText}>›</Text>
        </TouchableOpacity>
      </View>

      {showPicker && (
        <DateTimePicker
          value={date}
          mode="date"
          maximumDate={new Date()}
          onChange={onPickerChange}
        />
      )}

      {loading ? (
        <ActivityIndicator style={styles.loader} />
      ) : (
        <FlatList
          data={[0]}
          keyExtractor={() => 'table'}
          contentContainerStyle={styles.container}
          renderItem={() => <DailyStatusTable rows={rows} />}
        />
      )}
    </View>
  );
}
function StaffHistory() {
  const { profile } = useAuth();
  const [date, setDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [entry, setEntry] = useState(null);
  const [loading, setLoading] = useState(true);
  const isToday = toDateKey(date) === toDateKey(new Date());
  const load = useCallback(
    async d => {
      if (!profile) {
        return;
      }
      setLoading(true);
      try {
        setEntry(await getMyEntry(profile.uid, d));
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile?.uid],
  );
  useFocusEffect(
    useCallback(() => {
      load(date);
    }, [load, date]),
  );
  const shiftDay = delta =>
    setDate(prev => {
      const d = new Date(prev);
      d.setDate(prev.getDate() + delta);
      return d.getTime() > Date.now() ? prev : d; // never past today
    });
  const onPickerChange = (event, selected) => {
    setShowPicker(Platform.OS === 'ios');
    if (event.type === 'set' && selected) {
      setDate(selected);
    }
  };
  return (
    <View style={styles.flex}>
      <View style={styles.nav}>
        <TouchableOpacity style={styles.navBtn} onPress={() => shiftDay(-1)}>
          <Text style={styles.navText}>‹</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.dateBtn}
          onPress={() => setShowPicker(true)}
          activeOpacity={0.7}
        >
          <Text style={styles.navDate}>📅 {formatDateVi(date)}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.navBtn, isToday && styles.navBtnDisabled]}
          disabled={isToday}
          onPress={() => shiftDay(1)}
        >
          <Text style={styles.navText}>›</Text>
        </TouchableOpacity>
      </View>

      {showPicker && (
        <DateTimePicker
          value={date}
          mode="date"
          maximumDate={new Date()}
          onChange={onPickerChange}
        />
      )}

      {loading ? (
        <ActivityIndicator style={styles.loader} />
      ) : entry ? (
        <View style={styles.container}>
          <View style={styles.card}>
            <Text style={styles.cardContent}>{entry.content}</Text>
          </View>
        </View>
      ) : (
        <Text style={styles.empty}>Không có đăng ký cho ngày này.</Text>
      )}
    </View>
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
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  navBtn: {
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.bg,
    borderRadius: 8,
  },
  navBtnDisabled: {
    opacity: 0.4,
  },
  navText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 18,
  },
  dateBtn: {
    flex: 1,
    marginHorizontal: spacing.sm,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.bg,
  },
  navDate: {
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  loader: {
    marginTop: spacing.xl,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardContent: {
    color: colors.text,
    lineHeight: 20,
  },
  empty: {
    textAlign: 'center',
    color: colors.textMuted,
    marginTop: spacing.xl,
  },
});
