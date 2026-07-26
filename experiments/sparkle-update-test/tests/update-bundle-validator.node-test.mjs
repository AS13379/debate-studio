import assert from "node:assert/strict";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  UpdateBundleValidationError,
  validateUpdateBundle,
} from "../lib/update-bundle-validator.mjs";

const expectedBundleId = "com.leander.debatestudio.update-test";
const expectedVersion = "1.0.4";

function makeFixture(name, { bundleId = expectedBundleId, includeAsar = true } = {}) {
  const root = path.join(tmpdir(), `dst-sparkle-validator-${process.pid}-${name}.app`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(path.join(root, "Contents", "Resources"), { recursive: true });
  mkdirSync(path.join(root, "Contents", "Frameworks", "Sparkle.framework"), { recursive: true });
  writeFileSync(path.join(root, "Contents", "Resources", "sparkle_bridge.node"), "bridge");
  if (includeAsar) writeFileSync(path.join(root, "Contents", "Resources", "app.asar"), "asar");
  writeFileSync(
    path.join(root, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${bundleId}</string>
<key>CFBundleShortVersionString</key><string>${expectedVersion}</string>
</dict></plist>`,
  );
  return root;
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof UpdateBundleValidationError);
    assert.equal(error.code, code);
    return true;
  });
}

test("accepts a structurally complete isolated app before archive signing", () => {
  const appPath = makeFixture("valid");
  const result = validateUpdateBundle({
    appPath,
    expectedBundleId,
    expectedVersion,
    verifyCodeSignature: false,
  });
  assert.equal(result.bundleId, expectedBundleId);
  assert.equal(result.appAsarSize, 4);
  rmSync(appPath, { recursive: true, force: true });
});

test("rejects a bundle identifier mismatch before signing", () => {
  const appPath = makeFixture("bundle-id", {
    bundleId: "com.leander.debatestudio.update-test.mismatch",
  });
  expectCode(
    () =>
      validateUpdateBundle({
        appPath,
        expectedBundleId,
        expectedVersion,
        verifyCodeSignature: false,
      }),
    "BUNDLE_ID_MISMATCH",
  );
  rmSync(appPath, { recursive: true, force: true });
});

test("rejects an app without app.asar before signing", () => {
  const appPath = makeFixture("missing-asar", { includeAsar: false });
  expectCode(
    () =>
      validateUpdateBundle({
        appPath,
        expectedBundleId,
        expectedVersion,
        verifyCodeSignature: false,
      }),
    "APP_ASAR_MISSING",
  );
  rmSync(appPath, { recursive: true, force: true });
});

test("rejects a symlink that escapes the application bundle", () => {
  const appPath = makeFixture("symlink");
  symlinkSync("/private/tmp", path.join(appPath, "Contents", "Resources", "escape"));
  expectCode(
    () =>
      validateUpdateBundle({
        appPath,
        expectedBundleId,
        expectedVersion,
        verifyCodeSignature: false,
      }),
    "SYMLINK_ESCAPE",
  );
  rmSync(appPath, { recursive: true, force: true });
});
