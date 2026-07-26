const path = require("node:path");

const experimentRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(experimentRoot, "../..");
const publicKey = "n4G+b8A6touR/ytKrzrjEWXbaqhWcZpJMSt70eFa+ug=";
const outputDirectory = process.env.DST_SPARKLE_OUTPUT;

if (!outputDirectory) {
  throw new Error("DST_SPARKLE_OUTPUT is required");
}

module.exports = {
  appId: "com.leander.debatestudio.update-test",
  productName: "Debate Studio Update Test",
  copyright: "Copyright © 2026 Leander — isolated updater validation",
  artifactName: "Debate-Studio-Update-Test-${version}-${arch}.${ext}",
  asar: true,
  npmRebuild: false,
  electronVersion: "35.7.5",
  directories: {
    output: outputDirectory,
    buildResources: path.join(experimentRoot, "build"),
  },
  files: ["app/**/*", "package.json"],
  extraFiles: [
    {
      from: path.join(experimentRoot, "native/vendor/Sparkle.framework"),
      to: "Frameworks/Sparkle.framework",
    },
    {
      from: path.join(experimentRoot, "native/build/Release/sparkle_bridge.node"),
      to: "Resources/sparkle_bridge.node",
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: path.join(workspaceRoot, "build/icon.icns"),
    hardenedRuntime: true,
    identity: "-",
    entitlements: path.join(experimentRoot, "build/entitlements.mac.plist"),
    entitlementsInherit: path.join(experimentRoot, "build/entitlements.mac.inherit.plist"),
    target: [{ target: "dir", arch: ["arm64"] }],
    extendInfo: {
      SUFeedURL: "http://127.0.0.1:27891/appcast.xml",
      SUPublicEDKey: publicKey,
      SUEnableAutomaticChecks: false,
      SUEnableInstallerLauncherService: false,
      SUScheduledCheckInterval: 3600,
      NSAppTransportSecurity: {
        NSAllowsLocalNetworking: true,
        NSExceptionDomains: {
          localhost: {
            NSExceptionAllowsInsecureHTTPLoads: true,
          },
        },
      },
    },
  },
};
