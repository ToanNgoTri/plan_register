import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  addListeners,
  isAvailable,
  isSupported,
  start,
  stop,
} from '../services/speechService';
import { appendDictation } from '../utils/dictation';
import { colors, spacing } from '../theme';

/**
 * Bao nhiêu mili-giây mới cập nhật chữ đang bay một lần. Bộ nhận dạng bắn kết
 * quả tạm rất dày; đẩy thẳng vào state sẽ làm ô nhập nhiều dòng giật.
 */
const PARTIAL_THROTTLE_MS = 100;

/**
 * Nút đọc chính tả cho một ô nhập chữ.
 *
 * Nút tự quản lý phiên nghe và gọi `onChangeText` với chữ đã ghép sẵn, nên chỗ
 * dùng chỉ cần đặt nút cạnh TextInput và truyền `value`/`onChangeText` giống hệt
 * cái đang truyền cho TextInput.
 *
 * Máy không có module native (bản build cũ) hoặc không có bộ nhận dạng thì nút
 * tự ẩn — màn hình không cần biết.
 */
export default function DictationButton({
  value,
  onChangeText,
  disabled,
  onRecordingChange,
}) {
  const [available, setAvailable] = useState(false);
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [level, setLevel] = useState(0);

  /** Chữ đã chốt trước đoạn đang nói — mốc để ghép kết quả tạm vào. */
  const segmentBase = useRef('');
  /** Giá trị mới nhất của ô, để callback native không bắt được value cũ. */
  const latestValue = useRef(value);
  const partialTimer = useRef(null);
  const pendingPartial = useRef(null);
  /**
   * Callback do màn hình truyền vào thường là arrow tạo mới mỗi lần render. Giữ
   * qua ref để việc đăng ký listener native chỉ chạy đúng một lần.
   */
  const emit = useRef({ onChangeText, onRecordingChange });

  useEffect(() => {
    latestValue.current = value;
    emit.current = { onChangeText, onRecordingChange };
  }, [onChangeText, onRecordingChange, value]);

  useEffect(() => {
    let cancelled = false;
    if (!isSupported()) {
      return undefined;
    }
    isAvailable().then(ok => {
      if (!cancelled) {
        setAvailable(ok);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const clearPartialTimer = useCallback(() => {
    if (partialTimer.current) {
      clearTimeout(partialTimer.current);
      partialTimer.current = null;
    }
    pendingPartial.current = null;
  }, []);

  const finish = useCallback(() => {
    clearPartialTimer();
    setRecording(false);
    setStarting(false);
    setLevel(0);
    emit.current.onRecordingChange?.(false);
  }, [clearPartialTimer]);

  useEffect(() => {
    if (!isSupported()) {
      return undefined;
    }

    const remove = addListeners({
      onStart: () => {
        setStarting(false);
      },
      onPartial: text => {
        // Gom lại: chỉ vẽ tối đa 10 lần/giây, và luôn vẽ bản mới nhất.
        pendingPartial.current = text;
        if (partialTimer.current) {
          return;
        }
        partialTimer.current = setTimeout(() => {
          partialTimer.current = null;
          const latest = pendingPartial.current;
          pendingPartial.current = null;
          if (latest != null) {
            emit.current.onChangeText(
              appendDictation(segmentBase.current, latest),
            );
          }
        }, PARTIAL_THROTTLE_MS);
      },
      onFinal: text => {
        clearPartialTimer();
        segmentBase.current = appendDictation(segmentBase.current, text);
        emit.current.onChangeText(segmentBase.current);
      },
      onVolume: setLevel,
      onEnd: finish,
      onError: message => {
        finish();
        Alert.alert('Không nghe được', message);
      },
    });

    return () => {
      remove();
      clearPartialTimer();
    };
  }, [clearPartialTimer, finish]);

  const toggle = useCallback(async () => {
    if (recording) {
      setRecording(false);
      emit.current.onRecordingChange?.(false);
      await stop();
      return;
    }

    segmentBase.current = latestValue.current || '';
    setStarting(true);
    try {
      const started = await start({ locale: 'vi-VN', punctuate: true });
      if (!started) {
        setStarting(false);
        Alert.alert(
          'Chưa có quyền micro',
          'Hãy bật quyền micro cho ứng dụng trong Cài đặt để đọc trích yếu.',
        );
        return;
      }
      setRecording(true);
      emit.current.onRecordingChange?.(true);
    } catch (e) {
      setStarting(false);
      Alert.alert('Không mở được micro', e?.message || 'Vui lòng thử lại.');
    }
  }, [recording]);

  if (!isSupported() || !available) {
    return null;
  }

  return (
    <View style={styles.row}>
      <Pressable
        onPress={toggle}
        disabled={disabled || starting}
        style={({ pressed }) => [
          styles.button,
          recording && styles.buttonRecording,
          (disabled || starting) && styles.buttonDisabled,
          pressed && styles.buttonPressed,
        ]}>
        {starting ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Text style={[styles.icon, recording && styles.iconRecording]}>
            {recording ? '■' : '🎤'}
          </Text>
        )}
      </Pressable>

      {recording ? (
        <View style={styles.meterWrap}>
          <View style={styles.meterTrack}>
            <View
              style={[
                styles.meterFill,
                { width: `${Math.round(Math.min(1, level) * 100)}%` },
              ]}
            />
          </View>
          <Text style={styles.hint}>
            Đang nghe — đọc "phẩy", "chấm", "xuống dòng" để có dấu câu.
          </Text>
        </View>
      ) : (
        <Text style={styles.hint}>Bấm để đọc trích yếu</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonRecording: {
    backgroundColor: colors.dangerBg,
    borderColor: colors.danger,
  },
  buttonPressed: {
    opacity: 0.6,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  icon: {
    fontSize: 18,
  },
  iconRecording: {
    color: colors.danger,
  },
  meterWrap: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  meterTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  meterFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.danger,
  },
  hint: {
    marginLeft: spacing.sm,
    flex: 1,
    fontSize: 12,
    color: colors.textMuted,
  },
});
