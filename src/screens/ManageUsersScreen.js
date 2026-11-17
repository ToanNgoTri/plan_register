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
  approveChiefRequest,
  approveUser,
  deactivateUser,
  deleteUser,
  displayNameOf,
  isChiefRequest,
  reactivateUser,
  rejectChiefRequest,
  setUserPosition,
  subscribeChiefRequests,
  subscribeToUsers,
} from '../services/userService';
import { useAuth } from '../context/AuthContext';
import { unitName } from '../config/units';
import PositionSelect from '../components/PositionSelect';
import { ADMIN_POSITION, BOSS_POSITION, POSITIONS } from '../config/constants';

const SPECIAL = [BOSS_POSITION, ADMIN_POSITION];
// Chức vụ thường (admin đơn vị chỉ đổi được các chức vụ này).
const PLAIN_POSITIONS = POSITIONS.filter(p => !SPECIAL.includes(p));
import { colors, spacing } from '../theme';
/**
 * Boss screen to manage the user accounts OF THE BOSS'S OWN ĐƠN VỊ (staff,
 * boss, dev) — người đơn vị khác không hiện ở đây (và rules cũng chặn):
 *  - Chờ duyệt  → Duyệt / Xóa
 *  - Đang hoạt động → Ngừng hoạt động / Xóa
 *  - Ngừng hoạt động → Kích hoạt lại / Xóa
 *
 * Yêu cầu làm Trưởng CA chỉ DEV duyệt: dev thấy thêm mục "Yêu cầu Trưởng CA"
 * của MỌI đơn vị (Duyệt / Từ chối); Trưởng CA đơn vị chỉ thấy "Chờ dev duyệt".
 */
export default function ManageUsersScreen() {
  const { isDev, isAdmin, isBoss } = useAuth();
  // Giao / thu / chuyển Trưởng CA và Cán bộ (admin): Trưởng CA đơn vị hoặc dev.
  const canAssignSpecial = isBoss || isDev;
  // Duyệt yêu cầu Trưởng CA: admin của đơn vị, hoặc dev (mọi đơn vị).
  const canApproveChief = isDev || isAdmin;
  const [users, setUsers] = useState([]);
  const [chiefRequests, setChiefRequests] = useState([]);
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    const unsub = subscribeToUsers(setUsers, e =>
      Alert.alert('Lỗi', e.message),
    );
    return unsub;
  }, []);
  useEffect(() => {
    if (!isDev) {
      setChiefRequests([]);
      return undefined;
    }
    return subscribeChiefRequests(setChiefRequests, e =>
      Alert.alert('Lỗi', e.message),
    );
  }, [isDev]);
  const sections = useMemo(() => {
    // Với dev, yêu cầu Trưởng CA đã nằm ở mục riêng (mọi đơn vị).
    const pending = users.filter(
      u => !u.approved && !(isDev && isChiefRequest(u)),
    );
    const active = users.filter(u => u.approved && u.active !== false);
    const inactive = users.filter(u => u.approved && u.active === false);
    return [
      ...(isDev
        ? [
            {
              title: `Yêu cầu Trưởng CA (${chiefRequests.length})`,
              kind: 'chief',
              data: chiefRequests,
            },
          ]
        : []),
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
  }, [users, chiefRequests, isDev]);
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
  // Đổi chức vụ. Giao Trưởng CA / admin khi đã có người giữ = chuyển chức
  // (người cũ về Cán bộ); thu chức = đổi sang chức vụ thường. Hỏi lại trước.
  const changePosition = (u, position) => {
    if (!position || position === u.position) {
      return;
    }
    const run = withBusy(u.uid, () => setUserPosition(u, position));
    const name = displayNameOf(u);
    if (SPECIAL.includes(position)) {
      const holder = users.find(
        x => x.uid !== u.uid && x.position === position && x.approved,
      );
      Alert.alert(
        position === ADMIN_POSITION ? 'Giao Cán bộ (admin)' : 'Giao Trưởng CA',
        `Giao chức ${position} cho "${name}"?` +
          (holder
            ? ` "${displayNameOf(
                holder,
              )}" sẽ thôi giữ chức này và trở về Cán bộ.`
            : ''),
        [
          { text: 'Huỷ', style: 'cancel' },
          { text: 'Giao', onPress: run },
        ],
      );
      return;
    }
    if (SPECIAL.includes(u.position)) {
      Alert.alert(
        'Thu chức',
        `Thu chức ${u.position} của "${name}" (chuyển thành ${position})?`,
        [
          { text: 'Huỷ', style: 'cancel' },
          { text: 'Thu chức', style: 'destructive', onPress: run },
        ],
      );
      return;
    }
    run();
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
          onPress: withBusy(u.uid, () => deleteUser(u)),
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
    if (kind === 'chief') {
      return [
        {
          label: 'Duyệt',
          color: colors.success,
          run: withBusy(u.uid, () => approveChiefRequest(u)),
        },
        {
          label: 'Từ chối',
          color: colors.danger,
          run: withBusy(u.uid, () => rejectChiefRequest(u)),
        },
      ];
    }
    if (kind === 'pending') {
      if (isChiefRequest(u)) {
        // Trưởng CA không duyệt được yêu cầu làm Trưởng CA — admin / dev duyệt.
        return canApproveChief
          ? [
              {
                label: 'Duyệt',
                color: colors.success,
                run: withBusy(u.uid, () => approveChiefRequest(u)),
              },
              {
                label: 'Từ chối',
                color: colors.danger,
                run: withBusy(u.uid, () => rejectChiefRequest(u)),
              },
            ]
          : [del];
      }
      return [
        {
          label: 'Duyệt',
          color: colors.success,
          run: withBusy(u.uid, () => approveUser(u)),
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
              {section.kind === 'chief' ? (
                <Text style={styles.unitLine}>
                  Xin làm Trưởng CA · {unitName(item.unitId)}
                </Text>
              ) : isChiefRequest(item) ? (
                <Text style={styles.unitLine}>
                  Xin làm Trưởng CA
                  {canApproveChief ? '' : ' · chờ admin đơn vị duyệt'}
                </Text>
              ) : null}
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
          {section.kind === 'chief' ||
          item.role === 'dev' ||
          (!canAssignSpecial && SPECIAL.includes(item.position)) ? null : (
            <View style={styles.posRow}>
              <Text style={styles.posLabel}>Chức vụ</Text>
              <View style={styles.posSelect}>
                <PositionSelect
                  value={item.position}
                  options={
                    canAssignSpecial && item.approved
                      ? POSITIONS
                      : PLAIN_POSITIONS.concat(
                          SPECIAL.includes(item.position)
                            ? [item.position]
                            : [],
                        )
                  }
                  onChange={p => changePosition(item, p)}
                />
              </View>
            </View>
          )}
        </View>
      )}
    />
  );
}
const styles = StyleSheet.create({
  unitLine: {
    color: colors.warning,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
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
