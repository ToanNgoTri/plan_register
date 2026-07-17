package com.planregister

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
    applyEdgeToEdgeFixForUCrop()
  }

  /**
   * The crop screen from react-native-image-crop-picker (uCrop 2.2.6-native)
   * predates Android 15/16 edge-to-edge enforcement and does not inset its own
   * toolbar, so on a device that renders edge-to-edge its top toolbar is drawn
   * *under* the status bar (and the bottom controls under the navigation bar).
   *
   * We cannot opt out via `android:windowOptOutEdgeToEdgeEnforcement`, because
   * that flag is ignored for apps targeting SDK 36 on Android 16 devices. Since
   * uCrop is a third-party activity we don't own, fix it globally here: when a
   * UCropActivity is created, pad its root content view by the system-bar insets
   * so the toolbar sits below the status bar and the bottom controls sit above
   * the navigation bar.
   */
  private fun applyEdgeToEdgeFixForUCrop() {
    registerActivityLifecycleCallbacks(
      object : ActivityLifecycleCallbacks {
        override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
          if (activity.javaClass.name != "com.yalantis.ucrop.UCropActivity") {
            return
          }
          val content = activity.findViewById<View>(android.R.id.content) ?: return
          ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(view.paddingLeft, bars.top, view.paddingRight, bars.bottom)
            WindowInsetsCompat.CONSUMED
          }
          ViewCompat.requestApplyInsets(content)
        }

        override fun onActivityStarted(activity: Activity) {}

        override fun onActivityResumed(activity: Activity) {}

        override fun onActivityPaused(activity: Activity) {}

        override fun onActivityStopped(activity: Activity) {}

        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}

        override fun onActivityDestroyed(activity: Activity) {}
      }
    )
  }
}
