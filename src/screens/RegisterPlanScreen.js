import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import {
  registerPlan,
  subscribeDailyEntries,
  subscribeMyEntry,
} from '../services/planService';
import { scheduleWeekdayReminders } from '../services/notificationService';
import { useToday } from '../hooks/useToday';
import { formatDateVi, isWeekend, toDateKey } from '../utils/date';
import { colors, spacing } from '../theme';
export default function RegisterPlanScreen() {
  const { profile } = useAuth();
  const [content, setContent] = useState('');
  const [existing, setExisting] = useState(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [todayEntries, setTodayEntries] = useState([]);
  // Tự đổi khi sang ngày mới, kể cả khi app mở/nằm background suốt qua nửa đêm.
  const today = useToday();
  const weekend = isWeekend(today);

  // Live list of EVERYONE's plans for today (staff coordination view). Allowed
  // by Firestore rule B (current day only). Own entry is included too.
  // Sang ngày mới → huỷ listener cũ và lắng nghe collection của ngày mới.
  useEffect(() => {
    setTodayEntries([]);
    const unsub = subscribeDailyEntries(
      today,
      entries =>
        setTodayEntries(
          [...entries].sort((a, b) =>
            a.displayName.localeCompare(b.displayName, 'vi'),
          ),
        ),
      () => {},
    );
    return unsub;
  }, [today]);
  // Kế hoạch của chính mình hôm nay, cập nhật theo thời gian thực (không cần
  // rời màn hình rồi quay lại). Trong lúc đang gõ thì KHÔNG ghi đè ô nhập.
  const editingRef = useRef(editing);
  editingRef.current = editing;
  useEffect(() => {
    if (!profile) {
      return;
    }
    setLoading(true);
    let first = true;
    const unsub = subscribeMyEntry(
      profile.uid,
      today,
      entry => {
        setExisting(entry);
        const isFirst = first;
        if (isFirst) {
          first = false;
          setLoading(false);
        }
        // Ảnh chụp đầu tiên (mở màn hình / sang ngày mới) luôn đồng bộ; các lần
        // sau chỉ đồng bộ khi người dùng không đang soạn dở.
        if (isFirst || !editingRef.current) {
          setContent(entry?.content ?? '');
          // Registered → show read-only view; not yet → open the input.
          setEditing(!entry);
        }
      },
      () => setLoading(false),
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.uid, today]);
  const submit = async () => {
    if (!profile) {
      return;
    }
    if (!content.trim()) {
      Alert.alert('Thiếu nội dung', 'Vui lòng nhập nội dung kế hoạch.');
      return;
    }
    try {
      setSaving(true);
      await registerPlan(profile, content, today);
      // Registered today → drop today's reminder from the schedule.
      await scheduleWeekdayReminders([toDateKey(today)]).catch(() => {});
      // Không cần nạp lại: listener sẽ đẩy về bản ghi vừa lưu.
      setEditing(false);
      Alert.alert(
        'Thành công',
        existing
          ? 'Đã cập nhật kế hoạch hôm nay.'
          : 'Đã đăng ký kế hoạch hôm nay. Quản lý sẽ nhận được thông báo.',
      );
    } catch (e) {
      Alert.alert('Lỗi', e?.message ?? 'Không đăng ký được.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.date}>{formatDateVi(today)}</Text>

        {weekend && (
          <View style={[styles.banner, styles.bannerInfo]}>
            <Text style={styles.bannerText}>
              Hôm nay là cuối tuần — không bắt buộc đăng ký.
            </Text>
          </View>
        )}

        {loading ? (
          <ActivityIndicator
            style={{
              marginTop: spacing.xl,
            }}
          />
        ) : (
          <>
            <View
              style={[
                styles.statusBox,
                existing ? styles.statusOk : styles.statusPending,
              ]}
            >
              <Text
                style={[
                  styles.statusText,
                  {
                    color: existing ? colors.success : colors.warning,
                  },
                ]}
              >
                {existing
                  ? '✓ Bạn đã đăng ký kế hoạch hôm nay'
                  : '● Bạn chưa đăng ký kế hoạch hôm nay'}
              </Text>
            </View>

            <Text style={styles.label}>Nội dung kế hoạch công tác</Text>

            {existing && !editing ? (
              // Registered → read-only highlighted text + button to edit.
              <>
                <View style={styles.readonlyBox}>
                  <Text style={styles.readonlyText}>{existing.content}</Text>
                </View>
                <TouchableOpacity
                  style={styles.button}
                  onPress={() => setEditing(true)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.buttonText}>Cập nhật kế hoạch</Text>
                </TouchableOpacity>
              </>
            ) : (
              // Not registered yet, or editing an existing plan → input.
              <>
                <TextInput
                  style={styles.input}
                  value={content}
                  onChangeText={setContent}
                  placeholder="Nhập nội dung công việc dự kiến trong ngày…"
                  placeholderTextColor={colors.textMuted}
                  multiline
                  textAlignVertical="top"
                />
                <TouchableOpacity
                  style={styles.button}
                  onPress={submit}
                  disabled={saving}
                  activeOpacity={0.85}
                >
                  {saving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>
                      {existing ? 'Lưu thay đổi' : 'Đăng ký kế hoạch'}
                    </Text>
                  )}
                </TouchableOpacity>
                {existing && (
                  <TouchableOpacity
                    style={styles.cancelBtn}
                    onPress={() => {
                      setContent(existing.content);
                      setEditing(false);
                    }}
                    disabled={saving}
                  >
                    <Text style={styles.cancelText}>Huỷ</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </>
        )}

        <View style={styles.othersHeaderRow}>
          <Text style={styles.othersHeader}>
            Kế hoạch hôm nay của mọi người
          </Text>
          <Text style={styles.othersCount}>{todayEntries.length}</Text>
        </View>
        {todayEntries.length === 0 ? (
          <Text style={styles.othersEmpty}>Chưa có ai đăng ký hôm nay.</Text>
        ) : (
          todayEntries.map(item => {
            const mine = item.uid === profile?.uid;
            return (
              <View
                key={item.uid}
                style={[styles.otherCard, mine && styles.otherCardMine]}
              >
                <Text style={styles.otherName}>
                  {item.displayName}
                  {mine ? ' (bạn)' : ''}
                  {item.unit ? ` · ${item.unit}` : ''}
                </Text>
                <Text style={styles.otherContent}>{item.content}</Text>
              </View>
            );
          })
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    padding: spacing.md,
  },
  date: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.md,
  },
  banner: {
    borderRadius: 10,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  bannerInfo: {
    backgroundColor: colors.warningBg,
  },
  bannerText: {
    color: colors.warning,
    fontWeight: '500',
  },
  statusBox: {
    borderRadius: 10,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  statusOk: {
    backgroundColor: colors.successBg,
  },
  statusPending: {
    backgroundColor: colors.warningBg,
  },
  statusText: {
    fontWeight: '600',
    fontSize: 15,
  },
  label: {
    color: colors.text,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.md,
    minHeight: 140,
    color: colors.text,
    fontSize: 15,
  },
  readonlyBox: {
    backgroundColor: colors.successBg,
    borderWidth: 1,
    borderLeftWidth: 4,
    borderColor: colors.success,
    borderRadius: 10,
    padding: spacing.md,
    minHeight: 80,
  },
  readonlyText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
  button: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelBtn: {
    marginTop: spacing.sm,
    paddingVertical: 10,
    alignItems: 'center',
  },
  cancelText: {
    color: colors.textMuted,
    fontWeight: '600',
    fontSize: 14,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  othersHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  othersHeader: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  othersCount: {
    color: '#fff',
    backgroundColor: colors.primary,
    fontWeight: '700',
    fontSize: 13,
    minWidth: 24,
    textAlign: 'center',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  othersEmpty: {
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  otherCard: {
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  otherCardMine: {
    borderColor: colors.primary,
    backgroundColor: '#eef4ff',
  },
  otherName: {
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  otherContent: {
    color: colors.text,
    lineHeight: 20,
  },
});
