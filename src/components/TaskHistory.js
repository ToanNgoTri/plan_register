import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { useTasks } from '../hooks/useTasks';
import { isCommanderProfile, TASK_STATUS } from '../services/taskService';
import TaskCard from './TaskCard';
import { colors, spacing } from '../theme';

const DIR_FILTERS = [
  { id: 'all', label: 'Tất cả' },
  { id: 'received', label: 'Được giao' },
  { id: 'given', label: 'Tôi giao' },
];
const STATUS_FILTERS = [
  { id: 'all', label: 'Mọi trạng thái' },
  { id: TASK_STATUS.PENDING, label: 'Đang làm' },
  { id: 'overdue', label: 'Quá hạn' },
  { id: TASK_STATUS.SUBMITTED, label: 'Chờ duyệt' },
  { id: TASK_STATUS.APPROVED, label: 'Đã xong' },
  { id: 'rejected', label: 'Từng bị từ chối' },
  { id: 'postponed', label: 'Từng hoãn' },
];

const thisMonth = () => {
  const d = new Date();
  return { y: d.getFullYear(), m: d.getMonth() };
};

function Chips({ items, value, onChange }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.filterRow}
    >
      {items.map(it => {
        const on = it.id === value;
        return (
          <TouchableOpacity
            key={it.id}
            style={[styles.chip, on && styles.chipOn]}
            onPress={() => onChange(it.id)}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]}>
              {it.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

/**
 * Tra cứu mọi nhiệm vụ tôi từng giao / được giao (kể cả đã duyệt): tìm theo
 * tên việc, nội dung, người; lọc theo chiều giao, trạng thái và tháng giao.
 */
export default function TaskHistory({ highlightId }) {
  const { profile } = useAuth();
  const { ready, received, given, error } = useTasks();
  // Ai cũng có "Tôi giao": chỉ huy giao cho cấp dưới, cán bộ tự giao cho mình.
  const showDirection = true;
  const commander = isCommanderProfile(profile);
  const [now, setNow] = useState(Date.now());
  useFocusEffect(
    useCallback(() => {
      setNow(Date.now());
      const t = setInterval(() => setNow(Date.now()), 30 * 1000);
      return () => clearInterval(t);
    }, []),
  );
  const [search, setSearch] = useState('');
  const [dir, setDir] = useState('all');
  const [status, setStatus] = useState('all');
  // null = mọi thời gian; { y, m } = tháng giao nhiệm vụ.
  const [month, setMonth] = useState(null);

  const all = useMemo(() => {
    // Việc tự giao nằm trong CẢ hai truy vấn → chỉ lấy một lần, tính là "Tôi giao".
    const tagged = [
      ...received
        .filter(t => t.assignerUid !== t.assigneeUid)
        .map(t => ({ task: t, mode: 'received' })),
      ...given.map(t => ({ task: t, mode: 'given' })),
    ];
    return tagged.sort(
      (a, b) => (b.task.createdAt || 0) - (a.task.createdAt || 0),
    );
  }, [received, given]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter(({ task: t, mode }) => {
      if (dir !== 'all' && mode !== dir) {
        return false;
      }
      if (month) {
        const d = new Date(t.createdAt || 0);
        if (d.getFullYear() !== month.y || d.getMonth() !== month.m) {
          return false;
        }
      }
      if (status === 'overdue') {
        if (!(t.status === TASK_STATUS.PENDING && t.dueAt <= now)) {
          return false;
        }
      } else if (status === 'rejected') {
        if (!(t.rejectCount > 0)) {
          return false;
        }
      } else if (status === 'postponed') {
        if (!(t.postponeCount > 0)) {
          return false;
        }
      } else if (status !== 'all' && t.status !== status) {
        return false;
      }
      if (q) {
        const hay = [
          t.title,
          t.content,
          t.assignerName,
          t.assigneeName,
          t.rejectReason,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [all, dir, status, month, search, now]);

  const done = rows.filter(r => r.task.status === TASK_STATUS.APPROVED).length;
  const late = rows.filter(
    r => r.task.status === TASK_STATUS.PENDING && r.task.dueAt <= now,
  ).length;

  const shiftMonth = delta => {
    setMonth(prev => {
      const base = prev ?? thisMonth();
      const d = new Date(base.y, base.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  };

  if (!ready) {
    return <ActivityIndicator style={styles.pad} color={colors.primary} />;
  }
  if (error) {
    return (
      <Text style={styles.errorText}>
        Không tải được nhiệm vụ: {error.message}
      </Text>
    );
  }

  return (
    <FlatList
      data={rows}
      keyExtractor={r => r.task.id}
      contentContainerStyle={styles.list}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View>
          <TextInput
            style={styles.input}
            value={search}
            onChangeText={setSearch}
            placeholder="🔍 Tìm theo tên việc, nội dung, người giao / nhận"
            placeholderTextColor={colors.textMuted}
          />
          <View style={styles.monthRow}>
            <TouchableOpacity
              style={styles.monthBtn}
              onPress={() => shiftMonth(-1)}
            >
              <Text style={styles.monthArrow}>◀</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.monthMid}
              onPress={() => setMonth(m => (m ? null : thisMonth()))}
            >
              <Text style={styles.monthText}>
                {month
                  ? `Giao trong tháng ${month.m + 1}/${month.y}`
                  : 'Mọi thời gian'}
              </Text>
              <Text style={styles.monthHint}>
                {month ? 'Chạm để xem mọi thời gian' : 'Chạm để lọc theo tháng'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.monthBtn}
              onPress={() => shiftMonth(1)}
            >
              <Text style={styles.monthArrow}>▶</Text>
            </TouchableOpacity>
          </View>
          {showDirection && (
            <Chips items={DIR_FILTERS} value={dir} onChange={setDir} />
          )}
          <Chips items={STATUS_FILTERS} value={status} onChange={setStatus} />
          <Text style={styles.summary}>
            {rows.length} nhiệm vụ · {done} đã xong
            {late ? ` · ${late} quá hạn` : ''}
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <TaskCard
          task={item.task}
          mode={item.mode}
          now={now}
          highlighted={item.task.id === highlightId}
          tag={
            showDirection
              ? item.mode === 'received'
                ? 'Được giao'
                : commander
                ? 'Tôi giao'
                : 'Tự giao'
              : undefined
          }
        />
      )}
      ListEmptyComponent={
        <Text style={styles.empty}>Không có nhiệm vụ phù hợp.</Text>
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.md, paddingBottom: spacing.xl },
  empty: {
    color: colors.textMuted,
    fontStyle: 'italic',
    textAlign: 'center',
    padding: spacing.lg,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    color: colors.text,
    backgroundColor: '#fff',
    fontSize: 15,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTextOn: { color: '#fff' },
  filterRow: { gap: 6, paddingTop: spacing.sm },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  monthBtn: { paddingHorizontal: spacing.md, paddingVertical: 10 },
  monthArrow: { color: colors.primary, fontSize: 16, fontWeight: '700' },
  monthMid: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  monthText: { color: colors.text, fontWeight: '700' },
  monthHint: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  summary: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  pad: { padding: spacing.lg },
  errorText: { color: colors.danger, padding: spacing.md },
});
