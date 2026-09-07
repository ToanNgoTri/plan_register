import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';
import type { EventEmitter } from 'react-native/Libraries/Types/CodegenTypes';

export type StartOptions = {
  /** Thẻ ngôn ngữ IETF, ví dụ 'vi-VN'. */
  locale: string;
  /**
   * Nhờ hệ điều hành tự chấm câu và viết hoa (lớp 1). iOS dùng
   * SFSpeechAudioBufferRecognitionRequest.addsPunctuation, Android dùng
   * RecognizerIntent.EXTRA_ENABLE_FORMATTING. Máy không hỗ trợ thì bỏ qua.
   */
  punctuate: boolean;
};

export interface Spec extends TurboModule {
  /** Máy có bộ nhận dạng giọng nói dùng được không. */
  isAvailable(): Promise<boolean>;
  /**
   * Bắt đầu nghe. Trả về true nếu quyền micro/nhận dạng đã được cấp và phiên
   * nghe đã khởi động; false nếu người dùng từ chối quyền.
   */
  start(options: StartOptions): Promise<boolean>;
  /** Dừng nghe nhưng vẫn lấy kết quả cuối của đoạn đang nói. */
  stop(): Promise<void>;
  /** Huỷ hẳn, bỏ luôn đoạn đang nói. */
  cancel(): Promise<void>;

  /** Micro đã sẵn sàng, người dùng có thể nói. */
  readonly onSpeechStart: EventEmitter<void>;
  /** Chữ đang bay — bắn rất dày, phía JS phải tự throttle. */
  readonly onSpeechPartial: EventEmitter<string>;
  /** Chữ đã chốt của một đoạn. Một phiên nghe dài có thể chốt nhiều lần. */
  readonly onSpeechFinal: EventEmitter<string>;
  /** Độ lớn âm thanh đã chuẩn hoá về 0..1, dùng vẽ thanh mức. */
  readonly onSpeechVolume: EventEmitter<number>;
  /** Phiên nghe đã kết thúc hẳn (do stop, cancel, hoặc lỗi). */
  readonly onSpeechEnd: EventEmitter<void>;
  /** Lỗi làm phiên nghe dừng lại. */
  readonly onSpeechError: EventEmitter<string>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('SpeechRecognizer');
