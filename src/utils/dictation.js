/**
 * Hậu xử lý văn bản đọc chính tả (lớp 2).
 *
 * ASR trên máy trả về chuỗi gần như không dấu câu và không viết hoa. Module này
 * chuyển các từ người dùng đọc ra miệng ("phẩy", "chấm", "xuống dòng") thành ký
 * tự tương ứng, dán chúng vào đúng chỗ rồi viết hoa đầu câu. Hàm thuần tuý —
 * gọi được cho cả phần chữ đã chốt lẫn phần đang bay, không tốn gì.
 */

/** '\n' là ký tự đặc biệt: xuống dòng chứ không phải dấu câu. */
const NEWLINE = '\n';

/**
 * Cụm đọc → ký tự. Duyệt theo cụm dài trước, nên "chấm phẩy" thắng "chấm",
 * và "dấu chấm hỏi" thắng "dấu chấm".
 */
const SPOKEN_PUNCTUATION = [
  ['dấu chấm phẩy', ';'],
  ['chấm phẩy', ';'],
  ['dấu chấm hỏi', '?'],
  ['dấu chấm than', '!'],
  ['dấu chấm cảm', '!'],
  ['dấu hai chấm', ':'],
  ['dấu ba chấm', '…'],
  ['chấm hỏi', '?'],
  ['chấm than', '!'],
  ['chấm cảm', '!'],
  // Cố ý không nhận "hai chấm" và "ba chấm" trần: văn bản hành chính đầy "mục
  // hai chấm", "điều ba chấm" — ý người đọc là "mục 2." chứ không phải dấu hai
  // chấm. Muốn ra ':' hay '…' thì phải đọc kèm chữ "dấu".
  ['dấu hỏi', '?'],
  ['dấu phẩy', ','],
  ['dấu chấm', '.'],
  ['xuống dòng', NEWLINE],
  ['sang dòng', NEWLINE],
  ['dòng mới', NEWLINE],
  ['mở ngoặc kép', '“'],
  ['đóng ngoặc kép', '”'],
  ['mở ngoặc đơn', '('],
  ['đóng ngoặc đơn', ')'],
  ['mở ngoặc', '('],
  ['đóng ngoặc', ')'],
  ['gạch chéo', '/'],
  ['gạch dưới', '_'],
  ['gạch ngang', '-'],
  ['gạch nối', '-'],
  ['phẩy', ','],
  ['chấm', '.'],
];

/**
 * "chấm" và "phẩy" đứng một mình cũng là từ bình thường. Nếu từ ngay sau nằm
 * trong danh sách này thì coi như đang nói một cụm thật, không phải đọc dấu.
 */
const COMPOUND_GUARD = {
  chấm: ['dứt', 'công', 'thi', 'điểm', 'bài', 'phá', 'đen', 'hết', 'mút'],
  phẩy: ['tay'],
};

/** Dấu dính vào chữ đứng trước, không có khoảng trắng chen giữa. */
const ATTACH_LEFT = new Set([',', '.', ';', ':', '?', '!', '…', ')', '”']);
/** Dấu dính vào chữ đứng sau. */
const ATTACH_RIGHT = new Set(['(', '“']);
/** Dấu dính cả hai bên — không đẻ ra khoảng trắng nào. */
const ATTACH_BOTH = new Set(['/', '_', '-']);
/** Sau những dấu này là một câu mới, phải viết hoa. */
const SENTENCE_END = new Set(['.', '?', '!', '…', NEWLINE]);
/**
 * Dấu ngắt câu — hai dấu loại này không đứng cạnh nhau, cái sau bị bỏ. Ngoặc
 * đóng không nằm trong đây vì "…đóng ngoặc chấm" phải ra ")." chứ không mất dấu.
 */
const NO_REPEAT = new Set([',', '.', ';', ':', '?', '!', '…']);

/** Số token nhiều nhất của một cụm trong bảng trên. */
const MAX_PHRASE_WORDS = 3;

const PHRASE_MAP = new Map(SPOKEN_PUNCTUATION);

/**
 * Đưa về NFC để so khớp với các cụm ở trên — một số máy trả về tiếng Việt dạng
 * tổ hợp (NFD). Bản Hermes không kèm ICU sẽ không có normalize, khi đó dùng
 * nguyên chuỗi.
 */
function toNFC(text) {
  return typeof text.normalize === 'function' ? text.normalize('NFC') : text;
}

/**
 * Cắt chuỗi thành các mẩu: mỗi mẩu là { kind: 'word' | 'punct', value }.
 * Cụm đọc thành dấu được thay tại đây; chữ còn lại giữ nguyên.
 */
function tokenize(text) {
  const words = toNFC(text).split(/\s+/).filter(Boolean);
  const parts = [];

  for (let i = 0; i < words.length; ) {
    let matched = false;

    // Thử cụm dài trước để "chấm phẩy" không bị đọc thành "chấm" rồi "phẩy".
    for (let span = MAX_PHRASE_WORDS; span >= 1 && !matched; span -= 1) {
      if (i + span > words.length) {
        continue;
      }
      const phrase = words
        .slice(i, i + span)
        .join(' ')
        .toLowerCase();
      const symbol = PHRASE_MAP.get(phrase);
      if (!symbol) {
        continue;
      }

      const guard = COMPOUND_GUARD[phrase];
      if (guard && guard.includes((words[i + span] || '').toLowerCase())) {
        continue;
      }

      parts.push({ kind: 'punct', value: symbol });
      i += span;
      matched = true;
    }

    if (!matched) {
      parts.push({ kind: 'word', value: words[i] });
      i += 1;
    }
  }

  return parts;
}

/** Chuỗi `out` đang mở ngoặc/mở nháy thì chữ tiếp theo dính luôn, không cách. */
function needsSpaceAfter(out) {
  if (!out) {
    return false;
  }
  const last = out.slice(-1);
  return !(last === NEWLINE || ATTACH_RIGHT.has(last) || ATTACH_BOTH.has(last));
}

/**
 * Ghép các mẩu lại, đặt khoảng trắng theo loại dấu. `initial` cho phép nối
 * thẳng vào phần chữ đã có sẵn thay vì dựng chuỗi mới từ đầu.
 */
function join(parts, initial = '') {
  let out = initial;
  let pendingSpace = needsSpaceAfter(out);

  for (const part of parts) {
    if (part.kind === 'word') {
      if (pendingSpace) {
        out += ' ';
      }
      out += part.value;
      pendingSpace = true;
      continue;
    }

    const symbol = part.value;

    if (symbol === NEWLINE) {
      out = out.replace(/[ \t]+$/, '');
      if (out) {
        out += NEWLINE;
      }
      pendingSpace = false;
    } else if (ATTACH_LEFT.has(symbol)) {
      // Dấu câu mở đầu chuỗi, ngay sau xuống dòng, hoặc lặp lại thì bỏ đi.
      const previous = out.slice(-1);
      if (
        !out ||
        out.endsWith(NEWLINE) ||
        (NO_REPEAT.has(previous) && NO_REPEAT.has(symbol))
      ) {
        continue;
      }
      out += symbol;
      pendingSpace = true;
    } else if (ATTACH_RIGHT.has(symbol)) {
      if (pendingSpace) {
        out += ' ';
      }
      out += symbol;
      pendingSpace = false;
    } else if (ATTACH_BOTH.has(symbol)) {
      out = out.replace(/[ \t]+$/, '');
      out += symbol;
      pendingSpace = false;
    }
  }

  return out;
}

/**
 * Viết hoa chữ cái đầu mỗi câu. Chỉ sửa từ `fromIndex` trở đi — phần chữ người
 * dùng đã tự gõ trước đó được giữ nguyên, nhưng vẫn dùng để biết đang giữa câu
 * hay đầu câu.
 */
function capitalize(text, fromIndex = 0) {
  let out = '';
  let atSentenceStart = true;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const isLetter = ch.toLowerCase() !== ch.toUpperCase();

    if (atSentenceStart && isLetter && i >= fromIndex) {
      out += ch.toUpperCase();
      atSentenceStart = false;
      continue;
    }

    out += ch;
    if (isLetter) {
      atSentenceStart = false;
    } else if (SENTENCE_END.has(ch)) {
      atSentenceStart = true;
    }
  }

  return out;
}

/**
 * Chuẩn hoá một đoạn vừa đọc: đổi từ đọc thành dấu câu, dọn khoảng trắng, viết
 * hoa đầu câu. Trả về '' nếu đầu vào rỗng.
 */
export function normalizeDictation(text) {
  if (!text) {
    return '';
  }
  return capitalize(join(tokenize(text))).trim();
}

/**
 * Nối đoạn vừa đọc vào phần chữ đã có. Đoạn mới được ghép trong ngữ cảnh của
 * phần cũ: giữa câu thì viết thường nối tiếp, sau dấu chấm thì viết hoa, và
 * đọc mỗi "chấm" cũng chốt được câu đang dở.
 */
export function appendDictation(existing, spoken) {
  // Chỉ cắt khoảng trắng ngang: xuống dòng người dùng đã gõ phải được giữ.
  const base = (existing || '').replace(/[ \t]+$/, '');
  if (!spoken) {
    return base;
  }

  const merged = join(tokenize(spoken), base);
  return capitalize(merged, base.length).replace(/[ \t]+$/, '');
}
