import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  approveUser,
  deactivateUser,
  deleteUser,
  displayNameOf,
  reactivateUser,
  setUserPosition,
  subscribeToStaff,
} from '../services/userService';
import PositionSelect from '../components/PositionSelect';
import { colors, spacing } from '../theme';
/**
 * Boss screen to manage staff accounts:
 *  - Chờ duyệt  → Duyệt / Xóa
 *  - Đang hoạt động → Ngừng hoạt động / Xóa
 *  - Ngừng hoạt động → Kích hoạt lại / Xóa
 */
export default function ManageUsersScreen() {
  const [staff, setStaff] = useState([]);
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    const unsub = subscribeToStaff(setStaff, e =>
      Alert.alert('Lỗi', e.message),
    );
    return unsub;
  }, []);
  const sections = useMemo(() => {
    const pending = staff.filter(u => !u.approved);
    const active = staff.filter(u => u.approved && u.active !== false);
    const inactive = staff.filter(u => u.approved && u.active === false);
    return [
      {
        title: `Chờ duyệt (${pending.length})`,
        kind: 'pending',
        data: pending,
      },
      {
        title: `Đang hoạt động (${active.length})`,
        kind: 'active',
        data: active,
      },
      {
        title: `Ngừng hoạt động (${inactive.length})`,
        kind: 'inactive',
        data: inactive,
      },
    ];
  }, [staff]);
  const withBusy = (uid, fn) => async () => {
    try {
      setBusy(uid);
      await fn();
    } catch (e) {
      Alert.alert('Lỗi', e?.message ?? 'Thao tác thất bại.');
    } finally {
      setBusy(null);
    }
  };
  // Change a user's chức vụ; picking "Trưởng CA" promotes them to boss (and
  // they then drop off this staff list). No-op if the value is unchanged.
  const changePosition = (u, position) => {
    if (!position || position === u.position) {
      return;
    }
    withBusy(u.uid, () => setUserPosition(u.uid, position, u.role))();
  };
  const confirmDelete = u =>
    Alert.alert(
      'Xóa người dùng',
      `Xóa tài khoản "${displayNameOf(
        u,
      )}"? Tài khoản sẽ mất quyền truy cập ngay lập tức. (Lịch sử đã đăng ký được giữ lại.)`,
      [
        {
          text: 'Huỷ',
          style: 'cancel',
        },
        {
          text: 'Xóa',
          style: 'destructive',
          onPress: withBusy(u.uid, () => deleteUser(u.uid)),
        },
      ],
    );
  const confirmDeactivate = u =>
    Alert.alert(
      'Ngừng hoạt động',
      `Vô hiệu hóa "${displayNameOf(
        u,
      )}"? Họ sẽ bị khóa chức năng và ẩn khỏi bảng theo dõi.`,
      [
        {
          text: 'Huỷ',
          style: 'cancel',
        },
        {
          text: 'Ngừng hoạt động',
          style: 'destructive',
          onPress: withBusy(u.uid, () => deactivateUser(u.uid)),
        },
      ],
    );
  const actionsFor = (kind, u) => {
    const del = {
      label: 'Xóa',
      color: colors.danger,
      run: async () => confirmDelete(u),
    };
    if (kind === 'pending') {
      return [
        {
          label: 'Duyệt',
          color: colors.success,
          run: withBusy(u.uid, () => approveUser(u.uid)),
        },
        del,
      ];
    }
    if (kind === 'active') {
      return [
        {
          label: 'Ngừng',
          color: colors.warning,
          run: async () => confirmDeactivate(u),
        },
        del,
      ];
    }
    return [
      {
        label: 'Kích hoạt',
        color: colors.success,
        run: withBusy(u.uid, () => reactivateUser(u.uid)),
      },
      del,
    ];
  };
  return (
    <SectionList
      style={styles.flex}
      sections={sections}
      keyExtractor={u => u.uid}
      contentContainerStyle={styles.container}
      stickySectionHeadersEnabled={false}
      renderSectionHeader={({ section }) => (
        <Text style={styles.section}>{section.title}</Text>
      )}
      renderSectionFooter={({ section }) =>
        section.data.length === 0 ? (
          <Text style={styles.emptySection}>— Không có —</Text>
        ) : null
      }
      renderItem={({ item, section }) => (
        <View style={styles.card}>
          <View style={styles.topRow}>
            <View style={styles.info}>
              <Text style={styles.name}>{displayNameOf(item)}</Text>
              <Text style={styles.sub}>{item.email}</Text>
              <Text style={styles.sub}>
                {item.unit ? item.unit : 'Chưa nhập đơn vị'}
              </Text>
            </View>
            <View style={styles.actions}>
              {actionsFor(section.kind, item).map(a => (
                <TouchableOpacity
                  key={a.label}
                  disabled={busy === item.uid}
                  onPress={() => a.run()}
                  style={[
                    styles.btn,
                    {
                      backgroundColor: a.color,
                    },
                  ]}
                >
                  <Text style={styles.btnText}>
                    {busy === item.uid ? '…' : a.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={styles.posRow}>
            <Text style={styles.posLabel}>Chức vụ</Text>
            <View style={styles.posSelect}>
              <PositionSelect
                value={item.position}
                onChange={p =>
                  changePosition(item, p)
                }
              />
            </View>
          </View>
        </View>
      )}
    />
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
  section: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  emptySection: {
    color: colors.textMuted,
    fontStyle: 'italic',
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  posRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  posLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    marginRight: spacing.sm,
  },
  posSelect: {
    flex: 1,
  },
  info: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  name: {
    fontWeight: '700',
    color: colors.text,
    fontSize: 15,
  },
  sub: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  actions: {
    gap: spacing.xs,
  },
  btn: {
    paddingVertical: 7,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    alignItems: 'center',
    minWidth: 92,
  },
  btnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
});
