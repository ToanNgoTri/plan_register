# PlanRegister — Đăng ký kế hoạch công tác hằng ngày

App React Native (bare CLI) + Firebase để nhân viên đăng ký kế hoạch công tác
hằng ngày, quản lý (boss) theo dõi và duyệt tài khoản.

## Tính năng

- **Đăng nhập Google** (Firebase Auth). Không cần đăng nhập lại nếu chưa đăng xuất.
- **Duyệt tài khoản mới**: user mới đăng ký ở trạng thái *chờ duyệt*, chỉ thấy màn
  hình "Tài khoản chưa được duyệt" và **không dùng được chức năng nào** cho đến khi
  boss duyệt. Boss có màn hình **Duyệt** riêng.
- **Đăng ký kế hoạch** (staff): nhập **họ và tên** (tự nhập, không lấy từ Google) và
  nội dung công việc trong ngày; ngay bên dưới xem được **kế hoạch hôm nay của mọi
  người** (realtime). Chỉ ngày hôm nay — không xem được của người khác ở màn Lịch sử.
  Họ tên nhập ở đây (`users/{uid}.fullName`) là tên hiển thị chính trong bảng theo dõi
  và thông báo.
- **Nhắc lúc 08:00** (local notification) các ngày trong tuần (bỏ T7/CN) cho staff
  chưa đăng ký. Boss không nhận nhắc và không cần đăng ký.
- **Báo cho boss** khi có người đăng ký: app boss lắng nghe Firestore theo thời gian
  thực và bật local notification (xem *Giới hạn* bên dưới).
- **Lịch sử**: boss xem bảng tất cả staff theo từng ngày (ai **chưa đăng ký** hiện
  **đỏ**); staff chỉ xem lịch sử của **chính mình** (không thấy người khác — được
  đảm bảo bằng security rules, không chỉ ở UI).
- **Quản lý người dùng** (boss): duyệt tài khoản, **ngừng hoạt động** (khi user
  chuyển chỗ khác — khóa chức năng + ẩn khỏi bảng, giữ lịch sử), **kích hoạt lại**,
  và **xóa** hẳn.
- **Phân quyền** bằng field `role` (`boss` | `staff`) trong Firestore.
- **(Tùy chọn) Cloud Functions**: nhắc 08:00 và báo boss chạy **cả khi app đóng**
  (xem `functions/`).

## Cấu trúc mã nguồn

```
src/
  config/constants.ts        # WEB_CLIENT_ID, giờ nhắc, channel id  ← CẦN SỬA
  types/index.ts             # UserProfile, PlanEntry, ...
  utils/date.ts              # khóa ngày theo giờ máy, kiểm tra cuối tuần
  services/
    firebase.ts              # handle auth/firestore/messaging
    authService.ts           # Google Sign-In ↔ Firebase credential
    userService.ts           # users collection: tạo/duyệt/nghe hồ sơ
    planService.ts           # history: đăng ký + truy vấn theo ngày/người
    notificationService.ts   # notifee: lịch nhắc 08:00 + báo boss
  context/AuthContext.tsx    # trạng thái auth + hồ sơ + duyệt + role
  navigation/RootNavigator.tsx
  screens/                   # Login, PendingApproval, Inactive, RegisterPlan,
                             # Dashboard(boss), History, ManageUsers(boss)
  components/                # DailyStatusTable (bảng báo đỏ), BossAlertListener
firestore.rules              # luật bảo mật
firestore.indexes.json       # index cho collectionGroup 'entries'
firebase.json                # cấu hình Firestore + Functions
functions/                   # Cloud Functions (tùy chọn, cần gói Blaze)
```

## Mô hình dữ liệu Firestore

**Collection `users`** — `users/{uid}`:
```
{ uid, email, displayName, photoURL, unit, role: 'boss'|'staff',
  approved: boolean, active: boolean, createdAt: number, fcmToken }
```
- `approved`: đã được boss duyệt chưa.
- `active`: còn hoạt động không (boss có thể vô hiệu hóa khi user chuyển chỗ).
  Chỉ user `approved == true && active == true` mới dùng được app và mới xuất
  hiện trong bảng theo dõi / nhận nhắc.

**Lịch sử kế hoạch** — lồng theo năm → tháng → ngày → user (tên collection cố
định để Cloud Functions trigger được):
```
history/{YYYY}/months/{MM}/days/{DD}/entries/{uid}
  → { uid, displayName, unit, date: 'YYYY-MM-DD', content, createdAt, updatedAt }
```
Trường `uid` và `date` được lặp trong mỗi entry để phục vụ truy vấn
`collectionGroup('entries')` (lịch sử của một người).

---

## Cài đặt Firebase (BẮT BUỘC trước khi chạy)

App dùng `@react-native-firebase/*` nên khởi tạo Firebase **từ file cấu hình native**,
không phải từ JS.

### 1. Tạo project Firebase
- Vào <https://console.firebase.google.com> → tạo project.
- **Authentication** → Sign-in method → bật **Google**.
- **Firestore Database** → tạo database (production mode).

### 2. Android
1. Trong project Firebase → thêm app Android với **package name**: `com.planregister`.
2. Tải **`google-services.json`** đặt vào `android/app/google-services.json`.
3. Lấy SHA-1 (và SHA-256) của keystore debug rồi thêm vào app Android trong Firebase
   (cần cho Google Sign-In):
   ```bash
   cd android && ./gradlew signingReport
   ```
   Copy dòng `SHA1` / `SHA-256` của variant `debug` → Firebase Console → Project
   settings → app Android → *Add fingerprint*. Tải lại `google-services.json` sau khi
   thêm.

### 3. iOS (cần macOS + Xcode)
1. Thêm app iOS với **Bundle ID** trùng của project (nên đổi sang `com.planregister`
   trong Xcode để đồng bộ).
2. Tải **`GoogleService-Info.plist`** đặt vào `ios/PlanRegister/GoogleService-Info.plist`
   và kéo vào project trong Xcode (Copy if needed).
3. Mở `GoogleService-Info.plist`, copy giá trị **`REVERSED_CLIENT_ID`** và thêm vào
   `ios/PlanRegister/Info.plist` làm URL scheme (cho Google Sign-In):
   ```xml
   <key>CFBundleURLTypes</key>
   <array>
     <dict>
       <key>CFBundleURLSchemes</key>
       <array>
         <string>YOUR_REVERSED_CLIENT_ID</string>
       </array>
     </dict>
   </array>
   ```
4. Cài pod:
   ```bash
   cd ios && bundle install && bundle exec pod install
   ```

### 4. Web client ID (Google Sign-In)
Mở `src/config/constants.ts` và thay `WEB_CLIENT_ID` bằng **Web client ID**:
Firebase Console → Authentication → Sign-in method → Google → *Web SDK configuration*
→ **Web client ID** (cũng là `client_type: 3` trong `google-services.json`).

> **Vì sao cần `WEB_CLIENT_ID` và `SHA-1`?** (bắt buộc để login Google chạy)
> - `WEB_CLIENT_ID`: Google trả về *ID token* khi đăng nhập; Firebase chỉ chấp nhận
>   token cấp cho đúng Web client của project. Thiếu/sai → Firebase từ chối token →
>   login thất bại. Cần cho **cả Android và iOS**.
> - `SHA-1`: Google đối chiếu chữ ký app + package name với danh sách đã đăng ký để
>   chống giả mạo. Chưa khai báo → Android lỗi `DEVELOPER_ERROR` (code 10). Chỉ cần
>   cho **Android** (iOS dùng Bundle ID + REVERSED_CLIENT_ID). Bản debug / release /
>   Play Store có SHA-1 khác nhau — khai báo đủ.

### 5. Deploy Firestore rules + index
Dùng Firebase CLI (`npm i -g firebase-tools`, `firebase login`, `firebase init` chọn
Firestore và trỏ tới `firestore.rules` / `firestore.indexes.json`), rồi:
```bash
firebase deploy --only firestore:rules,firestore:indexes
```
(Hoặc dán rules trong tab Rules và tạo composite index khi Firestore báo link.)

### 6. Chỉ định boss
Boss được set **thủ công**. Sau khi boss đăng nhập lần đầu (doc `users/{uid}` được
tạo), vào Firestore Console sửa doc đó:
```
role: "boss"
approved: true
active: true
```
Từ đó tài khoản này có màn hình Tổng quan + Người dùng và không phải đăng ký.

---

## Chạy app

```bash
npm install            # đã cài sẵn nếu bạn nhận project này
npm start              # Metro bundler

# Terminal khác:
npm run android        # cần Android SDK + máy ảo/thiết bị
npm run ios            # chỉ trên macOS
```

---

## Cloud Functions (tùy chọn — để noti chạy cả khi app đóng)

Mặc định app dùng **local notification** (không cần server): nhắc 08:00 đặt lịch sẵn
trên máy, và báo boss qua listener Firestore. Hạn chế: chỉ chắc chắn khi app còn mở.

Thư mục `functions/` bổ sung 3 function chạy trên server (cần **gói Blaze**):

| Function | Loại | Việc |
|---|---|---|
| `dailyReminder` | Scheduled `0 8 * * 1-5` (giờ VN) | Gửi FCM cho staff `approved && active` chưa đăng ký hôm nay |
| `onPlanRegistered` | Firestore `onCreate` tại `history/{y}/months/{m}/days/{d}/entries/{uid}` | Gửi FCM cho tất cả boss |
| `deleteUserAccount` | Callable (chỉ boss) | Xóa hẳn tài khoản Auth + hồ sơ Firestore |

Deploy:
```bash
cd functions && npm install
firebase deploy --only functions
```
Khi đã bật Functions, local notification đóng vai trò dự phòng. `fcmToken` được app tự
lưu trong `users/{uid}` để function gửi push.

> Xóa user trong app hiện **xóa hồ sơ Firestore** (thu hồi quyền ngay, giữ lịch sử).
> Muốn xóa luôn tài khoản Google Auth thì gọi `deleteUserAccount` (cần thêm
> `@react-native-firebase/functions` ở client) hoặc xóa trong Firebase Console.

---

## Bắt buộc cập nhật (force update)

`ForceUpdateGate` (ở `App.tsx`) phủ **modal chặn cứng, không tắt được** lên toàn app khi
cần cập nhật. Có 2 nguồn kích hoạt (chặn nếu **một trong hai** báo cần update):

1. **minVersion từ Firestore** — document `config/app`:
   ```
   config/app = {
     minVersion:    "1.3.0",     // < phiên bản này thì bị buộc cập nhật
     latestVersion: "1.3.0",     // (tùy chọn) hiển thị
     updateUrl:     "https://…", // (tùy chọn) ghi đè chung, vd link APK nội bộ
     updateUrlIos:     "https://…", // (tùy chọn) ghi đè riêng iOS
     updateUrlAndroid: "https://…", // (tùy chọn) ghi đè riêng Android
     message:       "…"          // (tùy chọn) nội dung tùy biến
   }
   ```
   Đây là cách **đáng tin cậy cho bản phát hành nội bộ** (không lên store): chỉ cần sửa
   `minVersion` trên Console → máy bản cũ bị chặn ngay lần mở app kế tiếp (đọc realtime).
   Rules cho phép **đọc công khai** `config/*` (gate chạy trước cả khi đăng nhập).

2. **Dò store** (`react-native-version-check`) — tự phát hiện bản mới trên Play Store /
   App Store khi app đã publish.

App version lấy từ `versionName` (Android) / `CFBundleShortVersionString` (iOS). Tăng số
này mỗi lần build bản mới.

Link nút **"Cập nhật ngay"** (`versionService.resolveUpdateUrl`) chọn theo nền tảng đang
chạy, ưu tiên từ trên xuống:

1. `config.updateUrlIos` / `config.updateUrlAndroid` — ghi đè riêng từng nền tảng.
2. `config.updateUrl` — ghi đè chung (vd link APK nội bộ).
3. Link store gắn sẵn trong `src/config/constants.js`:
   - iOS — <https://apps.apple.com/app/id6792317913>
   - Android — <https://play.google.com/store/apps/details?id=com.planregister>
4. Link store do `react-native-version-check` tự dò.

> Test nhanh khi chưa lên store: tạo `config/app` với `minVersion` cao hơn version hiện
> tại (vd `"9.9.9"`) → gate hiện ngay.

## Giới hạn cần biết (khi chưa dùng Cloud Functions)

- **Nhắc 08:00** đặt lịch sẵn ~10 ngày làm việc tới, làm mới mỗi lần mở app. Nếu không
  mở app quá lâu hàng đợi cạn; tắt máy/tắt thông báo có thể lỡ.
- **Báo cho boss** chỉ chạy khi app boss đang mở (nền/nổi). Tắt hẳn app sẽ không nhận.
- Staff nhập **đơn vị** ở màn hình chờ duyệt. Có thể mở rộng cho sửa sau khi được duyệt.
