import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error("Usage: node make-bundle-mismatch.mjs <major.minor.patch>");
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const experimentRoot = path.resolve(scriptDirectory, "..");
const workspaceRoot = path.resolve(experimentRoot, "../..");
const generatedRoot =
  process.env.DST_SPARKLE_GENERATED_ROOT ?? "/private/tmp/debate-studio-sparkle-validation";
const outputRoot = path.join(generatedRoot, "artifacts", version);
const appPath = path.join(outputRoot, "Debate Studio Update Test.app");
const archive = path.join(outputRoot, `Debate-Studio-Update-Test-${version}-arm64.zip`);
const validArchive = `${archive}.valid`;
const infoPlist = path.join(appPath, "Contents", "Info.plist");
const require = createRequire(import.meta.url);

renameSync(archive, validArchive);
execFileSync(
  "/usr/libexec/PlistBuddy",
  [
    "-c",
    "Set :CFBundleIdentifier com.leander.debatestudio.update-test.mismatch",
    infoPlist,
  ],
);
execFileSync("xattr", ["-cr", appPath]);

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

execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=4", appPath], {
  stdio: "inherit",
});
rmSync(archive, { force: true });
execFileSync(
  "ditto",
  ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, archive],
  { stdio: "inherit" },
);

const bytes = readFileSync(archive);
process.stdout.write(
  `${JSON.stringify(
    {
      archive,
      validArchive,
      archiveSize: bytes.byteLength,
      archiveSha256: createHash("sha256").update(bytes).digest("hex"),
    },
    null,
    2,
  )}\n`,
);
