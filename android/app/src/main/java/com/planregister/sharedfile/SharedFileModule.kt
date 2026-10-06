package com.planregister.sharedfile

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import com.facebook.fbreact.specs.NativeSharedFileSpec
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import java.io.File
import java.text.Normalizer
import java.util.concurrent.Executors

/**
 * Nhận tệp do ứng dụng khác gửi sang (Zalo: "Chia sẻ" hoặc "Mở bằng") để đăng
 * làm lịch trực.
 *
 * Hai việc phải làm mà gọi Intent trần không có:
 *
 * 1. Zalo đưa sang một `content://` tạm, chỉ đọc được trong lúc quyền URI còn
 *    hiệu lực. Vì vậy tệp được chép ngay vào cache của app rồi mới trả đường dẫn
 *    thật cho JS — trả thẳng `content://` thì lát sau đọc lại là mất quyền, và
 *    putFile của Firebase Storage cũng cần một tệp thật.
 * 2. MainActivity chạy `singleTask`, nên lần chia sẻ thứ hai trở đi không tạo
 *    Activity mới mà rơi vào `onNewIntent`. Mỗi intent được đánh dấu đã nhận
 *    (`EXTRA_CONSUMED`) để mở lại app không hiện lại tệp cũ thêm lần nữa.
 */
@ReactModule(name = SharedFileModule.NAME)
class SharedFileModule(reactContext: ReactApplicationContext) :
  NativeSharedFileSpec(reactContext), ActivityEventListener {

  /** Chép tệp có thể mất vài trăm ms với tệp lớn — không làm trên luồng UI. */
  private val io = Executors.newSingleThreadExecutor()

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun getName(): String = NAME

  override fun invalidate() {
    reactApplicationContext.removeActivityEventListener(this)
    io.shutdown()
    super.invalidate()
  }

  override fun takePendingFile(promise: Promise) {
    val intent = reactApplicationContext.currentActivity?.intent
    if (intent == null || !hasUnconsumedFile(intent)) {
      promise.resolve(null)
      return
    }
    intent.putExtra(EXTRA_CONSUMED, true)
    val uri = fileUriOf(intent)
    if (uri == null) {
      promise.resolve(null)
      return
    }
    val type = intent.type
    io.execute {
      try {
        promise.resolve(copyToCache(uri, type))
      } catch (e: Exception) {
        promise.reject("READ_FAILED", e.message ?: "Không đọc được tệp chia sẻ", e)
      }
    }
  }

  override fun onNewIntent(intent: Intent) {
    if (!hasUnconsumedFile(intent)) {
      return
    }
    // MainActivity.onNewIntent đã ghi nhận đây là intent hiện hành; chỉ cần báo
    // cho JS. Việc chép tệp để `takePendingFile` làm, tránh hai đường dẫn cùng
    // xử lý một tệp.
    emitOnFileShared()
  }

  override fun onActivityResult(
    activity: Activity,
    requestCode: Int,
    resultCode: Int,
    data: Intent?,
  ) = Unit

  private fun hasUnconsumedFile(intent: Intent): Boolean =
    !intent.getBooleanExtra(EXTRA_CONSUMED, false) && fileUriOf(intent) != null

  /**
   * Tệp đính trong intent, bất kể app gửi dùng kiểu nào: "Chia sẻ" gửi
   * ACTION_SEND kèm EXTRA_STREAM, còn "Mở bằng" gửi ACTION_VIEW với URI nằm ở
   * `data`.
   */
  @Suppress("DEPRECATION")
  private fun fileUriOf(intent: Intent): Uri? =
    when (intent.action) {
      Intent.ACTION_SEND ->
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
          intent.getParcelableExtra(Intent.EXTRA_STREAM)
        }
      Intent.ACTION_VIEW -> intent.data
      else -> null
    }

  /**
   * Chép tệp vào `cache/shared-in/`. Thư mục được dọn sạch trước mỗi lần chép để
   * không tích tệp rác — tệp chỉ cần sống đến lúc đăng lên Storage xong.
   */
  private fun copyToCache(uri: Uri, fallbackMime: String?): WritableMap {
    val resolver = reactApplicationContext.contentResolver
    var name = ""
    var size = 0L
    resolver.query(uri, null, null, null, null)?.use { cursor ->
      if (cursor.moveToFirst()) {
        val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (nameIndex >= 0 && !cursor.isNull(nameIndex)) {
          name = cursor.getString(nameIndex)
        }
        val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
        if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) {
          size = cursor.getLong(sizeIndex)
        }
      }
    }
    if (name.isBlank()) {
      name = uri.lastPathSegment ?: "lich-truc"
    }
    val mimeType = resolver.getType(uri) ?: fallbackMime.orEmpty()

    val dir = File(reactApplicationContext.cacheDir, "shared-in")
    dir.listFiles()?.forEach { it.delete() }
    dir.mkdirs()
    val target = File(dir, safeFileName(name))
    val input =
      resolver.openInputStream(uri) ?: throw IllegalStateException("Không mở được tệp chia sẻ")
    input.use { source -> target.outputStream().use { output -> source.copyTo(output) } }

    return Arguments.createMap().apply {
      putString("path", target.absolutePath)
      putString("name", name)
      putString("mimeType", mimeType)
      putDouble("size", (if (size > 0) size else target.length()).toDouble())
    }
  }

  /** Bỏ dấu tiếng Việt và ký tự lạ để tên tệp an toàn trên mọi hệ tệp. */
  private fun safeFileName(name: String): String {
    val cleaned =
      Normalizer.normalize(name.trim(), Normalizer.Form.NFD)
        .replace(Regex("\\p{M}+"), "")
        .replace("đ", "d")
        .replace("Đ", "D")
        .replace(Regex("[^A-Za-z0-9._-]+"), "-")
        .trim('-')
    return if (cleaned.isBlank()) "lich-truc" else cleaned.takeLast(80)
  }

  companion object {
    const val NAME = "SharedFile"

    /** Đánh dấu intent đã được đọc, tránh nhận lại cùng một tệp nhiều lần. */
    private const val EXTRA_CONSUMED = "com.planregister.sharedfile.CONSUMED"
  }
}
