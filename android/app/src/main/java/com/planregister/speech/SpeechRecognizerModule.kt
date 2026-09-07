package com.planregister.speech

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.content.ContextCompat
import com.facebook.fbreact.specs.NativeSpeechRecognizerSpec
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.module.annotations.ReactModule

/**
 * Đọc chính tả bằng bộ nhận dạng giọng nói của Android.
 *
 * Ba điểm khác với việc gọi SpeechRecognizer trần:
 *
 * 1. Ngôn ngữ do JS truyền vào và được đặt lại ở mỗi lần bắt đầu nghe, không lấy
 *    theo Locale của máy — máy để tiếng Anh vẫn phải đọc được tiếng Việt.
 * 2. Bật EXTRA_ENABLE_FORMATTING (API 33+) để Google tự chấm câu và viết hoa.
 * 3. SpeechRecognizer tự ngắt sau khoảng hai giây im lặng. Ở đây mỗi lần ngắt
 *    được coi là chốt một đoạn rồi tự nghe tiếp, nên người dùng nói bao lâu cũng
 *    được cho tới khi bấm dừng.
 */
@ReactModule(name = SpeechRecognizerModule.NAME)
class SpeechRecognizerModule(reactContext: ReactApplicationContext) :
  NativeSpeechRecognizerSpec(reactContext) {

  private val mainHandler = Handler(Looper.getMainLooper())

  private var recognizer: SpeechRecognizer? = null
  private var intent: Intent? = null

  /** Người dùng vẫn đang giữ mic — hết đoạn thì nghe tiếp. */
  private var listening = false

  /**
   * Số lần khởi động lại liên tiếp mà không nghe được chữ nào. Dùng để không rơi
   * vào vòng lặp nghe–lỗi–nghe khi bộ nhận dạng hỏng.
   */
  private var emptyRestarts = 0

  override fun getName(): String = NAME

  override fun isAvailable(promise: Promise) {
    mainHandler.post {
      promise.resolve(SpeechRecognizer.isRecognitionAvailable(reactApplicationContext))
    }
  }

  override fun start(options: ReadableMap, promise: Promise) {
    val locale = if (options.hasKey("locale")) options.getString("locale") else null
    val punctuate = !options.hasKey("punctuate") || options.getBoolean("punctuate")

    if (ContextCompat.checkSelfPermission(
        reactApplicationContext,
        Manifest.permission.RECORD_AUDIO,
      ) != PackageManager.PERMISSION_GRANTED
    ) {
      promise.resolve(false)
      return
    }

    mainHandler.post {
      if (!SpeechRecognizer.isRecognitionAvailable(reactApplicationContext)) {
        promise.reject("NOT_AVAILABLE", "Máy không có bộ nhận dạng giọng nói")
        return@post
      }
      if (listening) {
        promise.resolve(true)
        return@post
      }

      try {
        buildRecognizer(locale ?: DEFAULT_LOCALE, punctuate)
        listening = true
        emptyRestarts = 0
        recognizer?.startListening(intent)
        promise.resolve(true)
      } catch (e: Exception) {
        listening = false
        teardown()
        promise.reject("START_FAILED", e.message, e)
      }
    }
  }

  override fun stop(promise: Promise) {
    mainHandler.post {
      // Đặt cờ trước khi gọi stopListening: kết quả cuối vẫn về qua onResults,
      // nhưng onResults sẽ không khởi động lại phiên nghe nữa.
      listening = false
      try {
        recognizer?.stopListening()
      } catch (_: Exception) {
        // Bộ nhận dạng đã chết thì coi như dừng rồi.
      }
      promise.resolve(null)
    }
  }

  override fun cancel(promise: Promise) {
    mainHandler.post {
      listening = false
      try {
        recognizer?.cancel()
      } catch (_: Exception) {
      }
      teardown()
      emitOnSpeechEnd()
      promise.resolve(null)
    }
  }

  override fun invalidate() {
    mainHandler.post {
      listening = false
      teardown()
    }
    super.invalidate()
  }

  /** Dựng lại recognizer và intent. Bắt buộc chạy trên main thread. */
  private fun buildRecognizer(locale: String, punctuate: Boolean) {
    teardown()

    recognizer = SpeechRecognizer.createSpeechRecognizer(reactApplicationContext).apply {
      setRecognitionListener(listener)
    }

    intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
      // EXTRA_LANGUAGE nhận thẻ IETF dạng chuỗi ("vi-VN"), không nhận Locale.
      putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, locale)
      putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, reactApplicationContext.packageName)
      if (punctuate && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        putExtra(
          RecognizerIntent.EXTRA_ENABLE_FORMATTING,
          RecognizerIntent.FORMATTING_OPTIMIZE_QUALITY,
        )
      }
    }
  }

  private fun teardown() {
    try {
      recognizer?.destroy()
    } catch (_: Exception) {
    }
    recognizer = null
    intent = null
  }

  /**
   * Nghe tiếp đoạn sau. Android không cho gọi startListening ngay trong callback
   * kết thúc phiên trước, nên đẩy qua một vòng của main looper.
   */
  private fun restart() {
    if (!listening) {
      return
    }
    if (emptyRestarts >= MAX_EMPTY_RESTARTS) {
      listening = false
      teardown()
      emitOnSpeechError("Không nghe được gì, đã dừng")
      emitOnSpeechEnd()
      return
    }
    mainHandler.postDelayed(
      {
        if (listening) {
          try {
            recognizer?.startListening(intent)
          } catch (e: Exception) {
            listening = false
            teardown()
            emitOnSpeechError(e.message ?: "Không nghe tiếp được")
            emitOnSpeechEnd()
          }
        }
      },
      RESTART_DELAY_MS,
    )
  }

  private val listener = object : RecognitionListener {
    override fun onReadyForSpeech(params: Bundle?) {
      emitOnSpeechStart()
    }

    override fun onBeginningOfSpeech() {
      emptyRestarts = 0
    }

    override fun onRmsChanged(rmsdB: Float) {
      // rmsdB chạy khoảng -2..10 dB; ép về 0..1 cho JS vẽ thanh mức.
      val level = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f)
      emitOnSpeechVolume(level.toDouble())
    }

    override fun onBufferReceived(buffer: ByteArray?) {}

    override fun onEndOfSpeech() {}

    override fun onError(error: Int) {
      // Hai lỗi này chỉ có nghĩa "đoạn vừa rồi không có tiếng"; người dùng còn
      // giữ mic thì nghe tiếp chứ không báo lỗi ra màn hình.
      if (error == SpeechRecognizer.ERROR_NO_MATCH ||
        error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
      ) {
        emptyRestarts += 1
        restart()
        return
      }

      listening = false
      teardown()
      emitOnSpeechError(messageFor(error))
      emitOnSpeechEnd()
    }

    override fun onResults(results: Bundle?) {
      val text = firstMatch(results)
      if (!text.isNullOrBlank()) {
        emptyRestarts = 0
        emitOnSpeechFinal(text)
      } else {
        emptyRestarts += 1
      }

      if (listening) {
        restart()
      } else {
        teardown()
        emitOnSpeechEnd()
      }
    }

    override fun onPartialResults(partialResults: Bundle?) {
      val text = firstMatch(partialResults)
      if (!text.isNullOrBlank()) {
        emitOnSpeechPartial(text)
      }
    }

    override fun onEvent(eventType: Int, params: Bundle?) {}
  }

  private fun firstMatch(results: Bundle?): String? =
    results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()

  private fun messageFor(error: Int): String = when (error) {
    SpeechRecognizer.ERROR_NETWORK,
    SpeechRecognizer.ERROR_NETWORK_TIMEOUT,
    -> "Lỗi mạng khi nhận dạng giọng nói"
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Chưa được cấp quyền micro"
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Bộ nhận dạng đang bận"
    SpeechRecognizer.ERROR_AUDIO -> "Không thu được âm thanh"
    SpeechRecognizer.ERROR_SERVER -> "Máy chủ nhận dạng báo lỗi"
    SpeechRecognizer.ERROR_CLIENT -> "Bộ nhận dạng gặp lỗi"
    else -> "Lỗi nhận dạng giọng nói ($error)"
  }

  companion object {
    const val NAME = "SpeechRecognizer"
    private const val DEFAULT_LOCALE = "vi-VN"
    private const val RESTART_DELAY_MS = 120L
    private const val MAX_EMPTY_RESTARTS = 3
  }
}
