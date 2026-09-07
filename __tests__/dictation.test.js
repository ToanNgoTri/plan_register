import {
  normalizeDictation,
  appendDictation,
} from '../src/utils/dictation';

describe('normalizeDictation', () => {
  it('đổi từ đọc thành dấu câu và viết hoa đầu câu', () => {
    expect(normalizeDictation('về việc ban hành quy chế làm việc chấm')).toBe(
      'Về việc ban hành quy chế làm việc.',
    );
  });

  it('xử lý dấu phẩy giữa câu', () => {
    expect(
      normalizeDictation(
        'kính gửi phòng tổ chức phẩy phòng hành chính chấm',
      ),
    ).toBe('Kính gửi phòng tổ chức, phòng hành chính.');
  });

  it('viết hoa lại sau mỗi dấu chấm', () => {
    expect(normalizeDictation('báo cáo tuần chấm tuần sau nghỉ chấm')).toBe(
      'Báo cáo tuần. Tuần sau nghỉ.',
    );
  });

  it('ưu tiên cụm dài: "chấm phẩy" ra dấu chấm phẩy', () => {
    expect(normalizeDictation('mục một chấm phẩy mục hai chấm')).toBe(
      'Mục một; mục hai.',
    );
  });

  it('không nuốt "chấm" khi nó là một phần của cụm từ thật', () => {
    expect(normalizeDictation('quyết định chấm dứt hợp đồng lao động')).toBe(
      'Quyết định chấm dứt hợp đồng lao động',
    );
    expect(normalizeDictation('kết quả chấm điểm thi đua')).toBe(
      'Kết quả chấm điểm thi đua',
    );
  });

  it('coi "hai chấm" trần là số thứ tự, không phải dấu hai chấm', () => {
    expect(normalizeDictation('thực hiện điều hai chấm')).toBe(
      'Thực hiện điều hai.',
    );
    expect(normalizeDictation('nội dung dấu hai chấm họp giao ban')).toBe(
      'Nội dung: họp giao ban',
    );
  });

  it('xuống dòng và viết hoa dòng mới', () => {
    expect(normalizeDictation('điều một xuống dòng điều hai')).toBe(
      'Điều một\nĐiều hai',
    );
  });

  it('đặt ngoặc đúng chỗ, không thừa khoảng trắng', () => {
    expect(
      normalizeDictation('phụ lục mở ngoặc kèm theo đóng ngoặc chấm'),
    ).toBe('Phụ lục (kèm theo).');
  });

  it('bỏ dấu câu mở đầu và dấu câu lặp', () => {
    expect(normalizeDictation('chấm báo cáo')).toBe('Báo cáo');
    expect(normalizeDictation('báo cáo chấm chấm')).toBe('Báo cáo.');
  });

  it('trả về chuỗi rỗng khi không có gì', () => {
    expect(normalizeDictation('')).toBe('');
    expect(normalizeDictation(undefined)).toBe('');
  });
});

describe('appendDictation', () => {
  it('nối tiếp giữa câu thì viết thường', () => {
    expect(appendDictation('Về việc', 'ban hành quy chế chấm')).toBe(
      'Về việc ban hành quy chế.',
    );
  });

  it('sau dấu chấm thì viết hoa', () => {
    expect(appendDictation('Về việc ban hành.', 'quy chế mới chấm')).toBe(
      'Về việc ban hành. Quy chế mới.',
    );
  });

  it('đọc mỗi "chấm" vẫn chốt được câu đang dở', () => {
    expect(appendDictation('Báo cáo tuần', 'chấm')).toBe('Báo cáo tuần.');
  });

  it('giữ nguyên xuống dòng người dùng đã gõ', () => {
    expect(appendDictation('Điều 1\n', 'điều hai')).toBe('Điều 1\nĐiều hai');
  });

  it('không sửa chữ hoa/thường của phần đã gõ trước đó', () => {
    expect(appendDictation('BÁO CÁO tuần', 'đã gửi chấm')).toBe(
      'BÁO CÁO tuần đã gửi.',
    );
  });

  it('chuỗi rỗng ở hai đầu', () => {
    expect(appendDictation('', 'báo cáo chấm')).toBe('Báo cáo.');
    expect(appendDictation('Nội dung', '')).toBe('Nội dung');
    expect(appendDictation('', '')).toBe('');
  });
});
