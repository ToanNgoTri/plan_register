import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import {
  pickScheduleDocx,
  pickScheduleImage,
  uploadDutySchedule,
} from '../services/dutyService';
import { formatBytes } from '../utils/file';
import { colors, spacing } from '../theme';

/**
 * Bảng đăng lịch trực: chọn ảnh hoặc tệp Word, thêm ghi chú, rồi đăng.
 *
 * Bản đăng lên THAY THẾ bản hiện hành của lực lượng đó, nên khi đã có lịch cũ
 * thì hiện cảnh báo rõ ràng trước khi người dùng bấm đăng.
 */
export default function DutyUploadSheet({
  visible,
  force,
  forceTitle,
  existing,
  onClose,
}) {
  const { profile } = useAuth();
  const [file, setFile] = useState(null);
  const [note, setNote] = useState('');
  const [uploading, setUploading] = useState(false);

  // Mỗi lần mở lại là một lượt đăng mới → xoá lựa chọn của lượt trước.
  useEffect(() => {
    if (visible) {
      setFile(null);
      setNote('');
    }
  }, [visible]);

  const choose = async picker => {
    try {
      const picked = await picker();
      if (picked) {
        setFile(picked);
      }
    } catch (e) {
      Alert.alert('Lỗi', e?.message ?? 'Không chọn được tệp.');
    }
  };

  const submit = async () => {
    if (!file) {
      Alert.alert('Chưa chọn tệp', 'Vui lòng chọn ảnh hoặc tệp Word.');
      return;
    }
    try {
      setUploading(true);
      // Không cần báo cho màn hình cha: nó đang nghe snapshot của
      // duty_schedules/{force} nên bản mới tự hiện ra.
      await uploadDutySchedule({ force, user: profile, file, note });
      onClose();
    } catch (e) {
      Alert.alert('Lỗi', e?.message ?? 'Không đăng được lịch trực.');
    } finally {
      setUploading(false);
    }
  };

  const close = () => {
    if (!uploading) {
      onClose();
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={close}
    >
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>Đăng lịch trực {forceTitle}</Text>

            {existing ? (
              <View style={styles.warn}>
                <Text style={styles.warnText}>
                  Lịch trực {forceTitle} hiện tại sẽ bị thay thế và không khôi
                  phục được.
                </Text>
              </View>
            ) : null}

            <Text style={styles.label}>Chọn nguồn</Text>
            <View style={styles.sourceRow}>
              <TouchableOpacity
                style={[
                  styles.sourceBtn,
                  file?.kind === 'image' && styles.sourceBtnActive,
                ]}
                activeOpacity={0.85}
                onPress={() => choose(pickScheduleImage)}
                disabled={uploading}
              >
                <Text style={styles.sourceEmoji}>🖼️</Text>
                <Text style={styles.sourceText}>Ảnh</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.sourceBtn,
                  file?.kind === 'docx' && styles.sourceBtnActive,
                ]}
                activeOpacity={0.85}
                onPress={() => choose(pickScheduleDocx)}
                disabled={uploading}
              >
                <Text style={styles.sourceEmoji}>📄</Text>
                <Text style={styles.sourceText}>Tệp Word</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.hint}>
              Tệp nhận từ Zalo: lưu về máy trước, rồi chọn ở đây.
            </Text>

            {file ? (
              <View style={styles.picked}>
                <Text style={styles.pickedName} numberOfLines={2}>
                  {file.name}
                </Text>
                {formatBytes(file.size) ? (
                  <Text style={styles.pickedMeta}>
                    {formatBytes(file.size)}
                  </Text>
                ) : null}
              </View>
            ) : null}

            <Text style={[styles.label, styles.labelSpaced]}>
              Ghi chú (không bắt buộc)
            </Text>
            <TextInput
              style={styles.input}
              value={note}
              onChangeText={setNote}
              placeholder="VD: Lịch trực tháng 8/2026"
              placeholderTextColor={colors.textMuted}
              multiline
              editable={!uploading}
            />

            <TouchableOpacity
              style={[styles.btn, !file && styles.btnDisabled]}
              activeOpacity={0.85}
              onPress={submit}
              disabled={uploading || !file}
            >
              {uploading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>
                  {existing ? 'Thay thế lịch trực' : 'Đăng lịch trực'}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelBtn}
              activeOpacity={0.7}
              onPress={close}
              disabled={uploading}
            >
              <Text style={styles.cancelText}>Huỷ</Text>
            </TouchableOpacity>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '85%',
    backgroundColor: colors.bg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: spacing.lg,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.md,
  },
  warn: {
    backgroundColor: colors.warningBg,
    borderRadius: 10,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  warnText: {
    color: colors.warning,
    fontSize: 13,
    fontWeight: '600',
  },
  label: {
    color: colors.text,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  labelSpaced: {
    marginTop: spacing.md,
  },
  sourceRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sourceBtn: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  sourceBtnActive: {
    borderColor: colors.primary,
    backgroundColor: '#eef4ff',
  },
  sourceEmoji: {
    fontSize: 24,
  },
  sourceText: {
    marginTop: spacing.xs,
    fontWeight: '600',
    color: colors.text,
  },
  hint: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: colors.textMuted,
  },
  picked: {
    marginTop: spacing.sm,
    backgroundColor: colors.successBg,
    borderRadius: 10,
    padding: spacing.sm,
  },
  pickedName: {
    color: colors.success,
    fontWeight: '700',
    fontSize: 14,
  },
  pickedMeta: {
    color: colors.success,
    fontSize: 12,
    marginTop: 2,
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  btn: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  cancelBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  cancelText: {
    color: colors.textMuted,
    fontWeight: '600',
    fontSize: 15,
  },
});
