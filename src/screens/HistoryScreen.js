import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import DailyStatusTable from '../components/DailyStatusTable';
import PositionSelect from '../components/PositionSelect';
import { getDailyStatus, getMyEntry } from '../services/planService';
import { displayNameOf } from '../services/userService';
import { useFollowToday } from '../hooks/useToday';
import { formatDateVi, toDateKey } from '../utils/date';
import { colors, spacing } from '../theme';

/**
 * Date picker that opens the calendar in a SINGLE tap.
 *  - iOS: a modal showing the wheel/calendar directly (avoids the two-step
 *    "compact" default picker where you must tap the pill to expand it).
 *  - Android: the native date dialog (already single-tap).
 */
function DatePicker({ visible, value, onChange, onClose }) {
  if (!visible) {
    return null;
  }
  const handleChange = (event, selected) => {
    if (Platform.OS === 'android') {
      onClose();
      if (event.type === 'set' && selected) {
        onChange(selected);
      }
      return;
    }
    if (selected) {
      onChange(selected);
    }
  };
  if (Platform.OS !== 'ios') {
    return (
      <DateTimePicker
        value={value}
        mode="date"
        maximumDate={new Date()}
        onChange={handleChange}
      />
    );
  }
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.pickerBackdrop} onPress={onClose}>
        <Pressable style={styles.pickerSheet}>
          <DateTimePicker
            value={value}
            mode="date"
            // Spinner (wheel) — single-tap, compact, never overflows the sheet
            // (the inline calendar's intrinsic size does).
            display="spinner"
            // App is a light theme on a white sheet — force the picker to light
            // so the numbers are dark (not white/invisible) even in dark mode.
            themeVariant="light"
            accentColor={colors.primary}
            maximumDate={new Date()}
            onChange={handleChange}
            style={styles.pickerWheel}
          />
          <TouchableOpacity style={styles.pickerDone} onPress={onClose}>
            <Text style={styles.pickerDoneText}>Xong</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// Boss history table: filter by an individual cán bộ / phó trưởng (by name),
// plus an "all" option. Sentinel value for the "all" entry.
const ALL_PEOPLE = '__ALL__';
/**
 * Boss: browse any day's full staff table (with red for missing).
 * Staff: their own registration history, newest first.
 */
export default function HistoryScreen() {
  const { isBoss, isDev } = useAuth();
  // `dev` (review/demo) gets the full history table so App Review can see the
  // whole feature, not just its own entries.
  return isBoss || isDev ? <BossHistory /> : <StaffHistory />;
}
function BossHistory() {
  const [date, setDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [personFilter, setPersonFilter] = useState(ALL_PEOPLE);
  // Sang ngày mới: nếu đang xem "hôm nay" thì tự nhảy sang ngày mới; đang xem
  // ngày quá khứ thì giữ nguyên lựa chọn của người dùng.
  const todayKey = useFollowToday(setDate);
  const isToday = toDateKey(date) === todayKey;
  // Dropdown options: "Tất cả" + one entry per person in the table (label = tên,
  // value = uid to stay unique even if two people share a name).
  const personOptions = useMemo(
    () => [
      { label: 'Tất cả', value: ALL_PEOPLE },
      ...rows.map(r => ({ label: displayNameOf(r.user), value: r.user.uid })),
    ],
    [rows],
  );
  const visibleRows = useMemo(
    () =>
      personFilter === ALL_PEOPLE
        ? rows
        : rows.filter(r => r.user?.uid === personFilter),
    [rows, personFilter],
  );
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

      <DatePicker
        visible={showPicker}
        value={date}
        onChange={setDate}
        onClose={() => setShowPicker(false)}
      />

      <View style={styles.filterBar}>
        <Text style={styles.filterLabel}>Lọc theo cán bộ</Text>
        <PositionSelect
          value={personFilter}
          onChange={setPersonFilter}
          options={personOptions}
          title="Chọn cán bộ"
          placeholder="Tất cả"
        />
      </View>

      {loading ? (
        <ActivityIndicator style={styles.loader} />
      ) : (
        <FlatList
          data={[0]}
          keyExtractor={() => 'table'}
          contentContainerStyle={styles.container}
          renderItem={() => <DailyStatusTable rows={visibleRows} />}
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
  // Xem mục BossHistory: tự bám theo ngày mới khi đang xem "hôm nay".
  const todayKey = useFollowToday(setDate);
  const isToday = toDateKey(date) === todayKey;
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

      <DatePicker
        visible={showPicker}
        value={date}
        onChange={setDate}
        onClose={() => setShowPicker(false)}
      />

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
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  pickerSheet: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: spacing.md,
    overflow: 'hidden',
  },
  pickerWheel: {
    width: '100%',
    height: 216,
  },
  pickerDone: {
    marginTop: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  pickerDoneText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
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
  filterBar: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  filterLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: spacing.xs,
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
