import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { TASK_STATUS } from '../services/taskService';
import { formatDateTimeVi } from '../utils/date';
import { colors, spacing } from '../theme';

/**
 * Thẻ hiển thị một nhiệm vụ — dùng chung cho màn Nhiệm vụ (kèm nút thao tác)
 * và mục "Nhiệm vụ" của màn Lịch sử (chỉ xem).
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const STATUS_META = {
  [TASK_STATUS.PENDING]: { label: 'Đang làm', color: colors.primary },
  [TASK_STATUS.SUBMITTED]: { label: 'Chờ duyệt', color: colors.warning },
  [TASK_STATUS.APPROVED]: { label: 'Đã duyệt', color: colors.success },
};

const LOG_LABEL = {
  created: 'Giao nhiệm vụ',
  edited: 'Sửa nhiệm vụ',
  submitted: 'Báo hoàn thành',
  postponed: 'Hoãn',
  approved: 'Duyệt',
  rejected: 'Từ chối',
  completed: 'Hoàn thành (tự giao)',
};

/** Thời điểm tròn 5 phút gần nhất sau `ms`. */
/** "còn 2 giờ 5 phút" / "quá hạn 1 ngày". */
function relativeDue(dueAt, now) {
  const diff = dueAt - now;
  const abs = Math.abs(diff);
  const days = Math.floor(abs / (24 * HOUR));
  const hours = Math.floor((abs % (24 * HOUR)) / HOUR);
  const mins = Math.floor((abs % HOUR) / MINUTE);
  let text;
  if (days > 0) {
    text = `${days} ngày${hours ? ` ${hours} giờ` : ''}`;
  } else if (hours > 0) {
    text = `${hours} giờ${mins ? ` ${mins} phút` : ''}`;
  } else {
    text = `${Math.max(mins, 1)} phút`;
  }
  return diff >= 0 ? `còn ${text}` : `quá hạn ${text}`;
}

export default function TaskCard({
  task,
  mode,
  now,
  highlighted,
  actions = [],
  tag,
}) {
  const [showLog, setShowLog] = useState(false);
  const self = task.assignerUid === task.assigneeUid;
  const baseMeta = STATUS_META[task.status] ?? STATUS_META[TASK_STATUS.PENDING];
  // Việc tự giao không qua duyệt: "Đã duyệt" đọc thành "Hoàn thành".
  const meta =
    self && task.status === TASK_STATUS.APPROVED
      ? { ...baseMeta, label: 'Hoàn thành' }
      : baseMeta;
  const pending = task.status === TASK_STATUS.PENDING;
  const overdue = pending && task.dueAt <= now;
  const log = Array.isArray(task.log) ? [...task.log].reverse() : [];

  return (
    <View
      style={[
        styles.card,
        overdue && styles.cardOverdue,
        highlighted && styles.cardHighlight,
      ]}
    >
      <View style={styles.cardTop}>
        <Text style={styles.cardTitle}>{task.title}</Text>
        <View style={[styles.badge, { backgroundColor: meta.color }]}>
          <Text style={styles.badgeText}>{meta.label}</Text>
        </View>
      </View>
      {task.content ? (
        <Text style={styles.cardContent}>{task.content}</Text>
      ) : null}
      <Text style={styles.cardSub}>
        {tag ? `${tag} · ` : ''}
        {task.assignerUid === task.assigneeUid
          ? 'Tự giao cho bản thân'
          : mode === 'received'
          ? `Người giao: ${task.assignerName}`
          : `Người nhận: ${task.assigneeName}`}
      </Text>
      <Text style={[styles.cardDue, overdue && styles.dueOverdue]}>
        Hạn: {formatDateTimeVi(task.dueAt)}
        {pending ? ` (${relativeDue(task.dueAt, now)})` : ''}
      </Text>

      {pending && task.rejectReason ? (
        <View style={styles.rejectBox}>
          <Text style={styles.rejectTitle}>
            ✖ Bị từ chối
            {task.rejectCount > 1 ? ` (lần ${task.rejectCount})` : ''}
          </Text>
          <Text style={styles.rejectText}>{task.rejectReason}</Text>
        </View>
      ) : null}
      {pending && task.lastPostponeReason ? (
        <Text style={styles.cardNote}>
          ⏸ Đã hoãn {task.postponeCount || 1} lần — {task.lastPostponeReason}
        </Text>
      ) : null}
      {task.status === TASK_STATUS.APPROVED && task.approvedAt ? (
        <Text style={styles.cardNote}>
          {self ? 'Hoàn thành lúc' : 'Duyệt lúc'}{' '}
          {formatDateTimeVi(task.approvedAt)}
        </Text>
      ) : null}
      {task.status === TASK_STATUS.SUBMITTED && task.submittedAt ? (
        <Text style={styles.cardNote}>
          Báo hoàn thành lúc {formatDateTimeVi(task.submittedAt)}
        </Text>
      ) : null}

      {actions.length > 0 && (
        <View style={styles.cardActions}>
          {actions.map(a => (
            <TouchableOpacity
              key={a.label}
              style={[styles.btnSm, { backgroundColor: a.color }]}
              onPress={a.run}
            >
              <Text style={styles.btnText}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {log.length > 0 && (
        <TouchableOpacity onPress={() => setShowLog(s => !s)}>
          <Text style={styles.logToggle}>
            {showLog ? '▾ Ẩn nhật ký' : `▸ Nhật ký (${log.length})`}
          </Text>
        </TouchableOpacity>
      )}
      {showLog &&
        log.map((l, i) => (
          <Text key={`${l.at}-${i}`} style={styles.logLine}>
            {formatDateTimeVi(l.at)} · {l.byName}: {LOG_LABEL[l.type] ?? l.type}
            {l.dueAt && l.type !== 'approved' && l.type !== 'submitted'
              ? ` → hạn ${formatDateTimeVi(l.dueAt)}`
              : ''}
            {l.note ? ` — “${l.note}”` : ''}
          </Text>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardOverdue: { borderColor: colors.danger, backgroundColor: colors.dangerBg },
  cardHighlight: { borderColor: colors.primary, borderWidth: 2 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start' },
  cardTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    paddingRight: spacing.sm,
  },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  cardContent: { color: colors.text, marginTop: spacing.xs, fontSize: 14 },
  cardSub: { color: colors.textMuted, marginTop: spacing.xs, fontSize: 13 },
  cardDue: {
    color: colors.text,
    marginTop: 2,
    fontSize: 13,
    fontWeight: '600',
  },
  dueOverdue: { color: colors.danger },
  cardNote: { color: colors.textMuted, marginTop: spacing.xs, fontSize: 13 },
  rejectBox: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.dangerBg,
    borderLeftWidth: 3,
    borderLeftColor: colors.danger,
  },
  rejectTitle: { color: colors.danger, fontWeight: '700', fontSize: 13 },
  rejectText: { color: colors.text, marginTop: 2, fontSize: 14 },
  cardActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  btnSm: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  logToggle: {
    color: colors.primary,
    marginTop: spacing.sm,
    fontWeight: '600',
    textAlign: 'center',
  },
  logLine: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
});
