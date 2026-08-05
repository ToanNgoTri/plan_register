import React, { useEffect, useState } from 'react';
import {
  AppState,
  Linking,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  checkForUpdate,
  compareVersions,
  getCurrentAppVersion,
  resolveUpdateUrl,
  subscribeToVersionConfig,
} from '../services/versionService';
import { colors, spacing } from '../theme';

/**
 * Mandatory-update gate (modeled on lawMachine, but forced). Blocks the whole
 * app with a non-dismissable modal when EITHER:
 *   - the installed version is below `config/app.minVersion` in Firestore
 *     (server-controlled; works for internally-distributed builds), OR
 *   - the store reports a newer version (react-native-version-check).
 *
 * The Firestore config is live, so bumping `minVersion` blocks old clients on
 * their next launch / foreground without republishing anything.
 */
export default function ForceUpdateGate() {
  const current = getCurrentAppVersion();
  const [config, setConfig] = useState(null);
  const [store, setStore] = useState(null);

  // Live server config (minVersion / updateUrl).
  useEffect(() => {
    const unsub = subscribeToVersionConfig(setConfig, () => {});
    return unsub;
  }, []);

  // Store check on mount + whenever the app returns to the foreground.
  useEffect(() => {
    const run = () => {
      checkForUpdate()
        .then(setStore)
        .catch(() => {});
    };
    run();
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') {
        run();
      }
    });
    return () => sub.remove();
  }, []);
  const minBlocked =
    !!config?.minVersion && compareVersions(current, config.minVersion) < 0;
  const storeBlocked = store?.isNeeded === true;
  const needed = minBlocked || storeBlocked;
  const latestVersion = config?.latestVersion ?? store?.latestVersion;
  // Link store theo đúng nền tảng đang chạy (iOS → App Store, Android → Play).
  const updateUrl = resolveUpdateUrl(config, store);
  const openStore = () => {
    if (updateUrl) {
      Linking.openURL(updateUrl).catch(() => {});
    }
  };
  return (
    <Modal
      visible={needed}
      transparent
      animationType="fade"
      onRequestClose={() => {}}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.emoji}>🚀</Text>
          <Text style={styles.title}>Bắt buộc cập nhật</Text>
          <Text style={styles.msg}>
            {config?.message ??
              `Đã có phiên bản mới${
                latestVersion ? ` (${latestVersion})` : ''
              }. Vui lòng cập nhật để tiếp tục sử dụng ứng dụng.`}
          </Text>
          <Text style={styles.ver}>Phiên bản hiện tại: {current}</Text>
          <TouchableOpacity
            style={[styles.btn, !updateUrl && styles.btnDisabled]}
            onPress={openStore}
            disabled={!updateUrl}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>Cập nhật ngay</Text>
          </TouchableOpacity>
          {!updateUrl && (
            <Text style={styles.note}>
              (Chưa cấu hình đường dẫn tải bản mới)
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: spacing.xl,
    alignItems: 'center',
  },
  emoji: {
    fontSize: 48,
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  msg: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: spacing.sm,
  },
  ver: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  btn: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  note: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
});
