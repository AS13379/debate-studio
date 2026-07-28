#import <Foundation/Foundation.h>
#import <Sparkle/Sparkle.h>
#include <node_api.h>

static BOOL DSIsSparkleError(NSError *error, SUError code) {
  return error != nil &&
      [error.domain isEqualToString:SUSparkleErrorDomain] &&
      error.code == code;
}

@interface DSSparkleState : NSObject <SPUUpdaterDelegate>
@property(nonatomic, copy) NSString *status;
@property(nonatomic, copy) NSString *error;
@property(nonatomic, copy) NSString *updateVersion;
@property(nonatomic) uint64_t expectedDownloadBytes;
@property(nonatomic) uint64_t receivedDownloadBytes;
@property(nonatomic) double downloadProgress;
@end

@implementation DSSparkleState
- (instancetype)init {
  self = [super init];
  if (self) {
    _status = @"idle";
    _error = @"";
    _updateVersion = @"";
  }
  return self;
}

- (void)updater:(SPUUpdater *)updater
    willDownloadUpdate:(SUAppcastItem *)item
           withRequest:(NSMutableURLRequest *)request {
  self.status = @"downloading";
  self.error = @"";
  self.updateVersion = item.displayVersionString ?: item.versionString ?: @"";
  self.expectedDownloadBytes = 0;
  self.receivedDownloadBytes = 0;
  self.downloadProgress = 0.0;
}

- (void)updater:(SPUUpdater *)updater didDownloadUpdate:(SUAppcastItem *)item {
  self.status = @"downloaded";
  self.updateVersion = item.displayVersionString ?: item.versionString ?: @"";
  if (self.expectedDownloadBytes > 0) {
    self.receivedDownloadBytes = self.expectedDownloadBytes;
    self.downloadProgress = 1.0;
  }
}

- (void)updater:(SPUUpdater *)updater
    failedToDownloadUpdate:(SUAppcastItem *)item
                     error:(NSError *)error {
  self.status = @"download-error";
  self.error = error.localizedDescription ?: @"Sparkle download failed";
}

- (void)userDidCancelDownload:(SPUUpdater *)updater {
  self.status = @"cancelled";
}

- (void)updater:(SPUUpdater *)updater willExtractUpdate:(SUAppcastItem *)item {
  self.status = @"extracting";
}

- (void)updater:(SPUUpdater *)updater didExtractUpdate:(SUAppcastItem *)item {
  self.status = @"ready-to-install";
}

- (void)updater:(SPUUpdater *)updater willInstallUpdate:(SUAppcastItem *)item {
  self.status = @"installing";
}

- (void)updater:(SPUUpdater *)updater
    didFinishUpdateCycleForUpdateCheck:(SPUUpdateCheck)updateCheck
                                error:(nullable NSError *)error {
  if (DSIsSparkleError(error, SUNoUpdateError)) {
    self.status = @"not-found";
    self.error = @"";
    return;
  }
  if (DSIsSparkleError(error, SUInstallationCanceledError)) {
    self.status = @"cancelled";
    self.error = @"";
    return;
  }
  BOOL expectedCompletion =
      [self.status isEqualToString:@"not-found"] ||
      [self.status isEqualToString:@"cancelled"] ||
      [self.status isEqualToString:@"installed"];
  if (error != nil && !expectedCompletion) {
    self.status = @"error";
    self.error = error.localizedDescription ?: @"Unknown Sparkle error";
  } else {
    // Keep the most specific user-driver result (not-found, update-found,
    // ready-to-install, installed, and so on). Replacing it with a generic
    // cycle state can leave the Renderer stuck on "checking".
    self.error = @"";
  }
}

- (void)updater:(SPUUpdater *)updater didAbortWithError:(NSError *)error {
  if (DSIsSparkleError(error, SUNoUpdateError)) {
    self.status = @"not-found";
    self.error = @"";
    return;
  }
  if (DSIsSparkleError(error, SUInstallationCanceledError)) {
    self.status = @"cancelled";
    self.error = @"";
    return;
  }
  self.status = @"aborted";
  self.error = error.localizedDescription ?: @"Unknown Sparkle abort";
}
@end

@interface DSUserDriverProxy : NSObject <SPUUserDriver>
@property(nonatomic, strong) id<SPUUserDriver> wrapped;
@property(nonatomic, strong) DSSparkleState *state;
@property(nonatomic, copy, nullable) void (^readyToInstallReply)(SPUUserUpdateChoice);
- (instancetype)initWithWrappedDriver:(id<SPUUserDriver>)wrapped
                                state:(DSSparkleState *)state;
@end

@implementation DSUserDriverProxy
- (instancetype)initWithWrappedDriver:(id<SPUUserDriver>)wrapped
                                state:(DSSparkleState *)state {
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
  self.state.status = @"checking";
  [self.wrapped showUserInitiatedUpdateCheckWithCancellation:cancellation];
}

- (void)showUpdateFoundWithAppcastItem:(SUAppcastItem *)item
                                 state:(SPUUserUpdateState *)state
                                 reply:(void (^)(SPUUserUpdateChoice))reply {
  self.state.status = @"update-found";
  self.state.updateVersion = item.displayVersionString ?: item.versionString ?: @"";
  [self.wrapped showUpdateFoundWithAppcastItem:item state:state reply:reply];
}

- (void)showUpdateReleaseNotesWithDownloadData:(SPUDownloadData *)downloadData {
  [self.wrapped showUpdateReleaseNotesWithDownloadData:downloadData];
}

- (void)showUpdateReleaseNotesFailedToDownloadWithError:(NSError *)error {
  [self.wrapped showUpdateReleaseNotesFailedToDownloadWithError:error];
}

- (void)showUpdateNotFoundWithError:(NSError *)error
                    acknowledgement:(void (^)(void))acknowledgement {
  self.state.status = @"not-found";
  self.state.error = error.localizedDescription ?: @"";
  [self.wrapped showUpdateNotFoundWithError:error acknowledgement:acknowledgement];
}

- (void)showUpdaterError:(NSError *)error acknowledgement:(void (^)(void))acknowledgement {
  if (DSIsSparkleError(error, SUNoUpdateError)) {
    self.state.status = @"not-found";
    self.state.error = @"";
    acknowledgement();
    return;
  }
  if (DSIsSparkleError(error, SUInstallationCanceledError)) {
    self.state.status = @"cancelled";
    self.state.error = @"";
    acknowledgement();
    return;
  }
  self.state.status = @"error";
  self.state.error = error.localizedDescription ?: @"Unknown Sparkle error";
  [self.wrapped showUpdaterError:error acknowledgement:acknowledgement];
}

- (void)showDownloadInitiatedWithCancellation:(void (^)(void))cancellation {
  self.state.status = @"downloading";
  self.state.expectedDownloadBytes = 0;
  self.state.receivedDownloadBytes = 0;
  self.state.downloadProgress = 0.0;
  [self.wrapped showDownloadInitiatedWithCancellation:cancellation];
}

- (void)showDownloadDidReceiveExpectedContentLength:(uint64_t)length {
  self.state.expectedDownloadBytes = length;
  [self.wrapped showDownloadDidReceiveExpectedContentLength:length];
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
  self.state.status = @"extracting";
  [self.wrapped showDownloadDidStartExtractingUpdate];
}

- (void)showExtractionReceivedProgress:(double)progress {
  self.state.status = @"extracting";
  [self.wrapped showExtractionReceivedProgress:progress];
}

- (void)showReadyToInstallAndRelaunch:(void (^)(SPUUserUpdateChoice))reply {
  self.state.status = @"ready-to-install";
  self.readyToInstallReply = reply;
  __weak DSUserDriverProxy *weakSelf = self;
  [self.wrapped showReadyToInstallAndRelaunch:^(SPUUserUpdateChoice choice) {
    DSUserDriverProxy *strongSelf = weakSelf;
    void (^pendingReply)(SPUUserUpdateChoice) = strongSelf.readyToInstallReply;
    strongSelf.readyToInstallReply = nil;
    if (pendingReply != nil) pendingReply(choice);
  }];
}

- (void)showInstallingUpdateWithApplicationTerminated:(BOOL)applicationTerminated
                           retryTerminatingApplication:(void (^)(void))retry {
  self.state.status = @"installing";
  [self.wrapped showInstallingUpdateWithApplicationTerminated:applicationTerminated
                                  retryTerminatingApplication:retry];
}

- (void)showUpdateInstalledAndRelaunched:(BOOL)relaunched
                        acknowledgement:(void (^)(void))acknowledgement {
  self.state.status = @"installed";
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
DSUserDriverProxy *gUserDriver = nil;
DSSparkleState *gState = nil;

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
  napi_create_string_utf8(env, (value ?: @"").UTF8String, NAPI_AUTO_LENGTH, &result);
  return result;
}

napi_value Number(napi_env env, double value) {
  napi_value result;
  napi_create_double(env, value, &result);
  return result;
}

bool FirstBool(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  bool enabled = false;
  if (argc == 1) napi_get_value_bool(env, argv[0], &enabled);
  return enabled;
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
      gState = [[DSSparkleState alloc] init];
      gStandardUserDriver = [[SPUStandardUserDriver alloc] initWithHostBundle:bundle delegate:nil];
      gUserDriver = [[DSUserDriverProxy alloc] initWithWrappedDriver:gStandardUserDriver state:gState];
      gUpdater = [[SPUUpdater alloc] initWithHostBundle:bundle
                                      applicationBundle:bundle
                                             userDriver:gUserDriver
                                               delegate:gState];
      NSError *error = nil;
      started = [gUpdater startUpdater:&error];
      if (!started) {
        gState.status = @"start-error";
        gState.error = error.localizedDescription ?: @"Sparkle start failed";
      }
    } @catch (NSException *exception) {
      gState.status = @"exception";
      gState.error = exception.reason ?: @"Sparkle exception";
    }
  };
  if (NSThread.isMainThread) work(); else dispatch_sync(dispatch_get_main_queue(), work);
  return Bool(env, started);
}

napi_value Check(napi_env env, napi_callback_info info) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (gUpdater == nil) return;
    gState.status = @"checking";
    [gUpdater checkForUpdates];
  });
  return Undefined(env);
}

napi_value CheckInBackground(napi_env env, napi_callback_info info) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (gUpdater == nil) return;
    gState.status = @"checking";
    [gUpdater checkForUpdatesInBackground];
  });
  return Undefined(env);
}

napi_value InstallNow(napi_env env, napi_callback_info info) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (gUserDriver.readyToInstallReply != nil) {
      void (^reply)(SPUUserUpdateChoice) = gUserDriver.readyToInstallReply;
      gUserDriver.readyToInstallReply = nil;
      gState.status = @"installing";
      reply(SPUUserUpdateChoiceInstall);
    } else if (gUpdater != nil) {
      gState.status = @"checking";
      [gUpdater checkForUpdates];
    }
  });
  return Undefined(env);
}

napi_value SetAutomaticChecks(napi_env env, napi_callback_info info) {
  bool enabled = FirstBool(env, info);
  dispatch_async(dispatch_get_main_queue(), ^{
    if (gUpdater != nil) gUpdater.automaticallyChecksForUpdates = enabled;
  });
  return Undefined(env);
}

napi_value SetAutomaticDownloads(napi_env env, napi_callback_info info) {
  bool enabled = FirstBool(env, info);
  dispatch_async(dispatch_get_main_queue(), ^{
    if (gUpdater != nil) gUpdater.automaticallyDownloadsUpdates = enabled;
  });
  return Undefined(env);
}

napi_value Cancel(napi_env env, napi_callback_info info) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (gUpdater.sessionInProgress) [gUpdater resetUpdateCycle];
    if (gState != nil) gState.status = @"cancelled";
  });
  return Undefined(env);
}

napi_value GetState(napi_env env, napi_callback_info info) {
  napi_value result;
  napi_create_object(env, &result);
  napi_set_named_property(env, result, "status", String(env, gState.status ?: @"uninitialized"));
  napi_set_named_property(env, result, "error", String(env, gState.error ?: @""));
  napi_set_named_property(env, result, "updateVersion", String(env, gState.updateVersion ?: @""));
  napi_set_named_property(env, result, "expectedDownloadBytes", Number(env, (double)gState.expectedDownloadBytes));
  napi_set_named_property(env, result, "receivedDownloadBytes", Number(env, (double)gState.receivedDownloadBytes));
  napi_set_named_property(env, result, "downloadProgress", Number(env, gState.downloadProgress));
  napi_set_named_property(env, result, "canCheckForUpdates", Bool(env, gUpdater.canCheckForUpdates));
  napi_set_named_property(env, result, "sessionInProgress", Bool(env, gUpdater.sessionInProgress));
  napi_set_named_property(env, result, "automaticallyChecksForUpdates", Bool(env, gUpdater.automaticallyChecksForUpdates));
  napi_set_named_property(env, result, "automaticallyDownloadsUpdates", Bool(env, gUpdater.automaticallyDownloadsUpdates));
  return result;
}

napi_value ModuleInit(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    {"init", nullptr, Init, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"checkForUpdates", nullptr, Check, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"checkForUpdatesInBackground", nullptr, CheckInBackground, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"installUpdateNow", nullptr, InstallNow, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setAutomaticChecks", nullptr, SetAutomaticChecks, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setAutomaticDownloads", nullptr, SetAutomaticDownloads, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"cancelUpdate", nullptr, Cancel, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"getState", nullptr, GetState, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, ModuleInit)
