/**
 * Date helpers. All "day keys" are in the device's local timezone so that a
 * registration made on a given calendar day is filed under that same day.
 */

function pad(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

/** e.g. { year: '2026', month: '07', day: '16' } */
export function dateParts(d = new Date()) {
  return {
    year: `${d.getFullYear()}`,
    month: pad(d.getMonth() + 1),
    day: pad(d.getDate()),
  };
}

/** ISO-ish local date string, e.g. "2026-07-16". */
export function toDateKey(d = new Date()) {
  const { year, month, day } = dateParts(d);
  return `${year}-${month}-${day}`;
}

/** True for Saturday (6) and Sunday (0). */
export function isWeekend(d = new Date()) {
  const day = d.getDay();
  return day === 0 || day === 6;
}

/** Human friendly, e.g. "Thứ Năm, 16/07/2026". */
export function formatDateVi(d = new Date()) {
  const weekdays = [
    'Chủ Nhật',
    'Thứ Hai',
    'Thứ Ba',
    'Thứ Tư',
    'Thứ Năm',
    'Thứ Sáu',
    'Thứ Bảy',
  ];
  const { year, month, day } = dateParts(d);
  return `${weekdays[d.getDay()]}, ${day}/${month}/${year}`;
}

/** Ngày giờ ngắn gọn, ví dụ "16/07/2026 14:30". Nhận Date hoặc timestamp ms. */
export function formatDateTimeVi(value) {
  const d = value instanceof Date ? value : new Date(value);
  const { year, month, day } = dateParts(d);
  return `${day}/${month}/${year} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parse a "YYYY-MM-DD" key back into a Date (local midnight). */
export function fromDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
