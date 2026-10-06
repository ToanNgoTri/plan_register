import { useEffect } from 'react';
import { Alert, AppState } from 'react-native';
import {
  addFileSharedListener,
  setIncomingDutyFile,
  takePendingFile,
} from '../services/sharedFileService';
import { sharedFileToUpload } from '../services/dutyService';
import { navigationRef } from '../navigation/navigationRef';

/**
 * Nhận tệp "chuyển lịch" người dùng chia sẻ từ Zalo, bất kể app đang ở màn
 * hình nào, rồi chuyển sang tab Lịch trực để mở sẵn bảng đăng.
 *
 * Chỉ được dựng bên trong các bộ tab — tức là khi đã đăng nhập VÀ được phép
 * dùng app. Tệp tới lúc chưa đăng nhập vẫn nằm chờ ở phía native (chưa ai gọi
 * `takePendingFile`), đăng nhập xong mới được nhận.
 *
 * Có ba đường tệp đi vào, nên phải bắt cả ba:
 *  - App mở từ đầu bằng chính tệp đó  -> hỏi native ngay lúc gắn.
 *  - App đang chạy, người dùng chia sẻ thêm  -> sự kiện `onFileShared`.
 *  - App bị treo ở nền lúc tệp tới  -> kiểm tra lại mỗi khi quay ra tiền cảnh.
 * Native chỉ trả mỗi tệp đúng một lần, nên trùng nhau cũng không nhận hai lần.
 */
export default function IncomingDutyFileListener() {
  useEffect(() => {
    let alive = true;
    let busy = false;
    let navTimer = null;

    // Lúc mở nguội, listener này có thể chạy trước khi navigator con kịp gắn
    // vào container, nên thử lại vài lần thay vì điều hướng hụt.
    const goToDuty = (attempt = 0) => {
      if (!alive) {
        return;
      }
      if (navigationRef.isReady()) {
        navigationRef.navigate('Duty');
      } else if (attempt < 20) {
        navTimer = setTimeout(() => goToDuty(attempt + 1), 250);
      }
    };

    const importPending = async () => {
      if (busy) {
        return;
      }
      busy = true;
      try {
        const file = await takePendingFile();
        if (file && alive) {
          setIncomingDutyFile(sharedFileToUpload(file));
          goToDuty();
        }
      } catch (e) {
        Alert.alert('Không nhận được tệp', e?.message ?? 'Vui lòng thử lại.');
      } finally {
        busy = false;
      }
    };

    importPending();
    const removeListener = addFileSharedListener(importPending);
    const appStateSub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        importPending();
      }
    });

    return () => {
      alive = false;
      clearTimeout(navTimer);
      removeListener();
      appStateSub.remove();
    };
  }, []);

  return null;
}
