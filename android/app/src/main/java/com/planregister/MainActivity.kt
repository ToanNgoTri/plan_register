package com.planregister

import android.content.Intent
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.swmansion.rnscreens.fragment.restoration.RNScreensFragmentFactory

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "PlanRegister"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  /**
   * Bắt buộc theo hướng dẫn của react-native-screens.
   *
   * Khi lâu không mở app, Android kill process để lấy lại RAM nhưng vẫn giữ
   * savedInstanceState của Activity. Lúc mở lại, FragmentManager khôi phục các
   * fragment cũ của react-native-screens trong khi cây JS chưa tồn tại -> crash
   * native ngay lúc khởi động. RNScreensFragmentFactory gỡ bỏ các fragment mồ
   * côi đó thay vì dựng lại sai.
   */
  override fun onCreate(savedInstanceState: Bundle?) {
    supportFragmentManager.fragmentFactory = RNScreensFragmentFactory()
    super.onCreate(savedInstanceState)
  }

  /**
   * Activity chạy `singleTask`: tệp chia sẻ từ Zalo lúc app đang mở rơi vào
   * đây chứ không tạo Activity mới. Phải tự giữ intent mới làm intent hiện
   * hành — module SharedFile chỉ được tạo khi JS dùng tới (sau khi đăng nhập),
   * nên tệp gửi tới lúc còn ở màn hình đăng nhập sẽ mất nếu trông vào module.
   */
  override fun onNewIntent(intent: Intent) {
    setIntent(intent)
    super.onNewIntent(intent)
  }
}
