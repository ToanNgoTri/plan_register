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
import DictationButton from '../components/DictationButton';
import {
  DOC_HISTORY_LIMIT,
  acquireDocNumberLock,
  currentDocYear,
  docTypeIdFrom,
  fetchBaseNumbers,
  formatDocNumber,
  isLockActive,
  issueDocNumber,
  peekNextDocNumber,
  peekNextSuffix,
  releaseDocNumberLock,
  renewDocNumberLock,
  saveDocNumberOptions,
  subscribeDocNumberLocks,
  subscribeDocNumberOptions,
  subscribeDocNumbers,
} from '../services/docNumberService';
import {
  DEFAULT_DOC_TYPES,
  DEFAULT_ISSUING_UNITS,
  DEFAULT_SIGNERS,
  DOC_LOCK_HEARTBEAT_MS,
} from '../config/constants';
import { formatDateTimeVi } from '../utils/date';
import { colors, spacing } from '../theme';

/** Tên loại kèm chữ viết tắt: "Quyết định (cá biệt) (QĐ)". */
const typeLabelOf = t => (t.abbr ? `${t.label} (${t.abbr})` : t.label);
/** Danh mục loại (từ dữ liệu) thành lựa chọn cho PositionSelect. */
const typeOptionsOf = types =>
  types.map(t => ({ value: t.id, label: typeLabelOf(t) }));

/** Năm được xem lịch sử: năm nay và 4 năm trước. */
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => {
  const y = new Date().getFullYear() - i;
  return { value: y, label: `Năm ${y}` };
});

/**
 * Sổ số văn bản: lấy số cho văn bản đi và tra lại các số đã cấp.
 *
 * Khoá theo TỪNG LOẠI văn bản: cùng một loại thì mỗi lần chỉ một người được mở
 * ô nhập (người khác thấy tên người đang nhập và nút bị khoá), nhưng hai người
 * lấy số của hai loại khác nhau thì làm song song bình thường. Vì vậy loại văn
 * bản phải chọn TRƯỚC khi mở ô nhập — lúc bấm nút mới biết phải giành khoá nào.
 *
 * Khoá tự hết hạn nếu app người giữ tắt giữa chừng, nên màn hình phải tự tính
 * lại theo đồng hồ (`now`) chứ không chờ Firestore đẩy về: hết hạn là một mốc
 * thời gian, không phải một lần ghi document.
 */
export default function DocNumberScreen() {
  const { profile, isBoss, isDev } = useAuth();
  // Khoá đang giữ của từng loại: { [typeId]: khoá }. Loại không có mặt = trống.
  const [locks, setLocks] = useState({});
  // Loại văn bản sắp lấy số (chọn trước khi giành khoá) và loại đang giữ khoá.
  const [takeTypeId, setTakeTypeId] = useState('');
  const [heldTypeId, setHeldTypeId] = useState(null);
  const [options, setOptions] = useState({
    signers: DEFAULT_SIGNERS,
    units: DEFAULT_ISSUING_UNITS,
    types: DEFAULT_DOC_TYPES,
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
  // Số MỚI luôn thuộc năm hiện tại, không phải năm đang xem lịch sử: bộ đếm
  // tách theo năm nên qua 1/1 là dãy số của mỗi loại tự bắt đầu lại từ 01.
  const issueYear = currentDocYear();

  // Ai đang giữ quyền nhập loại nào, theo thời gian thực.
  useEffect(() => subscribeDocNumberLocks(setLocks, () => {}), []);

  // Danh mục người ký / đơn vị ban hành, cũng theo thời gian thực: quản lý sửa
  // danh mục thì máy đang mở form thấy ngay, không phải khởi động lại app.
  useEffect(() => subscribeDocNumberOptions(setOptions, () => {}), []);

  // Khoá hết hạn theo đồng hồ chứ không theo snapshot, nên phải tự nhịp lại.
  // Chỉ chạy khi thực sự có khoá — không ai giữ thì không cần đếm giờ.
  const anyLock = Object.keys(locks).length > 0;
  useEffect(() => {
    if (!anyLock) {
      return;
    }
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyLock]);

  // Danh mục loại lấy từ dữ liệu (options.types), nên Trưởng CA thêm/bớt loại
  // là mọi máy thấy ngay — không phải chờ bản cập nhật app.
  const typeOptions = typeOptionsOf(options.types);
  const takeType = options.types.find(t => t.id === takeTypeId) ?? null;
  const heldType = options.types.find(t => t.id === heldTypeId) ?? null;
  // Tình trạng của ĐÚNG loại đang chọn — loại khác bị khoá không liên quan.
  const takeLock = takeTypeId ? locks[takeTypeId] ?? null : null;
  const active = isLockActive(takeLock, now);
  const heldByMe = active && takeLock.uid === uid;
  const heldByOther = active && takeLock.uid !== uid;
  // Các loại KHÁC đang có người nhập, để cả đơn vị thấy sổ nào đang bận thay vì
  // phải chọn từng loại mới biết.
  const otherBusy = Object.values(locks).filter(
    l => isLockActive(l, now) && l.typeId !== takeTypeId,
  );

  // Giữ khoá sống trong lúc form còn mở (người dùng có thể gõ trích yếu lâu
  // hơn thời gian sống của khoá).
  useEffect(() => {
    if (!formOpen || !uid || !heldTypeId) {
      return;
    }
    const id = setInterval(() => {
      renewDocNumberLock(uid, heldTypeId).catch(() => {});
    }, DOC_LOCK_HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [formOpen, uid, heldTypeId]);

  // Khoá bị người khác lấy mất (khoá của mình đã hết hạn trước đó) → đóng form
  // và nói rõ lý do, thay vì để người dùng gõ xong mới báo lỗi lúc lưu.
  // Khoá BIẾN MẤT thì không báo gì: đó là lúc cấp số xong, transaction tự nhả.
  useEffect(() => {
    if (!formOpen || !heldTypeId) {
      return;
    }
    const mine = locks[heldTypeId];
    if (mine && mine.uid !== uid) {
      setFormOpen(false);
      setHeldTypeId(null);
      Alert.alert(
        'Mất quyền nhập',
        `${mine.name} đã lấy quyền nhập số ${mine.typeLabel ?? 'văn bản'}.`,
      );
    }
  }, [formOpen, heldTypeId, locks, uid]);

  // Rời màn hình (chuyển tab / thoát) trong lúc form mở → nhả khoá ngay, đừng
  // bắt người cùng làm loại đó chờ hết hạn.
  const formOpenRef = useRef(false);
  formOpenRef.current = formOpen;
  const heldTypeRef = useRef(null);
  heldTypeRef.current = heldTypeId;
  useFocusEffect(
    useCallback(
      () => () => {
        if (formOpenRef.current && uid && heldTypeRef.current) {
          setFormOpen(false);
          releaseDocNumberLock(uid, heldTypeRef.current).catch(() => {});
          setHeldTypeId(null);
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
    if (!profile || !takeType) {
      return;
    }
    try {
      setAcquiring(true);
      // Giành khoá của ĐÚNG loại đang chọn; các loại khác không bị ảnh hưởng.
      await acquireDocNumberLock(profile, takeType);
      setHeldTypeId(takeType.id);
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
    if (!lockReleased && uid && heldTypeId) {
      releaseDocNumberLock(uid, heldTypeId).catch(() => {});
    }
    setHeldTypeId(null);
  };

  /**
   * Sau khi cấp số: kéo bộ lọc lịch sử về đúng văn bản vừa cấp, nhưng CHỈ khi
   * bộ lọc hiện tại đang che nó đi. Số mới luôn thuộc năm hiện tại và loại vừa
   * chọn; nếu người dùng đang xem năm khác / loại khác thì họ sẽ tưởng số vừa
   * lấy không được ghi vào sổ.
   */
  const showIssued = entry => {
    setYear(y => (y === entry.year ? y : entry.year));
    setFilterType(f => (!f || f === entry.typeId ? f : entry.typeId));
  };

  const header = (
    <View style={styles.headerBlock}>
      <Text style={styles.sectionTitle}>Lấy số văn bản</Text>
      <Text style={styles.issueNote}>
        Đang cấp số của năm {issueYear}. Mỗi loại văn bản là một dãy số riêng và
        bắt đầu lại từ 01 mỗi năm.
      </Text>
      <PositionSelect
        value={takeTypeId}
        onChange={setTakeTypeId}
        options={typeOptions}
        title="Chọn loại văn bản"
        placeholder="Chọn loại văn bản cần lấy số"
      />

      {!takeType ? (
        <View style={styles.hintBanner}>
          <Text style={styles.hintText}>
            Chọn loại văn bản để xem sổ của loại đó có ai đang lấy số hay không.
          </Text>
        </View>
      ) : heldByOther ? (
        <View style={styles.lockBanner}>
          <Text style={styles.lockTitle}>
            🔒 Đang có người lấy số {takeType.label}
          </Text>
          <Text style={styles.lockName}>
            {takeLock.name}
            {takeLock.unit ? ` · ${takeLock.unit}` : ''}
          </Text>
          <Text style={styles.lockMeta}>
            Bắt đầu lúc {formatDateTimeVi(takeLock.acquiredAt)} · tự mở sau{' '}
            {Math.max(0, Math.ceil((takeLock.expiresAt - now) / 1000))} giây nếu
            không thao tác
          </Text>
          <Text style={styles.lockMeta}>
            Chỉ loại này bị khoá — các loại văn bản khác vẫn lấy số được.
          </Text>
        </View>
      ) : (
        <View style={styles.freeBanner}>
          <Text style={styles.freeText}>
            ● Sổ {takeType.label} đang trống, bạn có thể lấy số.
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={[
          styles.btn,
          (!takeType || heldByOther || acquiring) && styles.btnDisabled,
        ]}
        activeOpacity={0.85}
        onPress={openForm}
        disabled={!takeType || heldByOther || acquiring}
      >
        {acquiring ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnText}>
            {!takeType
              ? 'Chọn loại văn bản để lấy số'
              : heldByOther
              ? `Đang khoá — ${takeLock.name} nhập`
              : heldByMe
              ? `Tiếp tục lấy số ${takeType.label}`
              : `Lấy số ${takeType.label}`}
          </Text>
        )}
      </TouchableOpacity>

      {otherBusy.length ? (
        <View style={styles.busyBlock}>
          <Text style={styles.busyTitle}>Loại đang có người nhập</Text>
          {otherBusy.map(l => (
            <Text key={l.typeId} style={styles.busyRow}>
              • {l.typeLabel ?? l.typeId} — {l.name}
              {l.unit ? ` · ${l.unit}` : ''}
            </Text>
          ))}
        </View>
      ) : null}

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
              ...typeOptions,
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
        visible={formOpen && !!heldType}
        profile={profile}
        type={heldType}
        options={options}
        onClose={closeForm}
        onIssued={showIssued}
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
        {/* Dựng lại từ `seq` chứ không in trường `number` đã lưu, để những số
            cấp trước khi có phần đệm hai chữ số cũng hiện đúng một kiểu. */}
        <Text style={styles.badgeText}>
          {formatDocNumber(item.seq, item.typeAbbr, item.suffix)}
        </Text>
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
 * Ô nhập một văn bản mới CỦA MỘT LOẠI đã chọn sẵn ở màn hình ngoài. Chỉ mở được
 * sau khi đã giành xong khoá của loại đó, nên ở đây không kiểm tra khoá nữa —
 * transaction cấp số mới là chỗ kiểm tra thật.
 *
 * Loại văn bản KHÔNG đổi được trong này: khoá đã giành theo loại, đổi loại giữa
 * lúc nhập là đang giữ khoá loại này mà cấp số loại khác.
 */
function IssueSheet({ visible, profile, type, options, onClose, onIssued }) {
  // 'new' = số tiếp theo của sổ; 'suffix' = thêm chữ cái vào một số đã cấp.
  const [mode, setMode] = useState('new');
  // Cả năm và số gốc, vì số phụ có thể bám vào văn bản của năm trước.
  const [base, setBase] = useState(null);
  const [bases, setBases] = useState([]);
  const [basesLoading, setBasesLoading] = useState(false);
  const [summary, setSummary] = useState('');
  // Trong lúc đọc chính tả thì khoá ô trích yếu: kết quả tạm được ghép lại từ
  // mốc đầu đoạn, nên chữ gõ tay xen vào giữa sẽ bị đè mất.
  const [dictating, setDictating] = useState(false);
  const [signer, setSigner] = useState('');
  const [unit, setUnit] = useState('');
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const typeId = type?.id ?? '';
  // Số mới thuộc năm hiện tại; số phụ thuộc năm của văn bản gốc.
  const issueYear = currentDocYear();
  const targetYear = mode === 'suffix' && base ? base.year : issueYear;

  // Mỗi lần mở là một văn bản mới. Người ký và đơn vị KHÔNG đặt sẵn: chúng là
  // lựa chọn có chủ đích của văn thư, đặt sẵn một giá trị dễ khiến người dùng
  // bấm lưu mà không để ý.
  useEffect(() => {
    if (visible) {
      setMode('new');
      setBase(null);
      setBases([]);
      setSummary('');
      setSigner('');
      setUnit('');
      setPreview(null);
    }
  }, [visible]);

  // Danh sách số gốc để chọn, chỉ nạp khi thật sự cần (chế độ số phụ). Lấy cả
  // năm trước: đầu tháng 1, văn bản gốc cần thêm chữ phụ vẫn còn ở năm cũ.
  useEffect(() => {
    if (!visible || mode !== 'suffix' || !typeId) {
      return;
    }
    let alive = true;
    setBasesLoading(true);
    fetchBaseNumbers(typeId, [issueYear, issueYear - 1])
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
  }, [visible, mode, typeId, issueYear]);

  // Số dự kiến chỉ để xem trước: nó KHÔNG giữ chỗ, số thật cấp lúc bấm lưu.
  useEffect(() => {
    if (!visible || !typeId) {
      setPreview(null);
      return;
    }
    if (mode === 'suffix' && !base) {
      setPreview(null);
      return;
    }
    let alive = true;
    const p =
      mode === 'suffix'
        ? peekNextSuffix(base.year, typeId, base.seq).then(sx => ({
            seq: base.seq,
            suffix: sx,
          }))
        : peekNextDocNumber(issueYear, typeId).then(seq => ({
            seq,
            suffix: '',
          }));
    p.then(v => {
      if (alive) {
        setPreview(v);
      }
    }).catch(() => {});
    return () => {
      alive = false;
    };
  }, [visible, typeId, issueYear, mode, base]);

  const submit = async () => {
    if (!type) {
      Alert.alert('Thiếu thông tin', 'Vui lòng chọn loại văn bản.');
      return;
    }
    if (mode === 'suffix' && !base) {
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
        // Đọc lại năm ngay lúc lưu: form có thể mở sẵn qua đêm 31/12, và số mới
        // thì phải thuộc năm đang cấp chứ không phải năm lúc mở form.
        year: mode === 'suffix' ? base.year : currentDocYear(),
        baseSeq: mode === 'suffix' ? base.seq : null,
      });
      // Kéo lịch sử về đúng năm vừa cấp: số mới luôn thuộc năm hiện tại, mà
      // người dùng có thể đang xem lịch sử của năm khác — không nhảy theo thì
      // họ tưởng số vừa lấy bị mất.
      onIssued?.(entry);
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
              <Text style={styles.sheetTitle}>
                Lấy số {type?.label ?? 'văn bản'}
              </Text>
              <Text style={styles.sheetNote}>
                Bạn đang giữ quyền nhập loại này — người khác vẫn lấy được số
                của các loại văn bản khác.
              </Text>

              <View style={styles.fixedType}>
                <Text style={styles.fixedTypeLabel}>Loại văn bản</Text>
                <Text style={styles.fixedTypeValue}>
                  {type
                    ? type.abbr
                      ? `${type.label} (${type.abbr})`
                      : type.label
                    : ''}
                </Text>
                <Text style={styles.fixedTypeHint}>
                  Muốn lấy số loại khác thì huỷ ở dưới rồi chọn lại loại — khoá
                  đặt theo từng loại văn bản.
                </Text>
              </View>

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
                          Loại {type.label} chưa có số nào trong năm {issueYear}{' '}
                          hoặc {issueYear - 1} để thêm chữ phụ. Hãy lấy một số
                          mới trước.
                        </Text>
                      ) : (
                        <PositionSelect
                          // Khoá chọn phải mang cả năm: hai năm có thể cùng có
                          // số 12, chọn theo seq thôi là chọn nhầm văn bản.
                          value={base ? `${base.year}-${base.seq}` : null}
                          onChange={v =>
                            setBase(
                              bases.find(b => `${b.year}-${b.seq}` === v) ??
                                null,
                            )
                          }
                          options={bases.map(b => ({
                            value: `${b.year}-${b.seq}`,
                            label: `${formatDocNumber(
                              b.seq,
                              b.typeAbbr,
                              b.suffix,
                            )}${
                              b.year === issueYear ? '' : ` (năm ${b.year})`
                            } — ${b.summary}`,
                          }))}
                          title="Chọn số văn bản gốc"
                          placeholder="Chọn số cần thêm chữ phụ"
                        />
                      )}
                    </>
                  ) : null}

                  <View style={styles.preview}>
                    <Text style={styles.previewLabel}>
                      Số dự kiến · năm {targetYear}
                    </Text>
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
                editable={!saving && !dictating}
              />
              <DictationButton
                value={summary}
                onChangeText={setSummary}
                disabled={saving}
                onRecordingChange={setDictating}
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
  const [types, setTypes] = useState([]);
  const [newSigner, setNewSigner] = useState('');
  const [newUnit, setNewUnit] = useState('');
  const [newTypeLabel, setNewTypeLabel] = useState('');
  const [newTypeAbbr, setNewTypeAbbr] = useState('');
  const [saving, setSaving] = useState(false);

  // Nạp lại từ danh mục đang dùng mỗi lần mở, để lần sửa dở trước không dính
  // sang lần sau.
  useEffect(() => {
    if (visible) {
      setSigners(options.signers);
      setUnits(options.units);
      setTypes(options.types);
      setNewSigner('');
      setNewUnit('');
      setNewTypeLabel('');
      setNewTypeAbbr('');
    }
  }, [visible, options.signers, options.units, options.types]);

  /**
   * Thêm một loại văn bản. Mã (`id`) sinh tự động và hiện ra cho người dùng
   * thấy, vì nó đi vào số của mọi văn bản thuộc loại này và sau đó KHÔNG sửa
   * được nữa — sửa mã là cắt rời loại đó khỏi dãy số của chính nó.
   */
  const addType = () => {
    const label = newTypeLabel.trim();
    const abbr = newTypeAbbr.trim();
    if (!label) {
      Alert.alert('Thiếu tên loại', 'Nhập tên loại văn bản, ví dụ "Biên bản".');
      return;
    }
    if (types.some(t => t.label.toLowerCase() === label.toLowerCase())) {
      Alert.alert('Đã có trong danh mục', `"${label}" đã có rồi.`);
      return;
    }
    const id = docTypeIdFrom(
      label,
      abbr,
      types.map(t => t.id),
    );
    setTypes([...types, { id, label, abbr }]);
    setNewTypeLabel('');
    setNewTypeAbbr('');
  };

  const removeType = id => {
    const t = types.find(x => x.id === id);
    Alert.alert(
      `Xoá loại ${t?.label ?? id}?`,
      'Loại này sẽ không còn trong danh sách lấy số. Các văn bản ĐÃ cấp số vẫn ' +
        'giữ nguyên trong sổ, và nếu thêm lại đúng loại này thì số sẽ nối tiếp ' +
        'dãy cũ chứ không quay về 01.',
      [
        { text: 'Huỷ', style: 'cancel' },
        {
          text: 'Xoá',
          style: 'destructive',
          onPress: () => setTypes(types.filter(x => x.id !== id)),
        },
      ],
    );
  };

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
    if (!signers.length || !units.length || !types.length) {
      Alert.alert(
        'Danh mục trống',
        'Phải có ít nhất một loại văn bản, một người ký và một đơn vị ban hành.',
      );
      return;
    }
    try {
      setSaving(true);
      await saveDocNumberOptions({ signers, units, types }, profile);
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

              <Text style={styles.label}>Loại văn bản</Text>
              {types.map(t => (
                <View key={t.id} style={styles.optRow}>
                  <View style={styles.typeCell}>
                    <Text style={styles.optText}>{t.label}</Text>
                    <Text style={styles.typeMeta}>
                      Mã {t.id}
                      {t.abbr ? ` · số ghi "…/${t.abbr}"` : ' · số không có chữ viết tắt'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.optRemove}
                    activeOpacity={0.7}
                    onPress={() => removeType(t.id)}
                    disabled={saving}
                  >
                    <Text style={styles.optRemoveText}>Xoá</Text>
                  </TouchableOpacity>
                </View>
              ))}
              <View style={styles.addRow}>
                <TextInput
                  style={[styles.input, styles.addInput]}
                  value={newTypeLabel}
                  onChangeText={setNewTypeLabel}
                  placeholder="Tên loại, vd Biên bản"
                  placeholderTextColor={colors.textMuted}
                  editable={!saving}
                />
                <TextInput
                  style={[styles.input, styles.abbrInput]}
                  value={newTypeAbbr}
                  onChangeText={setNewTypeAbbr}
                  placeholder="Vt"
                  placeholderTextColor={colors.textMuted}
                  editable={!saving}
                  onSubmitEditing={addType}
                />
                <TouchableOpacity
                  style={styles.addBtn}
                  activeOpacity={0.8}
                  onPress={addType}
                  disabled={saving}
                >
                  <Text style={styles.addBtnText}>Thêm</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.optNote}>
                Viết tắt là phần sau dấu gạch của số văn bản (QĐ → "01/QĐ"). Bỏ
                trống nếu loại đó chỉ có số trần như công văn. Mã của loại sinh
                tự động và không đổi được về sau — mỗi mã là một dãy số riêng.
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
  issueNote: {
    marginTop: -spacing.xs,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
  hintBanner: {
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  hintText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  busyBlock: {
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  busyTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  busyRow: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 19,
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
  typeCell: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  typeMeta: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textMuted,
  },
  abbrInput: {
    width: 68,
    marginLeft: spacing.xs,
  },
  fixedType: {
    marginTop: spacing.md,
    backgroundColor: colors.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  fixedTypeLabel: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },
  fixedTypeValue: {
    marginTop: 2,
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  fixedTypeHint: {
    marginTop: spacing.xs,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 17,
  },
});
