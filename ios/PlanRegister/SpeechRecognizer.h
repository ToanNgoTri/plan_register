#import <AppSpecs/AppSpecs.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Đọc chính tả bằng SFSpeechRecognizer.
 *
 * Ngôn ngữ lấy từ tham số JS chứ không theo Locale của máy, và bật
 * addsPunctuation (iOS 16+) để hệ điều hành tự chấm câu — đây là lớp 1.
 * SFSpeechRecognitionTask tự kết thúc sau khoảng một phút, nên mỗi lần kết thúc
 * được coi là chốt một đoạn rồi mở phiên mới, người dùng nói bao lâu cũng được.
 */
@interface SpeechRecognizer : NativeSpeechRecognizerSpecBase <NativeSpeechRecognizerSpec>
@end

NS_ASSUME_NONNULL_END
