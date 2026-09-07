#import "SpeechRecognizer.h"

#import <AVFoundation/AVFoundation.h>
#import <Speech/Speech.h>

/** Cứ vài buffer mới bắn một sự kiện độ lớn — tap chạy ~43 lần/giây. */
static const NSInteger kVolumeEventEveryNBuffers = 5;
/** Số phiên liên tiếp không ra chữ nào thì coi như bộ nhận dạng hỏng. */
static const NSInteger kMaxEmptyTasks = 3;

@interface SpeechRecognizer ()
@property(nonatomic, strong, nullable) SFSpeechRecognizer *recognizer;
@property(nonatomic, strong, nullable) SFSpeechAudioBufferRecognitionRequest *request;
@property(nonatomic, strong, nullable) SFSpeechRecognitionTask *task;
@property(nonatomic, strong, nullable) AVAudioEngine *audioEngine;
/** Người dùng vẫn đang giữ mic — hết đoạn thì mở phiên mới. */
@property(nonatomic, assign) BOOL listening;
@property(nonatomic, assign) BOOL punctuate;
/** Chữ của đoạn hiện tại, dùng để chốt khi phiên kết thúc. */
@property(nonatomic, copy, nullable) NSString *segmentText;
@property(nonatomic, assign) NSInteger bufferCount;
@property(nonatomic, assign) NSInteger emptyTasks;
@end

@implementation SpeechRecognizer

RCT_EXPORT_MODULE()

#pragma mark - Spec

- (void)isAvailable:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  SFSpeechRecognizer *probe = [[SFSpeechRecognizer alloc] init];
  resolve(@(probe != nil));
}

- (void)start:(JS::NativeSpeechRecognizer::StartOptions &)options
      resolve:(RCTPromiseResolveBlock)resolve
       reject:(RCTPromiseRejectBlock)reject {
  NSString *locale = options.locale() ?: @"vi-VN";
  BOOL punctuate = options.punctuate();

  if (self.listening) {
    resolve(@YES);
    return;
  }

  SFSpeechRecognizer *recognizer =
      [[SFSpeechRecognizer alloc] initWithLocale:[NSLocale localeWithLocaleIdentifier:locale]];
  if (recognizer == nil) {
    reject(@"NOT_AVAILABLE", [NSString stringWithFormat:@"Máy không nhận dạng được %@", locale], nil);
    return;
  }

  self.recognizer = recognizer;
  self.punctuate = punctuate;

  // Cần cả hai quyền: nhận dạng giọng nói và thu âm.
  [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus status) {
    if (status != SFSpeechRecognizerAuthorizationStatusAuthorized) {
      dispatch_async(dispatch_get_main_queue(), ^{
        resolve(@NO);
      });
      return;
    }

    [[AVAudioSession sharedInstance] requestRecordPermission:^(BOOL granted) {
      dispatch_async(dispatch_get_main_queue(), ^{
        if (!granted) {
          resolve(@NO);
          return;
        }

        NSError *error = nil;
        if (![self startEngineWithError:&error]) {
          [self teardown];
          reject(@"START_FAILED", error.localizedDescription ?: @"Không mở được micro", error);
          return;
        }

        self.listening = YES;
        [self beginTask];
        [self emitOnSpeechStart];
        resolve(@YES);
      });
    }];
  }];
}

- (void)stop:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    // Đặt cờ trước khi endAudio: kết quả cuối vẫn về qua resultHandler, nhưng
    // resultHandler sẽ không mở phiên mới nữa.
    self.listening = NO;
    [self.request endAudio];
    resolve(nil);
  });
}

- (void)cancel:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    self.listening = NO;
    [self.task cancel];
    [self teardown];
    [self emitOnSpeechEnd];
    resolve(nil);
  });
}

- (void)invalidate {
  dispatch_async(dispatch_get_main_queue(), ^{
    self.listening = NO;
    [self.task cancel];
    [self teardown];
  });
}

#pragma mark - Thu âm

- (BOOL)startEngineWithError:(NSError **)error {
  AVAudioSession *session = [AVAudioSession sharedInstance];
  if (![session setCategory:AVAudioSessionCategoryRecord
                       mode:AVAudioSessionModeMeasurement
                    options:AVAudioSessionCategoryOptionDuckOthers
                      error:error]) {
    return NO;
  }
  if (![session setActive:YES
              withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation
                    error:error]) {
    return NO;
  }

  self.audioEngine = [[AVAudioEngine alloc] init];
  AVAudioInputNode *input = self.audioEngine.inputNode;
  AVAudioFormat *format = [input outputFormatForBus:0];

  __weak SpeechRecognizer *weakSelf = self;
  [input installTapOnBus:0
              bufferSize:1024
                  format:format
                   block:^(AVAudioPCMBuffer *buffer, AVAudioTime *when) {
                     SpeechRecognizer *strongSelf = weakSelf;
                     if (strongSelf == nil) {
                       return;
                     }
                     // Buffer chạy trên luồng audio; request nuốt được trực tiếp,
                     // còn sự kiện lên JS thì đẩy về main queue.
                     [strongSelf.request appendAudioPCMBuffer:buffer];
                     [strongSelf reportVolumeForBuffer:buffer];
                   }];

  [self.audioEngine prepare];
  return [self.audioEngine startAndReturnError:error];
}

- (void)reportVolumeForBuffer:(AVAudioPCMBuffer *)buffer {
  self.bufferCount += 1;
  if (self.bufferCount % kVolumeEventEveryNBuffers != 0) {
    return;
  }

  float const *samples = buffer.floatChannelData ? buffer.floatChannelData[0] : NULL;
  AVAudioFrameCount frames = buffer.frameLength;
  if (samples == NULL || frames == 0) {
    return;
  }

  float sum = 0.0f;
  for (AVAudioFrameCount i = 0; i < frames; i++) {
    sum += samples[i] * samples[i];
  }
  float rms = sqrtf(sum / (float)frames);
  // Giọng nói thường quanh 0.0..0.2 biên độ; nhân lên cho thanh mức nhúc nhích.
  float level = fminf(1.0f, rms * 5.0f);

  dispatch_async(dispatch_get_main_queue(), ^{
    [self emitOnSpeechVolume:@(level)];
  });
}

#pragma mark - Phiên nhận dạng

/** Mở một phiên nhận dạng mới trên luồng audio đang chạy sẵn. */
- (void)beginTask {
  self.segmentText = nil;

  SFSpeechAudioBufferRecognitionRequest *request =
      [[SFSpeechAudioBufferRecognitionRequest alloc] init];
  request.shouldReportPartialResults = YES;
  request.taskHint = SFSpeechRecognitionTaskHintDictation;
  if (self.punctuate) {
    if (@available(iOS 16.0, *)) {
      // Đây là lớp 1 trên iOS: hệ điều hành tự chấm câu và viết hoa.
      request.addsPunctuation = YES;
    }
  }
  self.request = request;

  __weak SpeechRecognizer *weakSelf = self;
  self.task = [self.recognizer
      recognitionTaskWithRequest:request
                   resultHandler:^(SFSpeechRecognitionResult *result, NSError *error) {
                     SpeechRecognizer *strongSelf = weakSelf;
                     if (strongSelf == nil) {
                       return;
                     }
                     dispatch_async(dispatch_get_main_queue(), ^{
                       [strongSelf handleResult:result error:error];
                     });
                   }];
}

- (void)handleResult:(SFSpeechRecognitionResult *)result error:(NSError *)error {
  if (result != nil) {
    NSString *text = result.bestTranscription.formattedString;
    if (text.length > 0) {
      self.segmentText = text;
      if (!result.isFinal) {
        [self emitOnSpeechPartial:text];
      }
    }
    if (!result.isFinal) {
      return;
    }
  }

  // Tới đây phiên đã kết thúc: hoặc isFinal, hoặc lỗi.
  if (self.segmentText.length > 0) {
    self.emptyTasks = 0;
    [self emitOnSpeechFinal:self.segmentText];
    self.segmentText = nil;
  } else {
    self.emptyTasks += 1;
  }

  // Lỗi khi vẫn đang nghe thường chỉ là phiên hết hạn (~1 phút) hoặc một đoạn
  // im lặng; mở phiên mới chứ không báo ra màn hình. Nhưng nếu mấy phiên liền
  // nhau không ra chữ nào thì bộ nhận dạng hỏng thật, dừng hẳn để khỏi quay
  // vòng vô tận.
  if (self.listening) {
    if (self.emptyTasks >= kMaxEmptyTasks) {
      self.listening = NO;
      [self teardown];
      [self emitOnSpeechError:@"Không nghe được gì, đã dừng"];
      [self emitOnSpeechEnd];
      return;
    }
    [self beginTask];
    return;
  }

  [self teardown];
  [self emitOnSpeechEnd];
}

- (void)teardown {
  if (self.audioEngine.isRunning) {
    [self.audioEngine stop];
    [self.audioEngine.inputNode removeTapOnBus:0];
  }
  self.audioEngine = nil;
  self.request = nil;
  self.task = nil;
  self.segmentText = nil;
  self.bufferCount = 0;
  self.emptyTasks = 0;

  NSError *error = nil;
  [[AVAudioSession sharedInstance]
        setActive:NO
      withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation
            error:&error];
}

#pragma mark - TurboModule

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeSpeechRecognizerSpecJSI>(params);
}

@end
