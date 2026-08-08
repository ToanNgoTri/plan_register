import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useAuth } from '../context/AuthContext';
import ForceTabs from '../components/ForceTabs';
import DutyUploadSheet from '../components/DutyUploadSheet';
import {
  deleteDutySchedule,
  openScheduleDocument,
  subscribeDutySchedule,
} from '../services/dutyService';
import { FORCES } from '../config/constants';
import { formatDateTimeVi } from '../utils/date';
import { formatBytes } from '../utils/file';
import { colors, spacing } from '../theme';

/**
 * Lịch trực: mỗi lực lượng (CA / ANCS) có đúng MỘT bản hiện hành, là ảnh chụp
 * hoặc tệp Word do cán bộ đăng lên. Đăng bản mới sẽ thay thế bản cũ.
 *
 * Ai cũng đăng được, nên bản lịch luôn hiển thị tên người đăng và thời điểm
 * đăng; chỉ người đã đăng (hoặc Trưởng CA) mới xoá được.
 */
export default function DutyScheduleScreen() {
  const { profile, isBoss, isDev } = useAuth();
  const [forceId, setForceId] = useState(FORCES[0].id);
  const [schedule, setSchedule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  // Chỉ dùng khi listener đứt (mất mạng / hết phiên) để nối lại.
  const [retry, setRetry] = useState(0);

  const force = FORCES.find(f => f.id === forceId) ?? FORCES[0];

  useEffect(() => {
    setLoading(true);
    setFailed(false);
    setSchedule(null);
    const unsub = subscribeDutySchedule(
      forceId,
      next => {
        setSchedule(next);
        setLoading(false);
      },
      () => {
        setFailed(true);
        setLoading(false);
      },
    );
    return unsub;
  }, [forceId, retry]);

  const reconnect = useCallback(() => setRetry(n => n + 1), []);

  const canDelete =
    !!schedule && (isBoss || isDev || schedule.uploadedBy === profile?.uid);

  const confirmDelete = () =>
    Alert.alert(
      'Xoá lịch trực',
      `Xoá lịch trực ${force.title}? Thao tác này không khôi phục được.`,
      [
        { text: 'Huỷ', style: 'cancel' },
        {
          text: 'Xoá',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteDutySchedule(forceId);
            } catch (e) {
              Alert.alert('Lỗi', e?.message ?? 'Không xoá được lịch trực.');
            }
          },
        },
      ],
    );

  const openInBrowser = async () => {
    try {
      await Linking.openURL(schedule.fileUrl);
    } catch {
      Alert.alert('Lỗi', 'Không mở được tệp trên thiết bị này.');
    }
  };

  /**
   * Mở tệp Word bằng trình xem của hệ điều hành. Nếu máy không có ứng dụng nào
   * đọc được .docx (chỉ gặp trên Android), đề nghị mở bằng trình duyệt.
   */
  const openDocument = async () => {
    try {
      setOpening(true);
      await openScheduleDocument(schedule);
    } catch {
      Alert.alert(
        'Không mở được tệp',
        'Máy chưa có ứng dụng đọc tệp Word. Mở bằng trình duyệt thay thế?',
        [
          { text: 'Huỷ', style: 'cancel' },
          { text: 'Mở trình duyệt', onPress: openInBrowser },
        ],
      );
    } finally {
      setOpening(false);
    }
  };

  return (
    <>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={reconnect} />
        }
      >
        <ForceTabs value={forceId} onChange={setForceId} />

        {loading && !schedule ? (
          <ActivityIndicator style={styles.spinner} />
        ) : failed ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Không tải được lịch trực</Text>
            <Text style={styles.emptyText}>
              Kiểm tra kết nối mạng rồi kéo xuống để thử lại.
            </Text>
          </View>
        ) : !schedule ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🗂️</Text>
            <Text style={styles.emptyTitle}>
              Chưa có lịch trực {force.title}
            </Text>
            <Text style={styles.emptyText}>
              Đăng ảnh chụp hoặc tệp Word để cả đơn vị cùng xem.
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
            {/* Chỉ hiện thời điểm đăng, không hiện tên người đăng. Tên vẫn
                được ghi vào `uploadedByName`/`uploadedBy` trong Firestore để
                tra lại được, và quyền xoá vẫn dựa trên `uploadedBy`. */}
            <Text style={styles.metaTime}>
              Cập nhật {formatDateTimeVi(schedule.uploadedAt)}
            </Text>
            {schedule.note ? (
              <Text style={styles.note}>{schedule.note}</Text>
            ) : null}

            {schedule.fileType === 'image' ? (
              <ScheduleImage
                url={schedule.fileUrl}
                onPress={() => setViewerOpen(true)}
              />
            ) : (
              <View style={styles.doc}>
                <Text style={styles.docEmoji}>📄</Text>
                <Text style={styles.docName} numberOfLines={2}>
                  {schedule.fileName}
                </Text>
                {formatBytes(schedule.size) ? (
                  <Text style={styles.docMeta}>
                    {formatBytes(schedule.size)}
                  </Text>
                ) : null}
                <TouchableOpacity
                  style={styles.docBtn}
                  activeOpacity={0.85}
                  onPress={openDocument}
                  disabled={opening}
                >
                  {opening ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.docBtnText}>Xem lịch trực</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        <TouchableOpacity
          style={styles.btn}
          activeOpacity={0.85}
          onPress={() => setSheetOpen(true)}
        >
          <Text style={styles.btnText}>
            {schedule ? 'Cập nhật lịch trực' : 'Đăng lịch trực'}
          </Text>
        </TouchableOpacity>

        {canDelete ? (
          <TouchableOpacity
            style={[styles.btn, styles.btnOutline]}
            activeOpacity={0.85}
            onPress={confirmDelete}
          >
            <Text style={[styles.btnText, styles.btnOutlineText]}>
              Xoá lịch trực
            </Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>

      <DutyUploadSheet
        visible={sheetOpen}
        force={forceId}
        forceTitle={force.title}
        existing={schedule}
        onClose={() => setSheetOpen(false)}
      />

      {schedule?.fileType === 'image' ? (
        <ImageViewer
          visible={viewerOpen}
          url={schedule.fileUrl}
          onClose={() => setViewerOpen(false)}
          onOpenExternally={openInBrowser}
        />
      ) : null}
    </>
  );
}

/**
 * Ảnh lịch trực vừa khung, cao đúng theo tỉ lệ thật của ảnh (lấy bằng
 * Image.getSize) để bảng lịch không bị méo hay cắt mất dòng.
 */
function ScheduleImage({ url, onPress }) {
  const [ratio, setRatio] = useState(null);
  useEffect(() => {
    let alive = true;
    setRatio(null);
    Image.getSize(
      url,
      (w, h) => {
        if (alive && h > 0) {
          setRatio(w / h);
        }
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [url]);
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress}>
      <Image
        source={{ uri: url }}
        style={[styles.image, { aspectRatio: ratio ?? 0.75 }]}
        resizeMode="contain"
      />
      <Text style={styles.tapHint}>Chạm vào ảnh để xem lớn</Text>
    </TouchableOpacity>
  );
}

/** Escape để nhét an toàn vào thuộc tính HTML (URL tải về có & và =). */
function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

/**
 * Xem ảnh toàn màn hình, chụm hai ngón để phóng to.
 *
 * Dùng WebView chứ không phải <Image> trong <ScrollView>: các thuộc tính
 * maximumZoomScale/minimumZoomScale của ScrollView CHỈ chạy trên iOS, nên
 * Android hoàn toàn không phóng to được. WebView thì cả hai nền tảng đều có
 * sẵn thao tác chụm và chạm đôi, và hành xử giống hệt nhau.
 */
function ImageViewer({ visible, url, onClose, onOpenExternally }) {
  const html = `<!doctype html><html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=6">
<style>
  html,body{margin:0;height:100%;background:#000}
  img{width:100%;height:100%;object-fit:contain;display:block}
</style></head>
<body><img src="${escapeAttr(url)}"></body></html>`;
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.viewer}>
        <WebView
          source={{ html }}
          style={styles.viewerWeb}
          originWhitelist={['*']}
          // Android: chụm-để-phóng-to bật sẵn, nhưng ẩn cặp nút +/- cũ kỹ.
          setBuiltInZoomControls
          setDisplayZoomControls={false}
          // Chỉ hiển thị ảnh tĩnh, không cần chạy script.
          javaScriptEnabled={false}
          scrollEnabled
        />
        <View style={styles.viewerBar}>
          <TouchableOpacity
            style={styles.viewerBtn}
            activeOpacity={0.8}
            onPress={onOpenExternally}
          >
            <Text style={styles.viewerBtnText}>Mở ảnh gốc</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.viewerBtn}
            activeOpacity={0.8}
            onPress={onClose}
          >
            <Text style={styles.viewerBtnText}>Đóng</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
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
    gap: spacing.md,
  },
  spinner: {
    marginTop: spacing.xl,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  emptyEmoji: {
    fontSize: 40,
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  metaTime: {
    fontSize: 12,
    color: colors.textMuted,
  },
  note: {
    marginTop: spacing.xs,
    fontSize: 14,
    color: colors.text,
  },
  image: {
    width: '100%',
    marginTop: spacing.md,
    borderRadius: 8,
    backgroundColor: colors.bg,
  },
  tapHint: {
    marginTop: spacing.xs,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
  },
  doc: {
    marginTop: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderRadius: 10,
    padding: spacing.md,
  },
  docEmoji: {
    fontSize: 36,
  },
  docName: {
    marginTop: spacing.xs,
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  docMeta: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  docBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
  },
  docBtnText: {
    color: '#fff',
    fontWeight: '700',
  },
  btn: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  btnOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.danger,
  },
  btnOutlineText: {
    color: colors.danger,
  },
  viewer: {
    flex: 1,
    backgroundColor: '#000',
  },
  viewerWeb: {
    flex: 1,
    backgroundColor: '#000',
  },
  viewerBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  viewerBtn: {
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fff',
  },
  viewerBtnText: {
    color: '#fff',
    fontWeight: '700',
  },
});
