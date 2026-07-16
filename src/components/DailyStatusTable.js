import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme';
import { displayNameOf } from '../services/userService';
/**
 * Boss table for one day. Rows where the staff member has NOT registered are
 * highlighted red.
 */
export default function DailyStatusTable({ rows }) {
  if (rows.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Chưa có nhân viên nào được duyệt.</Text>
      </View>
    );
  }
  const done = rows.filter(r => r.registered).length;
  return (
    <View>
      <Text style={styles.summary}>
        Đã đăng ký {done}/{rows.length}
      </Text>
      <View style={styles.headerRow}>
        <Text style={[styles.cell, styles.nameCell, styles.headerText]}>
          Họ tên / Đơn vị
        </Text>
        <Text style={[styles.cell, styles.contentCell, styles.headerText]}>
          Kế hoạch
        </Text>
      </View>
      {rows.map(row => (
        <View
          key={row.user.uid}
          style={[styles.row, !row.registered && styles.rowDanger]}
        >
          <View style={[styles.cell, styles.nameCell]}>
            <Text style={styles.name}>
              {displayNameOf(row.user)}
              {row.formerUser ? ' ' : ''}
              {row.formerUser && <Text style={styles.former}>(đã rời)</Text>}
            </Text>
            {!!row.user.unit && (
              <Text style={styles.unit}>{row.user.unit}</Text>
            )}
          </View>
          <View style={[styles.cell, styles.contentCell]}>
            {row.registered ? (
              <Text style={styles.content}>{row.entry?.content}</Text>
            ) : (
              <Text style={styles.notRegistered}>Chưa đăng ký</Text>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  summary: {
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: colors.primary,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  headerText: {
    color: '#fff',
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  rowDanger: {
    backgroundColor: colors.dangerBg,
  },
  cell: {
    padding: spacing.sm,
  },
  nameCell: {
    width: 130,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
  contentCell: {
    flex: 1,
  },
  name: {
    color: colors.text,
    fontWeight: '600',
  },
  former: {
    color: colors.warning,
    fontWeight: '400',
    fontSize: 12,
  },
  unit: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  content: {
    color: colors.text,
  },
  notRegistered: {
    color: colors.danger,
    fontWeight: '700',
  },
  empty: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    color: colors.textMuted,
  },
});
