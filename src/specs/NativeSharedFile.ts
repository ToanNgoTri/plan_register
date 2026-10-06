import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';
import type { EventEmitter } from 'react-native/Libraries/Types/CodegenTypes';

/** Một tệp do ứng dụng khác (Zalo, Drive...) gửi sang app này. */
export type SharedFile = {
  /** Đường dẫn tệp thật đã được chép vào cache của app, KHÔNG có `file://`. */
  path: string;
  /** Tên gốc do bên gửi đặt, dùng để hiển thị và đặt tên trên Storage. */
  name: string;
  /** Kiểu MIME, ví dụ `image/jpeg`. Chuỗi rỗng nếu bên gửi không khai báo. */
  mimeType: string;
  /** Kích thước tệp theo byte; 0 nếu không đọc được. */
  size: number;
};

export interface Spec extends TurboModule {
  /**
   * Lấy tệp đang chờ xử lý (do app được mở bằng một tệp chia sẻ) và ĐÁNH DẤU
   * ĐÃ NHẬN, nên gọi lần thứ hai sẽ trả về null. Dùng cho trường hợp app khởi
   * động từ đầu — lúc đó chưa có listener nào của `onFileShared` kịp gắn.
   */
  takePendingFile(): Promise<SharedFile | null>;

  /**
   * App đang chạy và người dùng vừa chia sẻ thêm một tệp sang. Sự kiện chỉ báo
   * "có tệp mới", nội dung lấy bằng `takePendingFile()` — để đúng một đường dẫn
   * duy nhất lo việc chép tệp, dù app mới mở hay đang chạy sẵn.
   */
  readonly onFileShared: EventEmitter<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('SharedFile');
