import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";

export class UpdateBundleValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "UpdateBundleValidationError";
    this.code = code;
  }
}

function readPlistValue(infoPlist, key) {
  try {
    return execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, infoPlist], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new UpdateBundleValidationError(
      "INVALID_INFO_PLIST",
      `Unable to read ${key} from ${infoPlist}`,
    );
  }
}

function assertContainedSymlinks(root) {
  const canonicalRoot = realpathSync(root);
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      const stats = lstatSync(entryPath);
      if (stats.isSymbolicLink()) {
        const target = realpathSync(entryPath);
        if (target !== canonicalRoot && !target.startsWith(`${canonicalRoot}${path.sep}`)) {
          throw new UpdateBundleValidationError(
            "SYMLINK_ESCAPE",
            `Bundle symlink escapes the application: ${entryPath}`,
          );
        }
      } else if (stats.isDirectory()) {
        pending.push(entryPath);
      }
    }
  }
}

export function validateUpdateBundle({
  appPath,
  expectedBundleId,
  expectedVersion,
  verifyCodeSignature = true,
}) {
  if (!appPath.endsWith(".app") || !existsSync(appPath)) {
    throw new UpdateBundleValidationError("APP_NOT_FOUND", `Application not found: ${appPath}`);
  }

  const contents = path.join(appPath, "Contents");
  const infoPlist = path.join(contents, "Info.plist");
  const asarPath = path.join(contents, "Resources", "app.asar");
  const sparkleFramework = path.join(contents, "Frameworks", "Sparkle.framework");
  const bridgePath = path.join(contents, "Resources", "sparkle_bridge.node");

  if (!existsSync(infoPlist)) {
    throw new UpdateBundleValidationError("INFO_PLIST_MISSING", "Info.plist is missing");
  }

  const bundleId = readPlistValue(infoPlist, "CFBundleIdentifier");
  if (bundleId !== expectedBundleId) {
    throw new UpdateBundleValidationError(
      "BUNDLE_ID_MISMATCH",
      `Expected ${expectedBundleId}, received ${bundleId}`,
    );
  }

  const version = readPlistValue(infoPlist, "CFBundleShortVersionString");
  if (version !== expectedVersion) {
    throw new UpdateBundleValidationError(
      "VERSION_MISMATCH",
      `Expected ${expectedVersion}, received ${version}`,
    );
  }

  if (!existsSync(asarPath) || statSync(asarPath).size === 0) {
    throw new UpdateBundleValidationError("APP_ASAR_MISSING", "Contents/Resources/app.asar is missing");
  }
  if (!existsSync(sparkleFramework)) {
    throw new UpdateBundleValidationError("SPARKLE_MISSING", "Sparkle.framework is missing");
  }
  if (!existsSync(bridgePath)) {
    throw new UpdateBundleValidationError("BRIDGE_MISSING", "sparkle_bridge.node is missing");
  }

  assertContainedSymlinks(appPath);

  if (verifyCodeSignature) {
    try {
      execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=4", appPath], {
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch (error) {
      throw new UpdateBundleValidationError(
        "CODE_SIGNATURE_INVALID",
        error?.stderr?.toString?.().trim() || "codesign verification failed",
      );
    }
  }

  return {
    appPath,
    bundleId,
    version,
    appAsarSize: readFileSync(asarPath).byteLength,
  };
}
