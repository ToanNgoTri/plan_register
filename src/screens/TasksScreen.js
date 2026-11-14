import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { useTasks } from '../hooks/useTasks';
import {
  approveTask,
  createTask,
  deleteTask,
  finishTask,
  isCommanderProfile,
  isSelfTask,
  postponeTask,
  rejectTask,
  submitTask,
  subscribeAssignableUsers,
  TASK_STATUS,
  updateTaskInfo,
} from '../services/taskService';
import {
  addTaskOpenListener,
  takePendingTaskOpen,
} from '../services/taskNotificationService';
import { displayNameOf } from '../services/userService';
import TaskCard from '../components/TaskCard';
import { formatDateTimeVi } from '../utils/date';
import { colors, spacing } from '../theme';

/**
 * Nhiệm vụ.
 *  - Chỉ huy (Trưởng / Phó Trưởng CA): giao nhiệm vụ cho một người, có hạn
 *    hoàn thành; duyệt hoặc từ chối (kèm lý do + hạn mới) khi người nhận báo
 *    xong.
 *  - Người nhận: "Hoàn thành" (chờ duyệt) hoặc "Hoãn" (chọn hạn mới + lý do).
 * Mỗi nhiệm vụ chỉ người giao và người nhận thấy.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function roundUp5(ms) {
  const step = 5 * MINUTE;
  return Math.ceil(ms / step) * step;
}

function defaultDue() {
  const d = new Date(Date.now() + 2 * HOUR);
  return new Date(roundUp5(d.getTime()));
}

// ---------------------------------------------------------------------------
// Chọn ngày + giờ
// ---------------------------------------------------------------------------

/**
 * Ô chọn ngày giờ. Android không có chế độ "datetime" nên mở lần lượt hộp
 * chọn ngày rồi hộp chọn giờ; iOS hiện bánh xe ngay trong form (không mở
 * Modal lồng trong Modal).
 */
function DateTimeField({ value, onChange, quick = [] }) {
  const [iosOpen, setIosOpen] = useState(false);
  const minimumDate = new Date();

  const openAndroid = () => {
    DateTimePickerAndroid.open({
      value,
      mode: 'date',
      minimumDate,
      onChange: (event, date) => {
        if (event.type !== 'set' || !date) {
          return;
        }
        const picked = new Date(value);
        picked.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
        DateTimePickerAndroid.open({
          value: picked,
          mode: 'time',
          is24Hour: true,
          onChange: (ev2, time) => {
            if (ev2.type !== 'set' || !time) {
              return;
            }
            const out = new Date(picked);
            out.setHours(time.getHours(), time.getMinutes(), 0, 0);
            onChange(out);
          },
        });
      },
    });
  };

  return (
    <View>
      <TouchableOpacity
        style={styles.input}
        onPress={() =>
          Platform.OS === 'ios' ? setIosOpen(o => !o) : openAndroid()
        }
      >
        <Text style={styles.inputText}>🕒 {formatDateTimeVi(value)}</Text>
      </TouchableOpacity>
      {quick.length > 0 && (
        <View style={styles.chips}>
          {quick.map(q => (
            <TouchableOpacity
              key={q.label}
              style={styles.chip}
              onPress={() => onChange(new Date(q.at()))}
            >
              <Text style={styles.chipText}>{q.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {Platform.OS === 'ios' && iosOpen && (
        <DateTimePicker
          value={value}
          mode="datetime"
          display="spinner"
          themeVariant="light"
          locale="vi-VN"
          minimumDate={minimumDate}
          onChange={(_, d) => d && onChange(d)}
        />
      )}
    </View>
  );
}

/** Hạn nhanh, tính từ max(bây giờ, hạn cũ) — dùng cho Hoãn / Từ chối. */
function quickFrom(baseMs) {
  const base = () => Math.max(Date.now(), baseMs || 0);
  const tomorrowAt8 = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
    return d.getTime();
  };
  return [
    { label: '+30 phút', at: () => roundUp5(base() + 30 * MINUTE) },
    { label: '+1 giờ', at: () => roundUp5(base() + HOUR) },
    { label: '+1 ngày', at: () => base() + 24 * HOUR },
    { label: 'Sáng mai 8:00', at: tomorrowAt8 },
  ];
}

// ---------------------------------------------------------------------------
// Hộp nhập lý do + hạn mới (Hoãn / Từ chối)
// ---------------------------------------------------------------------------

function ReasonDueModal({
  visible,
  title,
  subtitle,
  reasonLabel,
  reasonRequired,
  confirmLabel,
  confirmColor,
  initialDue,
  onCancel,
  onConfirm,
}) {
  const [reason, setReason] = useState('');
  const [due, setDue] = useState(initialDue);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setReason('');
      setDue(initialDue);
      setBusy(false);
    }
  }, [visible, initialDue]);

  const submit = async () => {
    if (reasonRequired && !reason.trim()) {
      Alert.alert(
        'Thiếu nội dung',
        `Vui lòng nhập ${reasonLabel.toLowerCase()}.`,
      );
      return;
    }
    if (due.getTime() <= Date.now()) {
      Alert.alert('Hạn không hợp lệ', 'Hạn mới phải ở sau thời điểm hiện tại.');
      return;
    }
    setBusy(true);
    try {
      await onConfirm(reason.trim(), due.getTime());
    } catch (e) {
      Alert.alert('Lỗi', e?.message ?? 'Thao tác thất bại.');
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        // Android 15+ ép edge-to-edge: modal không tự co khi bàn phím mở, nên
        // phải tự chừa chỗ bằng padding trên CẢ HAI nền tảng.
        behavior="padding"
      >
        <View style={styles.sheet}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
          >
            <Text style={styles.sheetTitle}>{title}</Text>
            {subtitle ? <Text style={styles.sheetSub}>{subtitle}</Text> : null}
            <Text style={styles.label}>
              {reasonLabel}
              {reasonRequired ? ' *' : ' (không bắt buộc)'}
            </Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={reason}
              onChangeText={setReason}
              placeholder="Nhập nội dung…"
              placeholderTextColor={colors.textMuted}
              multiline
            />
            <Text style={styles.label}>Hạn hoàn thành mới *</Text>
            <DateTimeField
              value={due}
              onChange={setDue}
              quick={quickFrom(initialDue?.getTime())}
            />
            <View style={styles.sheetActions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnGhost]}
                onPress={onCancel}
                disabled={busy}
              >
                <Text style={styles.btnGhostText}>Huỷ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: confirmColor }]}
                onPress={submit}
                disabled={busy}
              >
                <Text style={styles.btnText}>{busy ? '…' : confirmLabel}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Form giao / sửa nhiệm vụ
// ---------------------------------------------------------------------------

/**
 * `selfOnly`: cán bộ chỉ tự giao cho bản thân → không có ô chọn người nhận.
 */
function TaskFormModal({ visible, me, editing, selfOnly, onClose }) {
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [search, setSearch] = useState('');
  const [assigneeUid, setAssigneeUid] = useState(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [due, setDue] = useState(defaultDue);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setBusy(false);
    setSearch('');
    if (editing) {
      setTitle(editing.title);
      setContent(editing.content || '');
      setDue(new Date(editing.dueAt));
      setAssigneeUid(editing.assigneeUid);
    } else {
      setTitle('');
      setContent('');
      setDue(defaultDue());
      setAssigneeUid(null);
    }
  }, [visible, editing]);

  useEffect(() => {
    if (!visible || editing || selfOnly) {
      return undefined;
    }
    setLoadingUsers(true);
    return subscribeAssignableUsers(
      me,
      list => {
        setUsers(list);
        setLoadingUsers(false);
      },
      e => {
        setLoadingUsers(false);
        Alert.alert('Không tải được danh sách cán bộ', e.message);
      },
    );
  }, [visible, editing, selfOnly, me]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return users;
    }
    return users.filter(u =>
      `${displayNameOf(u)} ${u.position || ''} ${u.unit || ''}`
        .toLowerCase()
        .includes(q),
    );
  }, [users, search]);

  const save = async () => {
    if (!title.trim()) {
      Alert.alert('Thiếu tiêu đề', 'Vui lòng nhập tên nhiệm vụ.');
      return;
    }
    const assignee = selfOnly ? me : users.find(u => u.uid === assigneeUid);
    if (!editing && !assignee) {
      Alert.alert('Chưa chọn người', 'Chọn cán bộ nhận nhiệm vụ.');
      return;
    }
    if (due.getTime() <= Date.now()) {
      Alert.alert('Hạn không hợp lệ', 'Hạn hoàn thành phải ở tương lai.');
      return;
    }
    setBusy(true);
    try {
      const data = { title, content, dueAt: due.getTime() };
      if (editing) {
        await updateTaskInfo(me, editing, data);
      } else {
        await createTask(me, assignee, data);
      }
      onClose();
    } catch (e) {
      Alert.alert('Lỗi', e?.message ?? 'Không lưu được nhiệm vụ.');
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        // Android 15+ ép edge-to-edge: modal không tự co khi bàn phím mở, nên
        // phải tự chừa chỗ bằng padding trên CẢ HAI nền tảng.
        behavior="padding"
      >
        <View style={[styles.sheet, styles.sheetTall]}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
          >
            <Text style={styles.sheetTitle}>
              {editing
                ? 'Sửa nhiệm vụ'
                : selfOnly
                ? 'Tự giao nhiệm vụ'
                : 'Giao nhiệm vụ'}
            </Text>

            <Text style={styles.label}>Tên nhiệm vụ *</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="VD: Xác minh đơn của ông A"
              placeholderTextColor={colors.textMuted}
              maxLength={300}
            />

            <Text style={styles.label}>Nội dung / yêu cầu</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={content}
              onChangeText={setContent}
              placeholder="Mô tả chi tiết (không bắt buộc)"
              placeholderTextColor={colors.textMuted}
              multiline
            />

            <Text style={styles.label}>Hạn hoàn thành *</Text>
            <DateTimeField
              value={due}
              onChange={setDue}
              quick={quickFrom(Date.now())}
            />

            {!selfOnly && (editing ? !isSelfTask(editing) : true) && (
              <Text style={styles.label}>Người nhận *</Text>
            )}
            {selfOnly || (editing && isSelfTask(editing)) ? null : editing ? (
              <Text style={styles.fixedAssignee}>
                👤 {editing.assigneeName}
              </Text>
            ) : (
              <>
                <TextInput
                  style={styles.input}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="🔍 Tìm theo tên, chức vụ, đơn vị"
                  placeholderTextColor={colors.textMuted}
                />
                {loadingUsers ? (
                  <ActivityIndicator
                    style={styles.pad}
                    color={colors.primary}
                  />
                ) : (
                  <View style={styles.userList}>
                    {filtered.length === 0 ? (
                      <Text style={styles.empty}>
                        {users.length === 0
                          ? 'Không có cán bộ cấp dưới để giao.'
                          : 'Không có cán bộ phù hợp.'}
                      </Text>
                    ) : (
                      filtered.map(u => {
                        const selected = u.uid === assigneeUid;
                        return (
                          <TouchableOpacity
                            key={u.uid}
                            style={[
                              styles.userRow,
                              selected && styles.userRowSelected,
                            ]}
                            onPress={() => setAssigneeUid(u.uid)}
                          >
                            <Text style={styles.radio}>
                              {selected ? '◉' : '○'}
                            </Text>
                            <View style={styles.flex1}>
                              <Text style={styles.userName}>
                                {displayNameOf(u)}
                              </Text>
                              <Text style={styles.userSub}>
                                {[u.position, u.unit]
                                  .filter(Boolean)
                                  .join(' · ') || u.email}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        );
                      })
                    )}
                  </View>
                )}
              </>
            )}

            <View style={styles.sheetActions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnGhost]}
                onPress={onClose}
                disabled={busy}
              >
                <Text style={styles.btnGhostText}>Huỷ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: colors.primary }]}
                onPress={save}
                disabled={busy}
              >
                <Text style={styles.btnText}>
                  {busy ? '…' : editing ? 'Lưu' : selfOnly ? 'Tạo' : 'Giao'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const ORDER = {
  received: {
    [TASK_STATUS.PENDING]: 0,
    [TASK_STATUS.SUBMITTED]: 1,
    [TASK_STATUS.APPROVED]: 2,
  },
  given: {
    [TASK_STATUS.SUBMITTED]: 0,
    [TASK_STATUS.PENDING]: 1,
    [TASK_STATUS.APPROVED]: 2,
  },
};

function sortTasks(list, mode) {
  const order = ORDER[mode];
  return [...list].sort((a, b) => {
    const s = (order[a.status] ?? 9) - (order[b.status] ?? 9);
    if (s !== 0) {
      return s;
    }
    // Đã duyệt: mới nhất lên đầu; còn lại: hạn gần nhất lên đầu.
    return a.status === TASK_STATUS.APPROVED
      ? (b.approvedAt || 0) - (a.approvedAt || 0)
      : a.dueAt - b.dueAt;
  });
}

// ---------------------------------------------------------------------------
// Màn hình
// ---------------------------------------------------------------------------

export default function TasksScreen({ navigation }) {
  const { profile } = useAuth();
  const { ready, received, given, error } = useTasks();
  const commander = isCommanderProfile(profile);
  // 'received' = việc người khác giao cho tôi;
  // 'given'    = "Tôi giao": chỉ huy → việc giao cấp dưới, cán bộ → việc tự giao.
  const [tab, setTab] = useState('received');
  const [now, setNow] = useState(Date.now());
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  // { kind: 'postpone' | 'reject', task }
  const [dialog, setDialog] = useState(null);
  const [openReq, setOpenReq] = useState(null);
  const [highlightId, setHighlightId] = useState(null);

  // Cập nhật "còn … / quá hạn …" mỗi 30 giây khi đang xem màn hình.
  useFocusEffect(
    useCallback(() => {
      setNow(Date.now());
      const t = setInterval(() => setNow(Date.now()), 30 * 1000);
      return () => clearInterval(t);
    }, []),
  );

  // Việc tự giao nằm trong CẢ hai truy vấn → chỉ hiện ở "Tôi giao".
  const receivedOthers = useMemo(
    () => received.filter(t => !isSelfTask(t)),
    [received],
  );

  // Chưa có việc ai giao mà đã có việc "Tôi giao" → mở sẵn mục "Tôi giao".
  useEffect(() => {
    if (ready && receivedOthers.length === 0 && given.length > 0) {
      setTab('given');
    }
    // Chỉ chạy lần đầu có dữ liệu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Mở từ thông báo (bấm thông báo / nút "Hoãn").
  useEffect(() => {
    const pull = () => {
      const req = takePendingTaskOpen();
      if (req) {
        setOpenReq(req);
      }
    };
    pull();
    return addTaskOpenListener(pull);
  }, []);
  useFocusEffect(
    useCallback(() => {
      const req = takePendingTaskOpen();
      if (req) {
        setOpenReq(req);
      }
    }, []),
  );
  useEffect(() => {
    if (!openReq || !ready) {
      return;
    }
    const mine = received.find(t => t.id === openReq.taskId);
    const theirs = given.find(t => t.id === openReq.taskId);
    const task = mine ?? theirs;
    setOpenReq(null);
    if (!task) {
      return;
    }
    setHighlightId(task.id);
    if (task.status === TASK_STATUS.APPROVED) {
      // Việc đã xong chỉ còn nằm trong màn Lịch sử → mục "Nhiệm vụ".
      navigation.navigate('History', { view: 'tasks', highlightId: task.id });
      return;
    }
    setTab(mine && !isSelfTask(task) ? 'received' : 'given');
    if (
      mine &&
      openReq.action === 'postpone' &&
      mine.status === TASK_STATUS.PENDING
    ) {
      setDialog({ kind: 'postpone', task: mine });
    }
  }, [openReq, ready, received, given, navigation]);

  // Chỉ hiện việc còn dở; việc đã xong tra cứu ở màn Lịch sử.
  const visible = useMemo(() => {
    const list = tab === 'received' ? receivedOthers : given;
    return sortTasks(
      list.filter(t => t.status !== TASK_STATUS.APPROVED),
      tab,
    );
  }, [receivedOthers, given, tab]);

  const run = fn => async () => {
    try {
      await fn();
    } catch (e) {
      Alert.alert('Lỗi', e?.message ?? 'Thao tác thất bại.');
    }
  };

  const postponeAction = task => ({
    label: 'Hoãn',
    color: colors.warning,
    run: () => setDialog({ kind: 'postpone', task }),
  });

  const actionsFor = task => {
    if (isSelfTask(task)) {
      if (task.status !== TASK_STATUS.PENDING) {
        return [];
      }
      return [
        {
          label: 'Hoàn thành',
          color: colors.success,
          run: () =>
            Alert.alert('Hoàn thành', `Đánh dấu xong "${task.title}"?`, [
              { text: 'Huỷ', style: 'cancel' },
              {
                text: 'Hoàn thành',
                onPress: run(() => finishTask(profile, task)),
              },
            ]),
        },
        postponeAction(task),
        {
          label: 'Sửa',
          color: colors.primary,
          run: () => {
            setEditing(task);
            setFormOpen(true);
          },
        },
        {
          label: 'Xoá',
          color: colors.danger,
          run: () =>
            Alert.alert('Xoá nhiệm vụ', `Xoá "${task.title}"?`, [
              { text: 'Huỷ', style: 'cancel' },
              {
                text: 'Xoá',
                style: 'destructive',
                onPress: run(() => deleteTask(task)),
              },
            ]),
        },
      ];
    }
    if (tab === 'received') {
      if (task.status !== TASK_STATUS.PENDING) {
        return [];
      }
      return [
        {
          label: 'Hoàn thành',
          color: colors.success,
          run: () =>
            Alert.alert(
              'Báo hoàn thành',
              `Báo đã hoàn thành "${task.title}"? Chỉ huy sẽ duyệt hoặc từ chối.`,
              [
                { text: 'Huỷ', style: 'cancel' },
                {
                  text: 'Hoàn thành',
                  onPress: run(() => submitTask(profile, task)),
                },
              ],
            ),
        },
        postponeAction(task),
      ];
    }
    const del = {
      label: 'Xoá',
      color: colors.danger,
      run: () =>
        Alert.alert('Xoá nhiệm vụ', `Xoá "${task.title}"?`, [
          { text: 'Huỷ', style: 'cancel' },
          {
            text: 'Xoá',
            style: 'destructive',
            onPress: run(() => deleteTask(task)),
          },
        ]),
    };
    if (task.status === TASK_STATUS.SUBMITTED) {
      return [
        {
          label: 'Duyệt',
          color: colors.success,
          run: () =>
            Alert.alert('Duyệt nhiệm vụ', `Xác nhận "${task.title}" đã đạt?`, [
              { text: 'Huỷ', style: 'cancel' },
              { text: 'Duyệt', onPress: run(() => approveTask(profile, task)) },
            ]),
        },
        {
          label: 'Từ chối',
          color: colors.danger,
          run: () => setDialog({ kind: 'reject', task }),
        },
      ];
    }
    if (task.status === TASK_STATUS.PENDING) {
      return [
        {
          label: 'Sửa',
          color: colors.primary,
          run: () => {
            setEditing(task);
            setFormOpen(true);
          },
        },
        del,
      ];
    }
    return [del];
  };

  const pendingReceived = receivedOthers.filter(
    t => t.status === TASK_STATUS.PENDING,
  ).length;
  // Số trên "Tôi giao": việc chờ tôi duyệt + việc tự giao chưa xong.
  const waitingApproval = given.filter(
    t =>
      t.status === TASK_STATUS.SUBMITTED ||
      (isSelfTask(t) && t.status === TASK_STATUS.PENDING),
  ).length;
  const segments = [
    { id: 'received', label: 'Được giao', n: pendingReceived },
    { id: 'given', label: 'Tôi giao', n: waitingApproval },
  ];

  const dialogTask = dialog?.task;
  const dialogInitialDue = useMemo(() => {
    if (!dialogTask) {
      return defaultDue();
    }
    const base = Math.max(Date.now(), dialogTask.dueAt);
    return new Date(roundUp5(base + HOUR));
  }, [dialogTask]);

  return (
    <View style={styles.screen}>
      {/* Chỉ huy: "Tôi giao" = giao cấp dưới. Cán bộ: "Tôi giao" = tự giao. */}
      <View style={styles.segment}>
        {segments.map(sg => (
          <TouchableOpacity
            key={sg.id}
            style={[styles.segBtn, tab === sg.id && styles.segBtnActive]}
            onPress={() => setTab(sg.id)}
          >
            <Text
              style={[styles.segText, tab === sg.id && styles.segTextActive]}
            >
              {sg.label}
              {sg.n ? ` (${sg.n})` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'given' && (
        <TouchableOpacity
          style={styles.createBtn}
          onPress={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Text style={styles.createText}>
            {commander
              ? '＋ Giao nhiệm vụ mới'
              : '＋ Tự giao nhiệm vụ cho mình'}
          </Text>
        </TouchableOpacity>
      )}

      {!ready ? (
        <ActivityIndicator style={styles.pad} color={colors.primary} />
      ) : error ? (
        <Text style={styles.errorText}>
          Không tải được nhiệm vụ: {error.message}
        </Text>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={t => t.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TaskCard
              task={item}
              mode={tab}
              now={now}
              highlighted={item.id === highlightId}
              actions={actionsFor(item)}
            />
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {tab === 'received'
                ? 'Bạn chưa có nhiệm vụ nào cần làm.'
                : commander
                ? 'Bạn chưa giao nhiệm vụ nào đang mở.'
                : 'Chưa có việc tự giao nào. Tự giao để được nhắc đúng hạn.'}
            </Text>
          }
          ListFooterComponent={
            <Text style={styles.footNote}>
              Nhiệm vụ đã duyệt tra cứu ở tab “Lịch sử” → “Nhiệm vụ”.
            </Text>
          }
        />
      )}

      <TaskFormModal
        visible={formOpen}
        me={profile}
        selfOnly={!commander}
        editing={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
      />

      <ReasonDueModal
        visible={dialog?.kind === 'postpone'}
        title="Hoãn nhiệm vụ"
        subtitle={
          dialogTask
            ? `${dialogTask.title} — hạn hiện tại ${formatDateTimeVi(
                dialogTask.dueAt,
              )}`
            : undefined
        }
        reasonLabel="Lý do hoãn"
        reasonRequired={false}
        confirmLabel="Hoãn"
        confirmColor={colors.warning}
        initialDue={dialogInitialDue}
        onCancel={() => setDialog(null)}
        onConfirm={async (reason, dueAt) => {
          await postponeTask(profile, dialogTask, dueAt, reason);
          setDialog(null);
        }}
      />
      <ReasonDueModal
        visible={dialog?.kind === 'reject'}
        title="Từ chối kết quả"
        subtitle={
          dialogTask
            ? `${dialogTask.title} — ${dialogTask.assigneeName}`
            : undefined
        }
        reasonLabel="Lý do từ chối (người nhận sẽ thấy)"
        reasonRequired
        confirmLabel="Từ chối"
        confirmColor={colors.danger}
        initialDue={dialogInitialDue}
        onCancel={() => setDialog(null)}
        onConfirm={async (reason, dueAt) => {
          await rejectTask(profile, dialogTask, reason, dueAt);
          setDialog(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex1: { flex: 1 },
  pad: { padding: spacing.lg },
  list: { padding: spacing.md, paddingBottom: spacing.xl },
  segment: {
    flexDirection: 'row',
    margin: spacing.md,
    marginBottom: 0,
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  segBtn: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  segBtnActive: { backgroundColor: colors.primary },
  segText: { color: colors.text, fontWeight: '600' },
  segTextActive: { color: '#fff' },
  createBtn: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  createText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  empty: {
    color: colors.textMuted,
    fontStyle: 'italic',
    textAlign: 'center',
    padding: spacing.lg,
  },
  errorText: { color: colors.danger, padding: spacing.md },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnGhost: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnGhostText: { color: colors.text, fontWeight: '600' },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: spacing.md,
    paddingBottom: spacing.xl,
    maxHeight: '85%',
  },
  sheetTall: { maxHeight: '92%' },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  sheetSub: { color: colors.textMuted, marginTop: 2 },
  sheetActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  label: {
    color: colors.textMuted,
    fontWeight: '600',
    fontSize: 13,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
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
  inputText: { color: colors.text, fontSize: 15 },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  footNote: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  fixedAssignee: { color: colors.text, fontSize: 15, paddingVertical: 6 },
  userList: {
    marginTop: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  userRowSelected: { backgroundColor: '#e8f0fe' },
  radio: { fontSize: 18, color: colors.primary, marginRight: spacing.sm },
  userName: { color: colors.text, fontWeight: '600' },
  userSub: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
});
