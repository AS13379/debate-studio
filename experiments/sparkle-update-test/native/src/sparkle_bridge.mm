#import <Foundation/Foundation.h>
#import <Sparkle/Sparkle.h>
#include <node_api.h>

@interface DSTSparkleDelegate : NSObject <SPUUpdaterDelegate>
@property(nonatomic, copy) NSString *lastStatus;
@property(nonatomic, copy) NSString *lastError;
@property(nonatomic, copy) NSString *updateVersion;
@property(nonatomic) uint64_t expectedDownloadBytes;
@property(nonatomic) uint64_t receivedDownloadBytes;
@property(nonatomic) double downloadProgress;
@end

@implementation DSTSparkleDelegate
- (instancetype)init {
  self = [super init];
  if (self) {
    _lastStatus = @"idle";
    _lastError = @"";
    _updateVersion = @"";
    _expectedDownloadBytes = 0;
    _receivedDownloadBytes = 0;
    _downloadProgress = 0.0;
  }
  return self;
}

- (void)updater:(SPUUpdater *)updater
    willDownloadUpdate:(SUAppcastItem *)item
            withRequest:(NSMutableURLRequest *)request {
  self.lastStatus = @"downloading";
  self.lastError = @"";
  self.updateVersion = item.displayVersionString ?: item.versionString ?: @"";
  self.expectedDownloadBytes = 0;
  self.receivedDownloadBytes = 0;
  self.downloadProgress = 0.0;
}

- (void)updater:(SPUUpdater *)updater didDownloadUpdate:(SUAppcastItem *)item {
  self.lastStatus = @"downloaded";
  self.updateVersion = item.displayVersionString ?: item.versionString ?: @"";
  if (self.expectedDownloadBytes > 0) {
    self.receivedDownloadBytes = self.expectedDownloadBytes;
    self.downloadProgress = 1.0;
  }
}

- (void)updater:(SPUUpdater *)updater
    failedToDownloadUpdate:(SUAppcastItem *)item
                     error:(NSError *)error {
  self.lastStatus = @"download-error";
  self.lastError = error.localizedDescription ?: @"Sparkle download failed";
}

- (void)userDidCancelDownload:(SPUUpdater *)updater {
  self.lastStatus = @"cancelled";
}

- (void)updater:(SPUUpdater *)updater willExtractUpdate:(SUAppcastItem *)item {
  self.lastStatus = @"extracting";
}

- (void)updater:(SPUUpdater *)updater didExtractUpdate:(SUAppcastItem *)item {
  self.lastStatus = @"ready-to-install";
}

- (void)updater:(SPUUpdater *)updater willInstallUpdate:(SUAppcastItem *)item {
  self.lastStatus = @"installing";
}

- (void)updater:(SPUUpdater *)updater
    didFinishUpdateCycleForUpdateCheck:(SPUUpdateCheck)updateCheck
                                error:(nullable NSError *)error {
  if (error != nil) {
    self.lastStatus = @"error";
    self.lastError = error.localizedDescription ?: @"Unknown Sparkle error";
    NSLog(@"[dst-sparkle] cycle error: %@", error);
  } else {
    self.lastStatus = @"cycle-finished";
    self.lastError = @"";
    NSLog(@"[dst-sparkle] cycle finished");
  }
}

- (void)updater:(SPUUpdater *)updater didAbortWithError:(NSError *)error {
  self.lastStatus = @"aborted";
  self.lastError = error.localizedDescription ?: @"Unknown Sparkle abort";
  NSLog(@"[dst-sparkle] aborted: %@", error);
}
@end

@interface DSTUserDriverProxy : NSObject <SPUUserDriver>
@property(nonatomic, strong) id<SPUUserDriver> wrapped;
@property(nonatomic, strong) DSTSparkleDelegate *state;
- (instancetype)initWithWrappedDriver:(id<SPUUserDriver>)wrapped
                                state:(DSTSparkleDelegate *)state;
@end

@implementation DSTUserDriverProxy
- (instancetype)initWithWrappedDriver:(id<SPUUserDriver>)wrapped
                                state:(DSTSparkleDelegate *)state {
  self = [super init];
  if (self) {
    _wrapped = wrapped;
    _state = state;
  }
  return self;
}

- (void)showUpdatePermissionRequest:(SPUUpdatePermissionRequest *)request
                              reply:(void (^)(SUUpdatePermissionResponse *))reply {
  [self.wrapped showUpdatePermissionRequest:request reply:reply];
}

- (void)showUserInitiatedUpdateCheckWithCancellation:(void (^)(void))cancellation {
  self.state.lastStatus = @"checking";
  [self.wrapped showUserInitiatedUpdateCheckWithCancellation:cancellation];
}

- (void)showUpdateFoundWithAppcastItem:(SUAppcastItem *)appcastItem
                                 state:(SPUUserUpdateState *)state
                                 reply:(void (^)(SPUUserUpdateChoice))reply {
  self.state.lastStatus = @"update-found";
  self.state.updateVersion = appcastItem.displayVersionString ?: appcastItem.versionString ?: @"";
  [self.wrapped showUpdateFoundWithAppcastItem:appcastItem state:state reply:reply];
}

- (void)showUpdateReleaseNotesWithDownloadData:(SPUDownloadData *)downloadData {
  [self.wrapped showUpdateReleaseNotesWithDownloadData:downloadData];
}

- (void)showUpdateReleaseNotesFailedToDownloadWithError:(NSError *)error {
  [self.wrapped showUpdateReleaseNotesFailedToDownloadWithError:error];
}

- (void)showUpdateNotFoundWithError:(NSError *)error
                    acknowledgement:(void (^)(void))acknowledgement {
  self.state.lastStatus = @"not-found";
  self.state.lastError = error.localizedDescription ?: @"";
  [self.wrapped showUpdateNotFoundWithError:error acknowledgement:acknowledgement];
}

- (void)showUpdaterError:(NSError *)error acknowledgement:(void (^)(void))acknowledgement {
  self.state.lastStatus = @"error";
  self.state.lastError = error.localizedDescription ?: @"Unknown Sparkle error";
  [self.wrapped showUpdaterError:error acknowledgement:acknowledgement];
}

- (void)showDownloadInitiatedWithCancellation:(void (^)(void))cancellation {
  self.state.lastStatus = @"downloading";
  self.state.expectedDownloadBytes = 0;
  self.state.receivedDownloadBytes = 0;
  self.state.downloadProgress = 0.0;
  [self.wrapped showDownloadInitiatedWithCancellation:cancellation];
}

- (void)showDownloadDidReceiveExpectedContentLength:(uint64_t)expectedContentLength {
  self.state.expectedDownloadBytes = expectedContentLength;
  [self.wrapped showDownloadDidReceiveExpectedContentLength:expectedContentLength];
}

- (void)showDownloadDidReceiveDataOfLength:(uint64_t)length {
  self.state.receivedDownloadBytes += length;
  if (self.state.expectedDownloadBytes > 0) {
    self.state.downloadProgress =
        MIN(1.0, (double)self.state.receivedDownloadBytes / (double)self.state.expectedDownloadBytes);
  }
  [self.wrapped showDownloadDidReceiveDataOfLength:length];
}

- (void)showDownloadDidStartExtractingUpdate {
  self.state.lastStatus = @"extracting";
  if (self.state.expectedDownloadBytes > 0) {
    self.state.receivedDownloadBytes = self.state.expectedDownloadBytes;
    self.state.downloadProgress = 1.0;
  }
  [self.wrapped showDownloadDidStartExtractingUpdate];
}

- (void)showExtractionReceivedProgress:(double)progress {
  self.state.lastStatus = @"extracting";
  [self.wrapped showExtractionReceivedProgress:progress];
}

- (void)showReadyToInstallAndRelaunch:(void (^)(SPUUserUpdateChoice))reply {
  self.state.lastStatus = @"ready-to-install";
  [self.wrapped showReadyToInstallAndRelaunch:reply];
}

- (void)showInstallingUpdateWithApplicationTerminated:(BOOL)applicationTerminated
                           retryTerminatingApplication:(void (^)(void))retryTerminatingApplication {
  self.state.lastStatus = @"installing";
  [self.wrapped showInstallingUpdateWithApplicationTerminated:applicationTerminated
                                  retryTerminatingApplication:retryTerminatingApplication];
}

- (void)showUpdateInstalledAndRelaunched:(BOOL)relaunched
                        acknowledgement:(void (^)(void))acknowledgement {
  self.state.lastStatus = @"installed";
  [self.wrapped showUpdateInstalledAndRelaunched:relaunched acknowledgement:acknowledgement];
}

- (void)dismissUpdateInstallation {
  [self.wrapped dismissUpdateInstallation];
}

- (void)showUpdateInFocus {
  if ([self.wrapped respondsToSelector:@selector(showUpdateInFocus)]) {
    [self.wrapped showUpdateInFocus];
  }
}
@end

namespace {
SPUUpdater *gUpdater = nil;
SPUStandardUserDriver *gStandardUserDriver = nil;
DSTUserDriverProxy *gUserDriver = nil;
DSTSparkleDelegate *gDelegate = nil;

napi_value Bool(napi_env env, bool value) {
  napi_value result;
  napi_get_boolean(env, value, &result);
  return result;
}

napi_value Undefined(napi_env env) {
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

napi_value String(napi_env env, NSString *value) {
  napi_value result;
  const char *utf8 = (value ?: @"").UTF8String;
  napi_create_string_utf8(env, utf8, NAPI_AUTO_LENGTH, &result);
  return result;
}

napi_value Number(napi_env env, double value) {
  napi_value result;
  napi_create_double(env, value, &result);
  return result;
}

napi_value Init(napi_env env, napi_callback_info info) {
  __block BOOL started = NO;
  void (^work)(void) = ^{
    if (gUpdater != nil) {
      started = YES;
      return;
    }
    @try {
      NSBundle *bundle = NSBundle.mainBundle;
      gDelegate = [[DSTSparkleDelegate alloc] init];
      gStandardUserDriver = [[SPUStandardUserDriver alloc] initWithHostBundle:bundle delegate:nil];
      gUserDriver = [[DSTUserDriverProxy alloc] initWithWrappedDriver:gStandardUserDriver
                                                                state:gDelegate];
      gUpdater = [[SPUUpdater alloc] initWithHostBundle:bundle
                                      applicationBundle:bundle
                                             userDriver:gUserDriver
                                               delegate:gDelegate];
      NSError *error = nil;
      started = [gUpdater startUpdater:&error];
      if (!started) {
        gDelegate.lastStatus = @"start-error";
        gDelegate.lastError = error.localizedDescription ?: @"Sparkle start failed";
        NSLog(@"[dst-sparkle] startUpdater failed: %@", error);
      }
    } @catch (NSException *exception) {
      gDelegate.lastStatus = @"exception";
      gDelegate.lastError = exception.reason ?: @"Sparkle exception";
      NSLog(@"[dst-sparkle] exception: %@", exception);
    }
  };
  if (NSThread.isMainThread) work(); else dispatch_sync(dispatch_get_main_queue(), work);
  return Bool(env, started);
}

napi_value Check(napi_env env, napi_callback_info info) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (gUpdater == nil) return;
    gDelegate.lastStatus = @"checking";
    [gUpdater checkForUpdates];
  });
  return Undefined(env);
}

napi_value InstallNow(napi_env env, napi_callback_info info) {
  return Check(env, info);
}

napi_value SetAutomaticChecks(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  bool enabled = false;
  if (argc == 1) napi_get_value_bool(env, argv[0], &enabled);
  dispatch_async(dispatch_get_main_queue(), ^{
    if (gUpdater != nil) gUpdater.automaticallyChecksForUpdates = enabled;
  });
  return Undefined(env);
}

napi_value Cancel(napi_env env, napi_callback_info info) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (gUpdater.sessionInProgress) [gUpdater resetUpdateCycle];
    if (gDelegate != nil) gDelegate.lastStatus = @"cancelled";
  });
  return Undefined(env);
}

napi_value GetState(napi_env env, napi_callback_info info) {
  napi_value result;
  napi_create_object(env, &result);
  napi_set_named_property(env, result, "status", String(env, gDelegate.lastStatus ?: @"uninitialized"));
  napi_set_named_property(env, result, "error", String(env, gDelegate.lastError ?: @""));
  napi_set_named_property(env, result, "updateVersion", String(env, gDelegate.updateVersion ?: @""));
  napi_set_named_property(
      env, result, "expectedDownloadBytes", Number(env, (double)gDelegate.expectedDownloadBytes));
  napi_set_named_property(
      env, result, "receivedDownloadBytes", Number(env, (double)gDelegate.receivedDownloadBytes));
  napi_set_named_property(env, result, "downloadProgress", Number(env, gDelegate.downloadProgress));
  napi_set_named_property(env, result, "canCheckForUpdates", Bool(env, gUpdater.canCheckForUpdates));
  napi_set_named_property(env, result, "sessionInProgress", Bool(env, gUpdater.sessionInProgress));
  napi_set_named_property(env, result, "automaticallyChecksForUpdates", Bool(env, gUpdater.automaticallyChecksForUpdates));
  return result;
}

napi_value ModuleInit(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    {"init", nullptr, Init, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"checkForUpdates", nullptr, Check, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"installUpdateNow", nullptr, InstallNow, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setAutomaticChecks", nullptr, SetAutomaticChecks, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"cancelUpdate", nullptr, Cancel, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"getState", nullptr, GetState, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}
}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, ModuleInit)
