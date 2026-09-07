/**
 * @format
 *
 * Render thật màn hình Sổ số văn bản để trả lời đúng câu hỏi nghiệp vụ: khoá
 * nhập trích yếu chỉ khoá LOẠI đang nhập, không khoá cả sổ.
 *
 * Firestore bị mock (không require thật) và các hàm `subscribe*` được thay bằng
 * hàm giữ lại callback, nên test tự đẩy được trạng thái khoá vào màn hình y như
 * Firestore đẩy về. Các hàm thuần (formatDocNumber, isLockActive) dùng bản
 * THẬT — đó là phần quyết định banner hiện gì.
 */
jest.mock('@react-native-firebase/firestore', () => ({}));
jest.mock('../src/services/firebase', () => ({ db: {} }));
jest.mock('../src/services/userService', () => ({ displayNameOf: u => u.name }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: () => {} }));
// Nút đọc chính tả gọi tới TurboModule native; trong Jest không có nên
// speechService phải được mock, nếu không màn hình vỡ ngay lúc import.
jest.mock('../src/services/speechService', () => ({
  isSupported: () => false,
  isAvailable: () => Promise.resolve(false),
  addListeners: () => () => {},
  start: () => Promise.resolve(false),
  stop: () => Promise.resolve(),
  cancel: () => Promise.resolve(),
}));
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({
    profile: { uid: 'toi', name: 'Tôi', unit: 'Tổ An ninh' },
    isBoss: false,
    isDev: false,
  }),
}));

const captured = {};
jest.mock('../src/services/docNumberService', () => {
  const actual = jest.requireActual('../src/services/docNumberService');
  return {
    ...actual,
    subscribeDocNumberLocks: cb => {
      captured.locks = cb;
      return () => {};
    },
    subscribeDocNumberOptions: cb => {
      captured.options = cb;
      return () => {};
    },
    subscribeDocNumbers: (_f, cb) => {
      cb([]);
      return () => {};
    },
    acquireDocNumberLock: jest.fn(async () => {}),
    releaseDocNumberLock: jest.fn(async () => {}),
    renewDocNumberLock: jest.fn(async () => {}),
  };
});

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import PositionSelect from '../src/components/PositionSelect';
import DocNumberScreen from '../src/screens/DocNumberScreen';
import { acquireDocNumberLock } from '../src/services/docNumberService';

const QD = 'Quyết định (cá biệt)';
const lock = (uid, typeId, typeLabel) => ({
  uid,
  name: uid,
  unit: 'Tổ Cảnh sát',
  typeId,
  typeLabel,
  acquiredAt: Date.now(),
  expiresAt: Date.now() + 60_000,
});

/**
 * Toàn bộ chữ đang hiện trên màn hình, để tìm bằng chuỗi con. Chỉ đi theo
 * `children`: `props` của FlatList trỏ vòng lại chính header nên không
 * stringify được cả cây.
 */
const textOf = tree => {
  const out = [];
  const walk = node => {
    if (node == null || node === false) {
      return;
    }
    if (typeof node === 'string' || typeof node === 'number') {
      out.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    (node.children ?? []).forEach(walk);
  };
  walk(tree.toJSON());
  // Một dòng chữ bị cắt thành nhiều Text con ("Sổ " + tên loại + " đang
  // trống"), nối lại rồi gộp khoảng trắng để tìm bằng chuỗi liền mạch.
  return out.join(' ').replace(/\s+/g, ' ');
};
/** Ô chọn loại văn bản để lấy số (không phải ô lọc lịch sử). */
const typePicker = root =>
  root
    .findAllByType(PositionSelect)
    .find(n => n.props.title === 'Chọn loại văn bản');
/** Nút lấy số: nút đầu tiên có chữ, nằm ngay dưới ô chọn loại. */
const takeButton = root =>
  root.findAll(
    n =>
      n.props?.onPress &&
      n.props?.disabled !== undefined &&
      n.props?.activeOpacity === 0.85,
  )[0];

// Lần render ĐẦU phải nạp cả preset React Native nên tốn vài giây; mốc 5s mặc
// định của Jest sát quá, chỉ cần thêm một import là vỡ.
jest.setTimeout(30_000);

let tree;
beforeEach(async () => {
  jest.useFakeTimers();
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<DocNumberScreen />);
  });
  // Firestore đẩy về "chưa ai giữ khoá nào".
  await ReactTestRenderer.act(() => captured.locks({}));
});
afterEach(() => {
  ReactTestRenderer.act(() => tree.unmount());
  jest.useRealTimers();
  jest.clearAllMocks();
});

const pickQD = () =>
  ReactTestRenderer.act(() => typePicker(tree.root).props.onChange('QD'));

test('chưa chọn loại thì chưa cho lấy số', () => {
  expect(textOf(tree)).toContain('Chọn loại văn bản để lấy số');
  expect(takeButton(tree.root).props.disabled).toBe(true);
});

test('chọn loại đang trống thì lấy số được', async () => {
  await pickQD();
  expect(textOf(tree)).toContain(`Sổ ${QD} đang trống`);
  expect(takeButton(tree.root).props.disabled).toBe(false);
  await ReactTestRenderer.act(() => takeButton(tree.root).props.onPress());
  // Giành khoá của ĐÚNG loại đang chọn.
  expect(acquireDocNumberLock).toHaveBeenCalledWith(
    expect.objectContaining({ uid: 'toi' }),
    expect.objectContaining({ id: 'QD' }),
  );
});

test('người khác đang nhập CÙNG loại → khoá loại đó', async () => {
  await pickQD();
  await ReactTestRenderer.act(() =>
    captured.locks({ QD: lock('vanthu2', 'QD', QD) }),
  );
  const text = textOf(tree);
  expect(text).toContain(`Đang có người lấy số ${QD}`);
  expect(text).toContain('vanthu2');
  expect(text).toContain('Chỉ loại này bị khoá');
  expect(takeButton(tree.root).props.disabled).toBe(true);
});

test('người khác đang nhập loại KHÁC → vẫn lấy số bình thường', async () => {
  await pickQD();
  await ReactTestRenderer.act(() =>
    captured.locks({ BC: lock('vanthu2', 'BC', 'Báo cáo') }),
  );
  const text = textOf(tree);
  // Sổ Quyết định vẫn trống...
  expect(text).toContain(`Sổ ${QD} đang trống`);
  expect(takeButton(tree.root).props.disabled).toBe(false);
  // ...và màn hình vẫn nói rõ Báo cáo đang có người nhập.
  expect(text).toContain('Loại đang có người nhập');
  expect(text).toContain('Báo cáo');
});

test('khoá đã hết hạn coi như trống (app người giữ tắt giữa chừng)', async () => {
  await pickQD();
  await ReactTestRenderer.act(() =>
    captured.locks({
      QD: { ...lock('vanthu2', 'QD', QD), expiresAt: Date.now() - 1 },
    }),
  );
  expect(textOf(tree)).toContain(`Sổ ${QD} đang trống`);
  expect(takeButton(tree.root).props.disabled).toBe(false);
});

test('khoá chung `global` của bản cũ không khoá oan loại nào', async () => {
  await pickQD();
  // subscribeDocNumberLocks lọc theo DOC_TYPES nên id lạ không tới được đây;
  // màn hình cũng không được suy ra "cả sổ đang bị khoá" từ khoá của loại khác.
  await ReactTestRenderer.act(() =>
    captured.locks({ BC: lock('vanthu2', 'BC', 'Báo cáo') }),
  );
  expect(takeButton(tree.root).props.disabled).toBe(false);
});

/** Đẩy một danh mục dùng chung từ "Firestore" vào màn hình. */
const pushTypes = types =>
  ReactTestRenderer.act(() =>
    captured.options({
      signers: ['Ông A'],
      units: ['Tổ An ninh'],
      types,
      fromDefaults: false,
    }),
  );

describe('danh mục loại văn bản lấy từ dữ liệu', () => {
  // Đây là điểm mấu chốt: thêm/bớt loại là sửa dữ liệu, không phải ra bản
  // cập nhật app.
  test('loại mới trong dữ liệu hiện ngay trong ô chọn', async () => {
    await pushTypes([
      { id: 'BB', label: 'Biên bản', abbr: 'BB' },
      { id: 'QD', label: QD, abbr: 'QĐ' },
    ]);
    const opts = typePicker(tree.root).props.options;
    expect(opts).toEqual([
      { value: 'BB', label: 'Biên bản (BB)' },
      { value: 'QD', label: `${QD} (QĐ)` },
    ]);
  });

  test('loại không có viết tắt hiện tên trần', async () => {
    await pushTypes([{ id: 'CV', label: 'Công văn', abbr: '' }]);
    expect(typePicker(tree.root).props.options).toEqual([
      { value: 'CV', label: 'Công văn' },
    ]);
  });

  test('lấy số theo đúng loại vừa thêm trong dữ liệu', async () => {
    await pushTypes([{ id: 'BB', label: 'Biên bản', abbr: 'BB' }]);
    await ReactTestRenderer.act(() =>
      typePicker(tree.root).props.onChange('BB'),
    );
    expect(textOf(tree)).toContain('Sổ Biên bản đang trống');
    await ReactTestRenderer.act(() => takeButton(tree.root).props.onPress());
    expect(acquireDocNumberLock).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'toi' }),
      { id: 'BB', label: 'Biên bản', abbr: 'BB' },
    );
  });

  // Loại bị xoá khỏi danh mục: không lấy số mới được nữa, nhưng màn hình phải
  // đứng vững chứ không vỡ — các văn bản đã cấp số vẫn còn trong sổ.
  test('loại đang chọn bị xoá khỏi danh mục thì quay về trạng thái chưa chọn', async () => {
    await pushTypes([{ id: 'BB', label: 'Biên bản', abbr: 'BB' }]);
    await ReactTestRenderer.act(() =>
      typePicker(tree.root).props.onChange('BB'),
    );
    await pushTypes([{ id: 'QD', label: QD, abbr: 'QĐ' }]);
    expect(textOf(tree)).toContain('Chọn loại văn bản để lấy số');
    expect(takeButton(tree.root).props.disabled).toBe(true);
  });
});

test('năm cấp số là năm hiện tại, không phải năm đang xem lịch sử', () => {
  expect(textOf(tree)).toContain(
    `Đang cấp số của năm ${new Date().getFullYear()}`,
  );
  expect(textOf(tree)).toContain('bắt đầu lại từ 01 mỗi năm');
});
