import process from "node:process";
import { validateUpdateBundle } from "../lib/update-bundle-validator.mjs";

const [appPath, expectedBundleId, expectedVersion] = process.argv.slice(2);
if (!appPath || !expectedBundleId || !expectedVersion) {
  throw new Error(
    "Usage: node verify-update-bundle.mjs <app-path> <expected-bundle-id> <expected-version>",
  );
}

const result = validateUpdateBundle({
  appPath,
  expectedBundleId,
  expectedVersion,
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
