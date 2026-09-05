import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import PositionSelect from '../components/PositionSelect';
import {
  DOC_HISTORY_LIMIT,
  acquireDocNumberLock,
  fetchBaseNumbers,
  formatDocNumber,
  isLockActive,
  issueDocNumber,
  peekNextDocNumber,
  peekNextSuffix,
  releaseDocNumberLock,
  renewDocNumberLock,
  saveDocNumberOptions,
  subscribeDocNumberLock,
  subscribeDocNumberOptions,
  subscribeDocNumbers,
} from '../services/docNumberService';
import {
  DEFAULT_ISSUING_UNITS,
  DEFAULT_SIGNERS,
  DOC_LOCK_HEARTBEAT_MS,
  DOC_TYPES,
} from '../config/constants';
import { formatDateTimeVi } from '../utils/date';
import { colors, spacing } from '../theme';

/** Loại văn bản dưới dạng lựa chọn cho PositionSelect. */
const TYPE_OPTIONS = DOC_TYPES.map(t => ({
  value: t.id,
  label: t.abbr ? `${t.label} (${t.abbr})` : t.label,
}));

/** Năm được xem lịch sử: năm nay và 4 năm trước. */
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => {
  const y = new Date().getFullYear() - i;
  return { value: y, label: `Năm ${y}` };
});

/**
 * Sổ số văn bản: lấy số cho văn bản đi và tra lại các số đã cấp.
 *
 * Mỗi lần chỉ MỘT người được mở ô nhập — người khác thấy tên người đang nhập
 * và nút bị khoá. Khoá tự hết hạn nếu app người giữ tắt giữa chừng, nên màn
 * hình phải tự tính lại theo đồng hồ (`now`) chứ không chờ Firestore đẩy về:
 * hết hạn là một mốc thời gian, không phải một lần ghi document.
 */
export default function DocNumberScreen() {
  const { profile, isBoss, isDev } = useAuth();
  const [lock, setLock] = useState(null);
  const [options, setOptions] = useState({
    signers: DEFAULT_SIGNERS,
    units: DEFAULT_ISSUING_UNITS,
    fromDefaults: true,
  });
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [year, setYear] = useState(new Date().getFullYear());
  const [filterType, setFilterType] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [acquiring, setAcquiring] = useState(false);
  // Chỉ dùng khi listener đứt (mất mạng / hết phiên) để nối lại.
  const [retry, setRetry] = useState(0);

  const uid = profile?.uid;

  // Ai đang giữ quyền nhập, theo thời gian thực.
  useEffect(() => subscribeDocNumberLock(setLock, () => {}), []);

  // Danh mục người ký / đơn vị ban hành, cũng theo thời gian thực: quản lý sửa
  // danh mục thì máy đang mở form thấy ngay, không phải khởi động lại app.
  useEffect(() => subscribeDocNumberOptions(setOptions, () => {}), []);

  // Khoá hết hạn theo đồng hồ chứ không theo snapshot, nên phải tự nhịp lại.
  // Chỉ chạy khi thực sự có khoá — không ai giữ thì không cần đếm giờ.
  useEffect(() => {
    if (!lock) {
      return;
    }
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lock]);

  const active = isLockActive(lock, now);
  const heldByMe = active && lock.uid === uid;
  const heldByOther = active && lock.uid !== uid;

  // Giữ khoá sống trong lúc form còn mở (người dùng có thể gõ trích yếu lâu
  // hơn thời gian sống của khoá).
  useEffect(() => {
    if (!formOpen || !uid) {
      return;
    }
    const id = setInterval(() => {
      renewDocNumberLock(uid).catch(() => {});
    }, DOC_LOCK_HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [formOpen, uid]);

  // Khoá bị người khác lấy mất (khoá của mình đã hết hạn trước đó) → đóng form
  // và nói rõ lý do, thay vì để người dùng gõ xong mới báo lỗi lúc lưu.
  useEffect(() => {
    if (formOpen && lock && lock.uid !== uid) {
      setFormOpen(false);
      Alert.alert(
        'Mất quyền nhập',
        `${lock.name} đã lấy quyền nhập số văn bản.`,
      );
    }
  }, [formOpen, lock, uid]);

  // Rời màn hình (chuyển tab / thoát) trong lúc form mở → nhả khoá ngay, đừng
  // bắt cả đơn vị chờ hết hạn.
  const formOpenRef = useRef(false);
  formOpenRef.current = formOpen;
  useFocusEffect(
    useCallback(
      () => () => {
        if (formOpenRef.current && uid) {
          setFormOpen(false);
          releaseDocNumberLock(uid).catch(() => {});
        }
      },
      [uid],
    ),
  );

  // Lịch sử số đã cấp của năm đang xem (lọc theo loại nếu có).
  useEffect(() => {
    setLoading(true);
    setFailed(false);
    setItems([]);
    const unsub = subscribeDocNumbers(
      {
        year,
        typeId: filterType,
      },
      list => {
        setItems(list);
        setLoading(false);
      },
      () => {
        setFailed(true);
        setLoading(false);
      },
    );
    return unsub;
  }, [year, filterType, retry]);

  const openForm = async () => {
    if (!profile) {
      return;
    }
    try {
      setAcquiring(true);
      await acquireDocNumberLock(profile);
      setFormOpen(true);
    } catch (e) {
      Alert.alert(
        e?.code === 'doc-number/locked' ? 'Đang có người nhập' : 'Lỗi',
        e?.message ?? 'Không lấy được quyền nhập.',
      );
    } finally {
      setAcquiring(false);
    }
  };

  /**
   * Đóng form. `lockReleased` = true khi khoá đã được nhả ngay trong
   * transaction cấp số — khỏi tốn thêm một transaction nữa chỉ để nhả.
   */
  const closeForm = (lockReleased = false) => {
    setFormOpen(false);
    if (!lockReleased && uid) {
      releaseDocNumberLock(uid).catch(() => {});
    }
  };

  const header = (
    <View style={styles.headerBlock}>
      {heldByOther ? (
        <View style={styles.lockBanner}>
          <Text style={styles.lockTitle}>🔒 Đang có người lấy số văn bản</Text>
          <Text style={styles.lockName}>
            {lock.name}
            {lock.unit ? ` · ${lock.unit}` : ''}
          </Text>
          <Text style={styles.lockMeta}>
            Bắt đầu lúc {formatDateTimeVi(lock.acquiredAt)} · tự mở sau{' '}
            {Math.max(0, Math.ceil((lock.expiresAt - now) / 1000))} giây nếu
            không thao tác
          </Text>
        </View>
      ) : (
        <View style={styles.freeBanner}>
          <Text style={styles.freeText}>
            ● Sổ số văn bản đang trống, bạn có thể lấy số.
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.btn, (heldByOther || acquiring) && styles.btnDisabled]}
        activeOpacity={0.85}
        onPress={openForm}
        disabled={heldByOther || acquiring}
      >
        {acquiring ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnText}>
            {heldByOther
              ? `Đang khoá — ${lock.name} nhập`
              : heldByMe
              ? 'Tiếp tục lấy số văn bản'
              : 'Lấy số văn bản'}
          </Text>
        )}
      </TouchableOpacity>

      {isBoss || isDev ? (
        <TouchableOpacity
          style={styles.linkBtn}
          activeOpacity={0.7}
          onPress={() => setOptionsOpen(true)}
        >
          <Text style={styles.linkBtnText}>
            ⚙️ Sửa danh mục người ký / đơn vị ban hành
          </Text>
        </TouchableOpacity>
      ) : null}

      <Text style={styles.sectionTitle}>Lịch sử lấy số</Text>
      <View style={styles.filterRow}>
        <View style={styles.filterCell}>
          <PositionSelect
            value={year}
            onChange={setYear}
            options={YEAR_OPTIONS}
            title="Chọn năm"
            placeholder="Chọn năm"
          />
        </View>
        <View style={styles.filterCell}>
          <PositionSelect
            value={filterType}
            onChange={setFilterType}
            options={[
              {
                value: '',
                label: 'Tất cả loại',
              },
              ...TYPE_OPTIONS,
            ]}
            title="Lọc theo loại văn bản"
            placeholder="Tất cả loại"
          />
        </View>
      </View>
    </View>
  );
  return (
    <>
      <FlatList
        style={styles.flex}
        contentContainerStyle={styles.container}
        data={items}
        keyExtractor={item => item.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <DocNumberRow item={item} mine={item.createdBy === uid} />
        )}
        ListEmptyComponent={
          // Đang tải thì RefreshControl đã quay rồi, đừng quay thêm cái nữa.
          loading ? null : failed ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Không tải được lịch sử</Text>
              <Text style={styles.emptyText}>
                Kiểm tra kết nối mạng rồi kéo xuống để thử lại.
              </Text>
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>🗒️</Text>
              <Text style={styles.emptyTitle}>Chưa có văn bản nào</Text>
              <Text style={styles.emptyText}>
                Các số đã cấp trong năm {year} sẽ hiện ở đây.
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          // Chạm trần thì phải nói ra, kèm cách xem tiếp — im lặng cắt bớt sẽ
          // bị hiểu là mất văn bản.
          items.length >= DOC_HISTORY_LIMIT ? (
            <Text style={styles.capNote}>
              Chỉ hiển thị {DOC_HISTORY_LIMIT} văn bản gần nhất của năm {year}.
              Lọc theo loại văn bản để xem đầy đủ.
            </Text>
          ) : null
        }
        refreshing={loading}
        onRefresh={() => setRetry(n => n + 1)}
      />

      <IssueSheet
        visible={formOpen}
        profile={profile}
        year={year}
        options={options}
        onClose={closeForm}
      />

      <OptionsSheet
        visible={optionsOpen}
        profile={profile}
        options={options}
        onClose={() => setOptionsOpen(false)}
      />
    </>
  );
}

/** Một dòng lịch sử: số văn bản + trích yếu + người ký + đơn vị lập. */
function DocNumberRow({ item, mine }) {
  return (
    <View style={[styles.row, mine && styles.rowMine]}>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{item.number}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowType}>{item.typeLabel}</Text>
        <Text style={styles.rowSummary}>{item.summary}</Text>
        <Text style={styles.rowMeta}>
          Người ký: <Text style={styles.rowMetaValue}>{item.signer}</Text>
        </Text>
        <Text style={styles.rowMeta}>
          Đơn vị ban hành:{' '}
          <Text style={styles.rowMetaValue}>{item.unit}</Text>
        </Text>
        <Text style={styles.rowFoot}>
          {item.createdByName} lấy số lúc {formatDateTimeVi(item.createdAt)}
        </Text>
      </View>
    </View>
  );
}

/**
 * Ô nhập một văn bản mới. Chỉ mở được sau khi đã giành xong khoá, nên ở đây
 * không kiểm tra khoá nữa — transaction cấp số mới là chỗ kiểm tra thật.
 */
function IssueSheet({ visible, profile, year, options, onClose }) {
  const [typeId, setTypeId] = useState('');
  // 'new' = số tiếp theo của sổ; 'suffix' = thêm chữ cái vào một số đã cấp.
  const [mode, setMode] = useState('new');
  const [baseSeq, setBaseSeq] = useState(null);
  const [bases, setBases] = useState([]);
  const [basesLoading, setBasesLoading] = useState(false);
  const [summary, setSummary] = useState('');
  const [signer, setSigner] = useState('');
  const [unit, setUnit] = useState('');
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const type = DOC_TYPES.find(t => t.id === typeId) ?? null;

  // Mỗi lần mở là một văn bản mới. Người ký và đơn vị KHÔNG đặt sẵn: chúng là
  // lựa chọn có chủ đích của văn thư, đặt sẵn một giá trị dễ khiến người dùng
  // bấm lưu mà không để ý.
  useEffect(() => {
    if (visible) {
      setTypeId('');
      setMode('new');
      setBaseSeq(null);
      setBases([]);
      setSummary('');
      setSigner('');
      setUnit('');
      setPreview(null);
    }
  }, [visible]);

  // Đổi loại văn bản thì số gốc đã chọn không còn ý nghĩa (mỗi loại một dãy).
  useEffect(() => {
    setBaseSeq(null);
  }, [typeId]);

  // Danh sách số gốc để chọn, chỉ nạp khi thật sự cần (chế độ số phụ).
  useEffect(() => {
    if (!visible || mode !== 'suffix' || !typeId) {
      return;
    }
    let alive = true;
    setBasesLoading(true);
    fetchBaseNumbers(year, typeId)
      .then(list => {
        if (alive) {
          setBases(list);
          setBasesLoading(false);
        }
      })
      .catch(() => {
        if (alive) {
          setBases([]);
          setBasesLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [visible, mode, typeId, year]);

  // Số dự kiến chỉ để xem trước: nó KHÔNG giữ chỗ, số thật cấp lúc bấm lưu.
  useEffect(() => {
    if (!visible || !typeId) {
      setPreview(null);
      return;
    }
    if (mode === 'suffix' && baseSeq == null) {
      setPreview(null);
      return;
    }
    let alive = true;
    const p =
      mode === 'suffix'
        ? peekNextSuffix(year, typeId, baseSeq).then(sx => ({
            seq: baseSeq,
            suffix: sx,
          }))
        : peekNextDocNumber(year, typeId).then(seq => ({ seq, suffix: '' }));
    p.then(v => {
      if (alive) {
        setPreview(v);
      }
    }).catch(() => {});
    return () => {
      alive = false;
    };
  }, [visible, typeId, year, mode, baseSeq]);

  const submit = async () => {
    if (!type) {
      Alert.alert('Thiếu thông tin', 'Vui lòng chọn loại văn bản.');
      return;
    }
    if (mode === 'suffix' && baseSeq == null) {
      Alert.alert('Thiếu thông tin', 'Vui lòng chọn số văn bản gốc.');
      return;
    }
    if (!summary.trim() || !signer.trim() || !unit.trim()) {
      Alert.alert(
        'Thiếu thông tin',
        'Vui lòng nhập trích yếu, chọn người ký và đơn vị ban hành.',
      );
      return;
    }
    try {
      setSaving(true);
      const entry = await issueDocNumber({
        user: profile,
        type,
        summary,
        signer,
        unit,
        year,
        baseSeq: mode === 'suffix' ? baseSeq : null,
      });
      // Transaction cấp số đã nhả khoá rồi, đừng nhả thêm lần nữa.
      onClose(true);
      Alert.alert('Đã cấp số', `Số văn bản: ${entry.number}`);
    } catch (e) {
      // Mất khoá → khoá không còn là của mình, đóng form mà không nhả nhầm
      // khoá của người khác.
      if (e?.code === 'doc-number/lock-lost') {
        onClose(true);
      }
      Alert.alert('Lỗi', e?.message ?? 'Không cấp được số văn bản.');
    } finally {
      setSaving(false);
    }
  };
  const cancel = () => {
    if (!saving) {
      onClose();
    }
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={cancel}
    >
      {/* Nền phải trong suốt để thấy màn hình phía sau bị làm mờ — KHÔNG dùng
          lại styles.flex, nó có màu nền đục. */}
      <KeyboardAvoidingView
        style={styles.modalFill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={cancel}>
          <Pressable style={styles.sheet}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>Lấy số văn bản</Text>
              <Text style={styles.sheetNote}>
                Bạn đang giữ quyền nhập — người khác tạm thời không lấy được số.
              </Text>

              <Text style={styles.label}>Loại văn bản</Text>
              <PositionSelect
                value={typeId}
                onChange={setTypeId}
                options={TYPE_OPTIONS}
                title="Chọn loại văn bản"
                placeholder="Chọn loại văn bản"
              />

              {type ? (
                <>
                  <Text style={styles.label}>Kiểu số</Text>
                  <View style={styles.modeRow}>
                    <ModeButton
                      active={mode === 'new'}
                      title="Số mới"
                      hint="Số tiếp theo của sổ"
                      onPress={() => setMode('new')}
                      disabled={saving}
                    />
                    <ModeButton
                      active={mode === 'suffix'}
                      title="Số phụ"
                      hint="Thêm A, B, C… vào số cũ"
                      onPress={() => setMode('suffix')}
                      disabled={saving}
                    />
                  </View>

                  {mode === 'suffix' ? (
                    <>
                      <Text style={styles.label}>Số văn bản gốc</Text>
                      {basesLoading ? (
                        <ActivityIndicator style={styles.baseLoading} />
                      ) : bases.length === 0 ? (
                        <Text style={styles.baseEmpty}>
                          Loại {type.label} chưa có số nào trong năm {year} để
                          thêm chữ phụ. Hãy lấy một số mới trước.
                        </Text>
                      ) : (
                        <PositionSelect
                          value={baseSeq}
                          onChange={setBaseSeq}
                          options={bases.map(b => ({
                            value: b.seq,
                            label: `${b.number} — ${b.summary}`,
                          }))}
                          title="Chọn số văn bản gốc"
                          placeholder="Chọn số cần thêm chữ phụ"
                        />
                      )}
                    </>
                  ) : null}

                  <View style={styles.preview}>
                    <Text style={styles.previewLabel}>Số dự kiến</Text>
                    <Text style={styles.previewValue}>
                      {preview == null
                        ? '…'
                        : formatDocNumber(
                            preview.seq,
                            type.abbr,
                            preview.suffix,
                          )}
                    </Text>
                    <Text style={styles.previewHint}>
                      Số chính thức được cấp khi bấm lưu.
                    </Text>
                  </View>
                </>
              ) : null}

              <Text style={styles.label}>Trích yếu văn bản</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={summary}
                onChangeText={setSummary}
                placeholder="Nội dung tóm tắt của văn bản…"
                placeholderTextColor={colors.textMuted}
                multiline
                textAlignVertical="top"
                editable={!saving}
              />

              <Text style={styles.label}>Người ký</Text>
              <PositionSelect
                value={signer}
                onChange={setSigner}
                options={options.signers}
                title="Chọn người ký"
                placeholder="Chọn người ký"
              />

              <Text style={styles.label}>Đơn vị ban hành</Text>
              <PositionSelect
                value={unit}
                onChange={setUnit}
                options={options.units}
                title="Chọn đơn vị ban hành"
                placeholder="Chọn đơn vị ban hành"
              />

              <TouchableOpacity
                style={styles.btn}
                activeOpacity={0.85}
                onPress={submit}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.btnText}>Cấp số văn bản</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={cancel}
                disabled={saving}
              >
                <Text style={styles.cancelText}>Huỷ và nhả quyền nhập</Text>
              </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
/** Một trong hai nút chọn kiểu số (số mới / số phụ). */
function ModeButton({ active, title, hint, onPress, disabled }) {
  return (
    <TouchableOpacity
      style={[styles.modeBtn, active && styles.modeBtnActive]}
      activeOpacity={0.8}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.modeTitle, active && styles.modeTitleActive]}>
        {title}
      </Text>
      <Text style={styles.modeHint}>{hint}</Text>
    </TouchableOpacity>
  );
}

/**
 * Sửa danh mục người ký / đơn vị ban hành (chỉ Trưởng CA và dev).
 *
 * Không cho xoá bằng vuốt hay bấm nhầm một phát là mất: mỗi dòng có nút xoá
 * riêng, và phải bấm "Lưu danh mục" thì thay đổi mới có hiệu lực. Danh mục này
 * dùng chung cả đơn vị nên một thao tác sai ảnh hưởng tới mọi người.
 */
function OptionsSheet({ visible, profile, options, onClose }) {
  const [signers, setSigners] = useState([]);
  const [units, setUnits] = useState([]);
  const [newSigner, setNewSigner] = useState('');
  const [newUnit, setNewUnit] = useState('');
  const [saving, setSaving] = useState(false);

  // Nạp lại từ danh mục đang dùng mỗi lần mở, để lần sửa dở trước không dính
  // sang lần sau.
  useEffect(() => {
    if (visible) {
      setSigners(options.signers);
      setUnits(options.units);
      setNewSigner('');
      setNewUnit('');
    }
  }, [visible, options.signers, options.units]);

  const add = (value, list, setList, setValue) => {
    const v = value.trim();
    if (!v) {
      return;
    }
    if (list.some(x => x.toLowerCase() === v.toLowerCase())) {
      Alert.alert('Đã có trong danh mục', `"${v}" đã có rồi.`);
      return;
    }
    setList([...list, v]);
    setValue('');
  };

  const save = async () => {
    if (!signers.length || !units.length) {
      Alert.alert(
        'Danh mục trống',
        'Phải có ít nhất một người ký và một đơn vị ban hành.',
      );
      return;
    }
    try {
      setSaving(true);
      await saveDocNumberOptions({ signers, units }, profile);
      onClose();
    } catch (e) {
      Alert.alert('Lỗi', e?.message ?? 'Không lưu được danh mục.');
    } finally {
      setSaving(false);
    }
  };

  const renderList = (list, setList) =>
    list.map((item, i) => (
      <View key={`${item}-${i}`} style={styles.optRow}>
        <Text style={styles.optText}>{item}</Text>
        <TouchableOpacity
          style={styles.optRemove}
          activeOpacity={0.7}
          onPress={() => setList(list.filter((_, j) => j !== i))}
          disabled={saving}
        >
          <Text style={styles.optRemoveText}>Xoá</Text>
        </TouchableOpacity>
      </View>
    ));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => !saving && onClose()}
    >
      <KeyboardAvoidingView
        style={styles.modalFill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => !saving && onClose()}
        >
          <Pressable style={styles.sheet}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>Danh mục dùng chung</Text>
              <Text style={styles.sheetNote}>
                {options.fromDefaults
                  ? 'Đang dùng danh mục mặc định. Lưu lần đầu sẽ tạo danh mục riêng của đơn vị.'
                  : 'Thay đổi có hiệu lực với mọi người ngay sau khi lưu.'}
              </Text>

              <Text style={styles.label}>Người ký</Text>
              {renderList(signers, setSigners)}
              <View style={styles.addRow}>
                <TextInput
                  style={[styles.input, styles.addInput]}
                  value={newSigner}
                  onChangeText={setNewSigner}
                  placeholder="Thêm họ tên người ký"
                  placeholderTextColor={colors.textMuted}
                  editable={!saving}
                  onSubmitEditing={() =>
                    add(newSigner, signers, setSigners, setNewSigner)
                  }
                />
                <TouchableOpacity
                  style={styles.addBtn}
                  activeOpacity={0.8}
                  onPress={() =>
                    add(newSigner, signers, setSigners, setNewSigner)
                  }
                  disabled={saving}
                >
                  <Text style={styles.addBtnText}>Thêm</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>Đơn vị ban hành</Text>
              {renderList(units, setUnits)}
              <View style={styles.addRow}>
                <TextInput
                  style={[styles.input, styles.addInput]}
                  value={newUnit}
                  onChangeText={setNewUnit}
                  placeholder="Thêm tên đơn vị"
                  placeholderTextColor={colors.textMuted}
                  editable={!saving}
                  onSubmitEditing={() => add(newUnit, units, setUnits, setNewUnit)}
                />
                <TouchableOpacity
                  style={styles.addBtn}
                  activeOpacity={0.8}
                  onPress={() => add(newUnit, units, setUnits, setNewUnit)}
                  disabled={saving}
                >
                  <Text style={styles.addBtnText}>Thêm</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.optNote}>
                Xoá một tên khỏi danh mục KHÔNG làm đổi các văn bản đã lấy số —
                chúng giữ nguyên tên đã ghi trong sổ.
              </Text>

              <TouchableOpacity
                style={styles.btn}
                activeOpacity={0.85}
                onPress={save}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.btnText}>Lưu danh mục</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => !saving && onClose()}
                disabled={saving}
              >
                <Text style={styles.cancelText}>Huỷ</Text>
              </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  modalFill: {
    flex: 1,
  },
  container: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  headerBlock: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  lockBanner: {
    backgroundColor: colors.warningBg,
    borderRadius: 10,
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
    padding: spacing.md,
  },
  lockTitle: {
    color: colors.warning,
    fontWeight: '700',
    fontSize: 15,
  },
  lockName: {
    marginTop: spacing.xs,
    color: colors.text,
    fontWeight: '700',
    fontSize: 16,
  },
  lockMeta: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 12,
  },
  freeBanner: {
    backgroundColor: colors.successBg,
    borderRadius: 10,
    padding: spacing.md,
  },
  freeText: {
    color: colors.success,
    fontWeight: '600',
  },
  btn: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  btnDisabled: {
    backgroundColor: colors.textMuted,
  },
  btnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
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
  sectionTitle: {
    marginTop: spacing.md,
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  filterCell: {
    flex: 1,
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
  linkBtn: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
  },
  linkBtnText: {
    color: colors.primary,
    fontWeight: '600',
    fontSize: 13,
  },
  modeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  modeBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
  },
  modeBtnActive: {
    borderColor: colors.primary,
    backgroundColor: '#eef4ff',
  },
  modeTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  modeTitleActive: {
    color: colors.primary,
  },
  modeHint: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
  },
  baseLoading: {
    alignSelf: 'flex-start',
    marginVertical: spacing.sm,
  },
  baseEmpty: {
    fontSize: 13,
    color: colors.warning,
    backgroundColor: colors.warningBg,
    borderRadius: 8,
    padding: spacing.sm,
    lineHeight: 19,
  },
  optRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bg,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  optText: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
  },
  optRemove: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  optRemoveText: {
    color: colors.danger,
    fontWeight: '600',
    fontSize: 13,
  },
  addRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  addInput: {
    flex: 1,
  },
  addBtn: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
  },
  addBtnText: {
    color: '#fff',
    fontWeight: '700',
  },
  optNote: {
    marginTop: spacing.md,
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: 'italic',
    lineHeight: 17,
  },
  capNote: {
    marginTop: spacing.md,
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  rowMine: {
    borderColor: colors.primary,
    backgroundColor: '#eef4ff',
  },
  badge: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: 'flex-start',
    minWidth: 56,
    alignItems: 'center',
  },
  badgeText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  rowBody: {
    flex: 1,
  },
  rowType: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },
  rowSummary: {
    fontSize: 15,
    color: colors.text,
    fontWeight: '600',
    lineHeight: 21,
    marginTop: 2,
  },
  rowMeta: {
    marginTop: 2,
    fontSize: 13,
    color: colors.textMuted,
  },
  rowMetaValue: {
    color: colors.text,
    fontWeight: '600',
  },
  rowFoot: {
    marginTop: spacing.xs,
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: spacing.md,
    maxHeight: '92%',
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  sheetNote: {
    marginTop: spacing.xs,
    fontSize: 13,
    color: colors.textMuted,
  },
  label: {
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    color: colors.text,
    fontWeight: '600',
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
  },
  inputMultiline: {
    minHeight: 90,
  },
  preview: {
    marginTop: spacing.sm,
    backgroundColor: colors.bg,
    borderRadius: 10,
    padding: spacing.md,
  },
  previewLabel: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },
  previewValue: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.primary,
  },
  previewHint: {
    fontSize: 12,
    color: colors.textMuted,
  },
});
