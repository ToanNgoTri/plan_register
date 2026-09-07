/**
 * @format
 *
 * Các hàm THUẦN của sổ số văn bản: cách trình bày số và cách đọc khoá. Firestore
 * bị mock hẳn (không require thật) vì ở đây chỉ kiểm phần tính toán — phần ghi
 * dữ liệu và phân quyền do scripts/rules.test.mjs kiểm trên emulator.
 */
jest.mock('@react-native-firebase/firestore', () => ({}));
jest.mock('../src/services/firebase', () => ({ db: {} }));
jest.mock('../src/services/userService', () => ({
  displayNameOf: u => u.name,
}));

import {
  cleanDocTypes,
  currentDocYear,
  docTypeById,
  docTypeIdFrom,
  formatDocNumber,
  isLockActive,
  suffixForIndex,
} from '../src/services/docNumberService';
import { DEFAULT_DOC_TYPES } from '../src/config/constants';

describe('formatDocNumber', () => {
  // Văn bản hành chính viết số một chữ số thành hai chữ số: "01/QĐ".
  test('đệm 0 cho số dưới 10', () => {
    expect(formatDocNumber(1, 'QĐ')).toBe('01/QĐ');
    expect(formatDocNumber(9, 'QĐ')).toBe('09/QĐ');
  });
  test('không đụng tới số từ 10 trở lên', () => {
    expect(formatDocNumber(10, 'QĐ')).toBe('10/QĐ');
    expect(formatDocNumber(112, 'QĐ')).toBe('112/QĐ');
  });
  // Công văn không có chữ viết tắt nên chỉ còn phần số.
  test('công văn chỉ có phần số', () => {
    expect(formatDocNumber(1, '')).toBe('01');
    expect(formatDocNumber(37, '')).toBe('37');
  });
  test('chữ phụ bám ngay sau số, trước dấu gạch', () => {
    expect(formatDocNumber(5, 'QĐ', 'A')).toBe('05A/QĐ');
    expect(formatDocNumber(12, 'BC', 'B')).toBe('12B/BC');
  });
});

describe('suffixForIndex', () => {
  test('đếm chữ cái theo thứ tự', () => {
    expect(suffixForIndex(1)).toBe('A');
    expect(suffixForIndex(26)).toBe('Z');
  });
  // Quá 26 gần như không xảy ra, nhưng tràn về rỗng thì sẽ cấp trùng số.
  test('quá Z thì sang hai chữ, không rỗng', () => {
    expect(suffixForIndex(27)).toBe('AA');
    expect(suffixForIndex(52)).toBe('AZ');
  });
});

describe('isLockActive', () => {
  test('không có khoá là trống', () => {
    expect(isLockActive(null, 1000)).toBe(false);
  });
  test('khoá hết hạn coi như không có ai đang nhập', () => {
    expect(isLockActive({ expiresAt: 999 }, 1000)).toBe(false);
    expect(isLockActive({ expiresAt: 1001 }, 1000)).toBe(true);
  });
});

describe('currentDocYear', () => {
  // Số mới luôn thuộc năm hiện tại — bộ đếm tách theo năm nên qua 1/1 là dãy
  // số của mỗi loại tự bắt đầu lại từ 01.
  test('là năm hiện tại của máy', () => {
    expect(currentDocYear()).toBe(new Date().getFullYear());
  });
  test('đọc lại đồng hồ mỗi lần gọi, không cache lúc nạp module', () => {
    const real = Date;
    // eslint-disable-next-line no-global-assign
    Date = class extends real {
      getFullYear() {
        return 2027;
      }
    };
    try {
      expect(currentDocYear()).toBe(2027);
    } finally {
      // eslint-disable-next-line no-global-assign
      Date = real;
    }
  });
});

describe('docTypeById', () => {
  test('trả về loại theo id', () => {
    expect(docTypeById(DEFAULT_DOC_TYPES, 'QD')).toMatchObject({ abbr: 'QĐ' });
  });
  // Loại đã bị xoá khỏi danh mục vẫn còn trong các văn bản đã cấp số.
  test('id lạ (loại đã xoá) trả null chứ không nổ', () => {
    expect(docTypeById(DEFAULT_DOC_TYPES, 'KHONG_CO')).toBeNull();
  });
});

describe('docTypeIdFrom', () => {
  // Mã đi vào id bộ đếm, id khoá và vào từng văn bản đã cấp → chỉ chữ và số.
  test('lấy từ viết tắt, bỏ dấu', () => {
    expect(docTypeIdFrom('Quyết định', 'QĐ')).toBe('QD');
    expect(docTypeIdFrom('Đề án', 'ĐA')).toBe('DA');
  });
  test('giữ nguyên hoa thường của viết tắt', () => {
    expect(docTypeIdFrom('Chương trình', 'CTr')).toBe('CTr');
  });
  test('không có viết tắt thì lấy chữ đầu của tên', () => {
    expect(docTypeIdFrom('Công văn', '')).toBe('CV');
    expect(docTypeIdFrom('Biên bản làm việc', '')).toBe('BBLV');
  });
  // Dùng lại mã cũ là nối vào dãy số của một loại khác.
  test('trùng mã đã có thì thêm số, không dùng lại', () => {
    expect(docTypeIdFrom('Báo cáo tuần', 'BC', ['BC'])).toBe('BC2');
    expect(docTypeIdFrom('Báo cáo tháng', 'BC', ['BC', 'BC2'])).toBe('BC3');
  });
  test('tên không ra được chữ nào vẫn có mã', () => {
    expect(docTypeIdFrom('...', '')).toBe('VB');
  });
});

describe('cleanDocTypes', () => {
  test('danh mục mặc định đi qua nguyên vẹn', () => {
    expect(cleanDocTypes(DEFAULT_DOC_TYPES)).toEqual(DEFAULT_DOC_TYPES);
  });
  test('sinh mã cho dòng chưa có mã, bỏ dòng trống', () => {
    expect(
      cleanDocTypes([
        { label: '  Biên bản ', abbr: ' BB ' },
        { label: '   ', abbr: 'X' },
      ]),
    ).toEqual([{ id: 'BB', label: 'Biên bản', abbr: 'BB' }]);
  });
  test('giữ nguyên mã đã có — đổi mã là cắt rời loại khỏi dãy số của nó', () => {
    expect(
      cleanDocTypes([{ id: 'CV', label: 'Công văn đi', abbr: '' }]),
    ).toEqual([{ id: 'CV', label: 'Công văn đi', abbr: '' }]);
  });
  test('bỏ dòng trùng mã và dòng có mã sai định dạng', () => {
    expect(
      cleanDocTypes([
        { id: 'BC', label: 'Báo cáo', abbr: 'BC' },
        { id: 'BC', label: 'Báo cáo khác', abbr: 'BC' },
        { id: 'B/C', label: 'Mã có gạch chéo', abbr: '' },
      ]),
    ).toEqual([{ id: 'BC', label: 'Báo cáo', abbr: 'BC' }]);
  });
});
