import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FORCES } from '../config/constants';
import { colors, spacing } from '../theme';

/** Thanh chuyển giữa 2 lực lượng (CA / ANCS) ở đầu màn hình Lịch trực. */
export default function ForceTabs({ value, onChange }) {
  return (
    <View style={styles.wrap}>
      {FORCES.map(force => {
        const active = force.id === value;
        return (
          <TouchableOpacity
            key={force.id}
            style={[styles.tab, active && styles.tabActive]}
            activeOpacity={0.85}
            onPress={() => onChange(force.id)}
          >
            <Text style={[styles.label, active && styles.labelActive]}>
              {force.label}
            </Text>
            <Text style={[styles.sub, active && styles.subActive]}>
              {force.title}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xs,
    gap: spacing.xs,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: 9,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: colors.primary,
  },
  label: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  labelActive: {
    color: '#fff',
  },
  sub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  subActive: {
    color: '#e8f0ff',
  },
});
