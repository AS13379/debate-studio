const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const TEST_USER_DATA = path.join(app.getPath("appData"), "debate-studio-update-test");
app.setPath("userData", TEST_USER_DATA);
app.setName("Debate Studio Update Test");

let mainWindow;
let bridge;

function log(message) {
  fs.mkdirSync(TEST_USER_DATA, { recursive: true });
  fs.appendFileSync(
    path.join(TEST_USER_DATA, "sparkle-test.log"),
    `${new Date().toISOString()} ${message}\n`,
    "utf8",
  );
}

function loadBridge() {
  const bridgePath = path.join(process.resourcesPath, "sparkle_bridge.node");
  bridge = require(bridgePath);
  const initialized = bridge.init();
  log(`bridge.init=${initialized} version=${app.getVersion()} bridge=${bridgePath}`);
  return initialized;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 760,
    height: 560,
    minWidth: 680,
    minHeight: 500,
    title: "Debate Studio Update Test",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  fs.mkdirSync(TEST_USER_DATA, { recursive: true });
  const forcedFailureMarker = path.join(TEST_USER_DATA, "force-startup-failure");
  if (fs.existsSync(forcedFailureMarker)) {
    log(`forced-startup-failure version=${app.getVersion()}`);
    app.exit(86);
    return;
  }
  const markerPath = path.join(TEST_USER_DATA, "persistent-marker.json");
  if (!fs.existsSync(markerPath)) {
    fs.writeFileSync(
      markerPath,
      JSON.stringify({ createdAt: new Date().toISOString(), marker: "must-survive-updates" }, null, 2),
      "utf8",
    );
  }

  loadBridge();
  createWindow();
});

app.on("window-all-closed", () => app.quit());

ipcMain.handle("sparkle:snapshot", () => ({
  version: app.getVersion(),
  bundleId: app.getName(),
  bridgeReady: Boolean(bridge),
  state: bridge?.getState?.() ?? null,
}));

ipcMain.handle("sparkle:check", () => {
  bridge.checkForUpdates();
  log("manual-check");
});

ipcMain.handle("sparkle:auto", (_event, enabled) => {
  bridge.setAutomaticChecks(Boolean(enabled));
  log(`automatic-checks=${Boolean(enabled)}`);
});

ipcMain.handle("sparkle:install-now", () => {
  bridge.installUpdateNow();
  log("install-update-now");
});

ipcMain.handle("sparkle:cancel", () => {
  bridge.cancelUpdate?.();
  log("cancel-update");
});
