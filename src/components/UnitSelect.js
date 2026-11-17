import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { UNITS, unitName } from '../config/units';
import { colors, spacing } from '../theme';

/** Bỏ dấu + chữ thường, để gõ "hang gon" vẫn ra "Phường Hàng Gòn". */
function fold(s) {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/**
 * Chọn đơn vị (xã/phường) trong 95 đơn vị của Đồng Nai. Danh sách dài nên có
 * ô tìm kiếm, không phân biệt dấu. Trả về `id` của đơn vị qua onChange.
 */
export default function UnitSelect({ value, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const items = useMemo(() => {
    const q = fold(search.trim());
    return q ? UNITS.filter(u => fold(u.name).includes(q)) : UNITS;
  }, [search]);
  const close = () => {
    setOpen(false);
    setSearch('');
  };
  const pick = id => {
    onChange(id);
    close();
  };
  const label = value ? unitName(value) : '';
  return (
    <>
      <TouchableOpacity
        style={[styles.field, disabled && styles.fieldDisabled]}
        activeOpacity={0.7}
        disabled={disabled}
        onPress={() => setOpen(true)}
      >
        <Text style={label ? styles.valueText : styles.placeholderText}>
          {label || 'Chọn xã / phường'}
        </Text>
        {disabled ? null : <Text style={styles.chevron}>▾</Text>}
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={close}
      >
        <Pressable style={styles.backdrop} onPress={close}>
          <Pressable style={styles.sheet}>
            <Text style={styles.sheetTitle}>Chọn đơn vị</Text>
            <TextInput
              style={styles.search}
              value={search}
              onChangeText={setSearch}
              placeholder="Tìm xã / phường…"
              placeholderTextColor={colors.textMuted}
              autoCorrect={false}
            />
            <FlatList
              data={items}
              keyExtractor={u => u.id}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={20}
              ListEmptyComponent={
                <Text style={styles.empty}>Không có đơn vị phù hợp.</Text>
              }
              renderItem={({ item }) => {
                const selected = item.id === value;
                return (
                  <TouchableOpacity
                    style={[styles.option, selected && styles.optionSelected]}
                    activeOpacity={0.7}
                    onPress={() => pick(item.id)}
                  >
                    <Text
                      style={[
                        styles.optionText,
                        selected && styles.optionTextSelected,
                      ]}
                    >
                      {item.name}
                    </Text>
                    {selected ? <Text style={styles.check}>✓</Text> : null}
                  </TouchableOpacity>
                );
              }}
            />
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
  fieldDisabled: {
    backgroundColor: colors.bg,
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
    height: '75%',
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  search: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
    marginBottom: spacing.sm,
  },
  empty: {
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
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
