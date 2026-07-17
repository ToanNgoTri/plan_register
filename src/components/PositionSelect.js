import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
} from 'react-native';
import { POSITIONS } from '../config/constants';
import { colors, spacing } from '../theme';

/**
 * A lightweight dropdown for picking a chức vụ (position). Tapping the field
 * opens a modal list of {@link POSITIONS}; the selected value is passed back
 * via onChange. Kept dependency-free (no native picker) so it works everywhere.
 */
export default function PositionSelect({
  value,
  onChange,
  options = POSITIONS,
  title = 'Chọn chức vụ',
  placeholder = 'Chọn chức vụ',
}) {
  const [open, setOpen] = useState(false);
  // Options may be plain strings or { label, value } objects.
  const items = options.map(o =>
    typeof o === 'string' ? { label: o, value: o } : o,
  );
  const selectedLabel = items.find(i => i.value === value)?.label;
  const pick = v => {
    onChange(v);
    setOpen(false);
  };
  return (
    <>
      <TouchableOpacity
        style={styles.field}
        activeOpacity={0.7}
        onPress={() => setOpen(true)}
      >
        <Text style={selectedLabel ? styles.valueText : styles.placeholderText}>
          {selectedLabel || placeholder}
        </Text>
        <Text style={styles.chevron}>▾</Text>
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <ScrollView>
              {items.map(({ label, value: v }) => {
                const selected = v === value;
                return (
                  <TouchableOpacity
                    key={v}
                    style={[styles.option, selected && styles.optionSelected]}
                    activeOpacity={0.7}
                    onPress={() => pick(v)}
                  >
                    <Text
                      style={[
                        styles.optionText,
                        selected && styles.optionTextSelected,
                      ]}
                    >
                      {label}
                    </Text>
                    {selected ? <Text style={styles.check}>✓</Text> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
const styles = StyleSheet.create({
  field: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  valueText: {
    color: colors.text,
    fontSize: 15,
  },
  placeholderText: {
    color: colors.textMuted,
    fontSize: 15,
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 14,
    marginLeft: spacing.sm,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  sheet: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: spacing.md,
    maxHeight: '70%',
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
  },
  optionSelected: {
    backgroundColor: colors.bg,
  },
  optionText: {
    fontSize: 15,
    color: colors.text,
  },
  optionTextSelected: {
    color: colors.primary,
    fontWeight: '700',
  },
  check: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 16,
  },
});
