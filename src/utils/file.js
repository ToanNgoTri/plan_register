/** Kích thước tệp dễ đọc, ví dụ "1,4 MB". Trả về '' nếu không biết cỡ tệp. */
export function formatBytes(bytes) {
  if (!bytes || bytes < 0) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${Math.round(kb)} KB`;
  }
  return `${(kb / 1024).toFixed(1).replace('.', ',')} MB`;
}
