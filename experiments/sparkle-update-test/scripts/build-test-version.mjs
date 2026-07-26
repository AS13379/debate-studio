import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { validateUpdateBundle } from "../lib/update-bundle-validator.mjs";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error("Usage: node build-test-version.mjs <major.minor.patch>");
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const experimentRoot = path.resolve(scriptDirectory, "..");
const workspaceRoot = path.resolve(experimentRoot, "../..");
const generatedRoot = process.env.DST_SPARKLE_GENERATED_ROOT ?? "/private/tmp/debate-studio-sparkle-validation";
const workRoot = path.join(generatedRoot, "work");
const projectRoot = path.join(workRoot, `project-${version}`);
const outputRoot = path.join(generatedRoot, "artifacts", version);
const appSource = path.join(experimentRoot, "app");
const appPath = path.join(outputRoot, "Debate Studio Update Test.app");
const require = createRequire(import.meta.url);

rmSync(projectRoot, { recursive: true, force: true });
rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(projectRoot, { recursive: true });
mkdirSync(outputRoot, { recursive: true });
cpSync(appSource, path.join(projectRoot, "app"), { recursive: true });

writeFileSync(
  path.join(projectRoot, "package.json"),
  JSON.stringify(
    {
      name: "debate-studio-update-test",
      version,
      private: true,
      main: "app/main.cjs",
    },
    null,
    2,
  ) + "\n",
);

// Use the same complete Electron 35.7.5 application bundle that electron-builder
// packages, but assemble the isolated test directly. This avoids invoking the
// formal Debate Studio build pipeline or changing any formal release setting.
execFileSync(
  "ditto",
  ["--norsrc", "--noextattr", path.join(workspaceRoot, "node_modules/electron/dist/Electron.app"), appPath],
  { stdio: "inherit" },
);

const resources = path.join(appPath, "Contents", "Resources");
const frameworks = path.join(appPath, "Contents", "Frameworks");
const infoPlist = path.join(appPath, "Contents", "Info.plist");
rmSync(path.join(resources, "default_app.asar"), { force: true });

execFileSync(
  process.execPath,
  [
    path.join(workspaceRoot, "node_modules/@electron/asar/bin/asar.js"),
    "pack",
    projectRoot,
    path.join(resources, "app.asar"),
  ],
  { stdio: "inherit" },
);
cpSync(
  path.join(experimentRoot, "native/build/Release/sparkle_bridge.node"),
  path.join(resources, "sparkle_bridge.node"),
);
execFileSync(
  "ditto",
  [
    "--norsrc",
    "--noextattr",
    path.join(experimentRoot, "native/vendor/Sparkle.framework"),
    path.join(frameworks, "Sparkle.framework"),
  ],
  { stdio: "inherit" },
);

function setPlist(key, type, value) {
  try {
    execFileSync("/usr/libexec/PlistBuddy", ["-c", `Delete :${key}`, infoPlist], { stdio: "ignore" });
  } catch {
    // The key is new in most test bundles.
  }
  execFileSync("/usr/libexec/PlistBuddy", ["-c", `Add :${key} ${type} ${value}`, infoPlist]);
}

setPlist("CFBundleIdentifier", "string", "com.leander.debatestudio.update-test");
setPlist("CFBundleName", "string", "Debate Studio Update Test");
setPlist("CFBundleDisplayName", "string", "Debate Studio Update Test");
setPlist("CFBundleShortVersionString", "string", version);
setPlist("CFBundleVersion", "string", version);
setPlist("SUFeedURL", "string", "http://127.0.0.1:27891/appcast.xml");
setPlist("SUPublicEDKey", "string", "n4G+b8A6touR/ytKrzrjEWXbaqhWcZpJMSt70eFa+ug=");
setPlist("SUEnableAutomaticChecks", "bool", "false");
setPlist("SUEnableInstallerLauncherService", "bool", "false");
setPlist("SUScheduledCheckInterval", "integer", "3600");
setPlist("NSAppTransportSecurity", "dict", "");
execFileSync("/usr/libexec/PlistBuddy", ["-c", "Add :NSAppTransportSecurity:NSAllowsLocalNetworking bool true", infoPlist]);
execFileSync("/usr/libexec/PlistBuddy", ["-c", "Add :NSAppTransportSecurity:NSExceptionDomains dict", infoPlist]);
execFileSync("/usr/libexec/PlistBuddy", ["-c", "Add :NSAppTransportSecurity:NSExceptionDomains:localhost dict", infoPlist]);
execFileSync("/usr/libexec/PlistBuddy", ["-c", "Add :NSAppTransportSecurity:NSExceptionDomains:localhost:NSExceptionAllowsInsecureHTTPLoads bool true", infoPlist]);

// Sparkle 2.9.4 ships with correctly ordered ad-hoc signatures for its nested
// framework/XPC helpers. Electron's signer handles the host Electron components
// from the inside out while Sparkle is explicitly preserved. Never sign using
// codesign --deep.
execFileSync("xattr", ["-cr", appPath], { stdio: "inherit" });
const { signAsync } = require(path.join(workspaceRoot, "node_modules/@electron/osx-sign"));
await signAsync({
  app: appPath,
  identity: "-",
  identityValidation: false,
  hardenedRuntime: true,
  preAutoEntitlements: false,
  preEmbedProvisioningProfile: false,
  timestamp: "none",
  optionsForFile: () => ({
    entitlements: path.join(experimentRoot, "build/entitlements.mac.plist"),
    hardenedRuntime: true,
    timestamp: "none",
  }),
  ignore: (file) => file.includes(`${path.sep}Sparkle.framework${path.sep}`),
});

const asarPath = path.join(appPath, "Contents", "Resources", "app.asar");
validateUpdateBundle({
  appPath,
  expectedBundleId: "com.leander.debatestudio.update-test",
  expectedVersion: version,
});

const archive = path.join(outputRoot, `Debate-Studio-Update-Test-${version}-arm64.zip`);
execFileSync(
  "ditto",
  ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, archive],
  { stdio: "inherit" },
);

const asarBytes = await import("node:fs").then(({ readFileSync }) => readFileSync(asarPath));
const archiveBytes = await import("node:fs").then(({ readFileSync }) => readFileSync(archive));
const result = {
  version,
  appPath,
  archive,
  asarSize: asarBytes.byteLength,
  asarSha256: createHash("sha256").update(asarBytes).digest("hex"),
  archiveSize: archiveBytes.byteLength,
  archiveSha256: createHash("sha256").update(archiveBytes).digest("hex"),
};

writeFileSync(path.join(outputRoot, "build-result.json"), JSON.stringify(result, null, 2) + "\n");
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
