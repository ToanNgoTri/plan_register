#import "SharedFile.h"

NSString *const PRSharedFileReceivedNotification = @"PRSharedFileReceived";
NSString *const PRSharedFilePendingKey = @"PRPendingSharedFile";

@implementation SharedFile

RCT_EXPORT_MODULE()

- (instancetype)init {
  if (self = [super init]) {
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(fileReceived:)
                                                 name:PRSharedFileReceivedNotification
                                               object:nil];
  }
  return self;
}

- (void)dealloc {
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (void)fileReceived:(NSNotification *)notification {
  [self emitOnFileShared];
}

#pragma mark - Spec

- (void)takePendingFile:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
  NSDictionary *pending = [defaults dictionaryForKey:PRSharedFilePendingKey];
  if (pending == nil) {
    resolve(nil);
    return;
  }
  [defaults removeObjectForKey:PRSharedFilePendingKey];

  NSString *path = pending[@"path"];
  if (path == nil || ![[NSFileManager defaultManager] fileExistsAtPath:path]) {
    resolve(nil);
    return;
  }
  resolve(@{
    @"path" : path,
    @"name" : pending[@"name"] ?: @"lich-truc",
    @"mimeType" : pending[@"mimeType"] ?: @"",
    @"size" : pending[@"size"] ?: @0,
  });
}

#pragma mark - TurboModule

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeSharedFileSpecJSI>(params);
}

@end
