#import <AppSpecs/AppSpecs.h>

NS_ASSUME_NONNULL_BEGIN

/** Tên thông báo AppDelegate bắn ra khi nhận được tệp từ ứng dụng khác. */
extern NSString *const PRSharedFileReceivedNotification;
/** Khoá NSUserDefaults giữ tệp đang chờ JS lấy. */
extern NSString *const PRSharedFilePendingKey;

/**
 * Nhận tệp "chuyển lịch" do ứng dụng khác gửi sang (Zalo: "Mở bằng ứng dụng
 * khác" / "Chia sẻ" → ĐƠN VỊ SỐ) để đăng làm lịch trực.
 *
 * iOS đưa tệp vào qua AppDelegate chứ không qua module, và ở lần mở nguội thì
 * AppDelegate chạy trước cả khi JS tồn tại. Nên AppDelegate chép tệp ra
 * Caches/shared-in rồi ghi thông tin vào NSUserDefaults; module chỉ việc lấy ra
 * (và xoá đi) khi JS hỏi — cùng một đường dẫn cho cả mở nguội lẫn đang chạy,
 * và tệp tới lúc chưa đăng nhập vẫn nằm chờ đến khi JS hỏi.
 */
@interface SharedFile : NativeSharedFileSpecBase <NativeSharedFileSpec>
@end

NS_ASSUME_NONNULL_END
