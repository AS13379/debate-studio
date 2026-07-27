# Sparkle 2 isolated updater validation

Date: 2026-07-26

This document records a technical experiment. It does not enable Sparkle in the
formal Debate Studio product, change the formal version, or touch formal user
data.

## Scope and isolation

The experiment uses:

- product name: `Debate Studio Update Test`
- bundle identifier: `com.leander.debatestudio.update-test`
- user data: `~/Library/Application Support/debate-studio-update-test`
- local feed: `http://127.0.0.1:27891/appcast.xml`
- generated files: `/private/tmp/debate-studio-sparkle-validation`

The formal `/Applications/Debate Studio.app`, SQLite database, credentials, and
exports are outside the experiment.

## Existing product audit

- Electron: `35.7.5`
- electron-builder: `26.0.12`
- macOS target: arm64 DMG and ZIP
- bundle identifier: `com.leander.debatestudio`
- packaging: ASAR enabled
- macOS identity: `null`
- hardened runtime: enabled
- current formal updater: GitHub release check and manual DMG installation

The formal application currently contains no path that automatically replaces
`/Applications/Debate Studio.app`. The previous custom replacement scripts have
already been removed from the active product path.

The application uses Node's built-in SQLite support. No application runtime
`.node` dependency needs rebuilding; the experiment's only native module is its
own N-API Sparkle bridge.

## Tauri, Squirrel, and Sparkle are different trust systems

Clash Verge Rev and similar Tauri applications use Tauri's updater protocol.
Tauri verifies its update artifacts with the public key embedded in the
application and delegates replacement to the Tauri updater implementation.

Electron's common `electron-updater` macOS path uses Squirrel.Mac. Squirrel's
macOS installer requires a conventionally code-signed application. A separate
project Ed25519 signature does not retrofit that requirement because Squirrel
does not consume or trust that signature.

Sparkle 2 has its own EdDSA archive-signing protocol, update UI, download and
installation helpers. It can therefore provide archive authenticity independently
of Squirrel. This experiment still applies a consistent ad-hoc macOS code
signature to the complete Electron bundle so that nested Mach-O components have
a coherent local signature.

## Bridge selection

The experiment chose an in-repository minimal N-API Objective-C++ bridge rather
than installing `electron-sparkle-updater`.

The reference project was audited at the exact commit:

`Innei/electron-sparkle-updater@4662378b020b8b14cbade9a241345cb5946f8181`

It is MIT licensed and useful as a reference, but it is young, its public API and
test coverage are incomplete, and its example signing workflow is not suitable
as an unreviewed production dependency. No floating dependency or floating
GitHub Action tag was accepted.

## Pinned supply chain

- Sparkle: `2.9.4`
- official archive SHA-256:
  `ce89daf967db1e1893ed3ebd67575ed82d3902563e3191ca92aaec9164fbdef9`
- Electron headers/ABI target: `35.7.5`
- dedicated Sparkle public key:
  `n4G+b8A6touR/ytKrzrjEWXbaqhWcZpJMSt70eFa+ug=`

The matching private key is absent from Git, generated files, logs, and this
document. Local release validation reads it from a repository-external file
selected through `SPARKLE_PRIVATE_KEY_FILE`; CI reads the same secret from the
GitHub Actions Secret `SPARKLE_PRIVATE_KEY`. The public key above is unchanged.

## Developer signing secret

Sparkle's EdDSA private key is a publisher secret, not an end-user credential.
Local signing uses an external file:

```sh
mkdir -p "$HOME/Documents/DebateStudio-secrets"
chmod 700 "$HOME/Documents/DebateStudio-secrets"
chmod 600 "$HOME/Documents/DebateStudio-secrets/sparkle_private_key"
export SPARKLE_PRIVATE_KEY_FILE="$HOME/Documents/DebateStudio-secrets/sparkle_private_key"
npm run sparkle:key:check
```

`sign_update` is always invoked with `--ed-key-file`. The release scripts do not
create, query, or update a macOS Keychain item and never fall back to an unsigned
archive. GitHub Actions materializes the encrypted `SPARKLE_PRIVATE_KEY` Secret
as a mode-600 temporary file, removes it in an `always()` cleanup step, and does
not print its contents. End users do not configure or receive this key.

## Bundle layout and signing

The isolated application contains:

```text
Contents/
  Frameworks/
    Electron Framework.framework
    Sparkle.framework
    Debate Studio Update Test Helper*.app
  Resources/
    app.asar
    sparkle_bridge.node
```

The N-API module loads `Sparkle.framework` through an application-relative
runtime search path. Sparkle's distributed nested XPC/helper signatures are
preserved. Electron host components are signed from the inside out with an
ad-hoc identity; `codesign --deep` is used only for verification, never for
signing. `Info.plist` and `app.asar` are finalized before signing.

Sparkle's standard native user driver remains responsible for update discovery,
release notes, download UI, cancellation, deferral, install, and relaunch. A
small forwarding user-driver proxy records the selected version, phase,
expected/received download bytes, normalized download progress, session state,
and localized errors for a future Electron settings integration.

Every update bundle passes a pre-sign release gate that checks the expected
bundle identifier and version, non-empty `app.asar`, Sparkle framework, N-API
bridge, contained symlinks, and a strict deep signature verification. The ZIP is
then created with:

```text
ditto -c -k --sequesterRsrc --keepParent
```

## Real upgrades

The test marker remained unchanged through every update:

`d06aa9d02c74f340c97633f1cefd547fed7b76391b7d6b973cb38a6dd7f255d7`

| Upgrade | Installed version | app.asar SHA-256 | codesign |
| --- | --- | --- | --- |
| A → B | 1.0.1 | `1509a8403db41710d86f2e7a43383c091c222aa2f31f0347ced1bbe415a94775` | passed |
| B → C | 1.0.2 | `3a9904b30b6194e6e7e2425b6e4fca309fb8b7f4b058e4bba42f1b29115288ae` | passed |
| C → D | 1.0.3 | `b7e4ca6f41a6a4111d568448339e1f526e49cc94219a1f3e7805d28e18bd763f` | passed |

All three upgrades used Sparkle's native update UI and helpers. Sparkle found,
downloaded, extracted, installed, replaced, and relaunched the test application.
No terminal window, custom shell replacement, manual DMG drag, or Dock retry
loop was used.

## Failure-test results

| Scenario | Result |
| --- | --- |
| Wrong Sparkle EdDSA signature | Sparkle rejected the archive and kept 1.0.3 |
| Network interruption | Sparkle displayed a download error and kept 1.0.3 |
| Truncated ZIP stream | Sparkle rejected the incomplete download and kept 1.0.3 |
| Missing `app.asar` | Release-gate validator rejected it before signing |
| Escaping symlink | Release-gate validator rejected it before signing |
| Bundle identifier mismatch | Sparkle accepted a correctly project-signed archive; see limitation below |
| Application with Electron helper children | Normal upgrades completed and helpers exited normally |
| Read-only DMG execution | Sparkle refused to update from the mounted image before download or replacement |
| App Translocation | Sparkle refused to update from the randomized translocation path before download or replacement |
| Newly installed version exits during startup | Sparkle installed the version but did not roll back; see limitation below |

When the test application was launched from a read-only DMG, Sparkle returned a
localized error explaining that the application was open from a read-only or
temporary location and must be moved to Applications. It made no installation
attempt and left the installed test application unchanged.

For App Translocation, a separate quarantined test copy was launched and macOS
ran it from:

```text
/private/var/folders/.../T/AppTranslocation/<random-id>/d/Debate Studio Update Test.app
```

The application and N-API bridge initialized, but Sparkle refused the update
with its native warning that an application running from a download location
must be moved to Applications. The bridge state settled to `error` with
`sessionInProgress: false`. No update archive was downloaded and no application
was replaced.

The startup-failure test used a valid, correctly signed 1.0.4 archive. Sparkle
installed it, relaunched it, and the test application deliberately exited with
code 86 before showing a window. Sparkle did not restore 1.0.3. After the
failure marker was removed, the same installed 1.0.4 application launched
normally.

The installed 1.0.4 bundle passed strict code-signature verification and its
`app.asar` SHA-256 was:

`3c855442a273c3039631329a5c313ad1d9887d734d75083ab84a731275dd5d00`

### Important limitation: trusted publisher input

Sparkle's EdDSA signature authenticates the archive selected by the publisher.
It does not independently enforce this project's expected bundle identifier.
A deliberately mispackaged but correctly signed test archive was accepted.

For this reason the bundle validator is a required release gate before the
private signing key is used. The signing workflow must refuse any unexpected
bundle identifier, missing `app.asar`, missing bridge/framework, version
mismatch, escaping symlink, or invalid code signature.

### Important limitation: launch success is not an automatic rollback signal

Sparkle owns installation and relaunch, but it does not treat an immediate
application exit as proof that the update must be rolled back. The formal
product must not promise automatic rollback after an application-level startup
failure. Release validation, a complete packaged-app smoke test, and a
non-destructive database migration policy remain the primary safeguards.

### Ad-hoc signature behavior

Sparkle's log reported that the old and new ad-hoc code-signature hashes did not
match. That is expected because an ad-hoc signature has no stable Developer ID
identity and its cdhash changes when the application contents change. Sparkle
then verified the update archive's EdDSA signature and completed installation.

The observed trust boundary is therefore:

- ad-hoc signing keeps the Electron bundle and nested native code internally
  consistent for macOS;
- Sparkle EdDSA authenticates the published update archive;
- the protected release gate prevents a valid project signature from being
  applied to a semantically invalid application bundle.

## Sparkle log evidence

The relevant system and Sparkle logs showed:

- each archive was extracted using macOS `ditto`;
- `EdDSA signature is correct for update` before installation;
- an ad-hoc cdhash mismatch warning between application versions;
- normal helper termination after successful replacement and relaunch;
- a localized read-only/temporary-location error for both the mounted DMG and
  App Translocation tests;
- the deliberate 1.0.4 startup failure, followed by no Sparkle rollback.

No terminal process, custom replacement script, Squirrel ShipIt process, or
formal Debate Studio process participated in the three successful upgrades.

## Automated verification

- isolated bundle-validator tests: 4 passed
- N-API bridge compilation against Electron 35.7.5: passed
- packaged 1.1.0 bridge smoke test: passed; the complete app returned
  `bridgeReady: true` and all phase/download state fields
- formal project test suite: 60 files, 352 tests passed
- formal TypeScript checks: passed
- formal production build: passed
- strict deep code-signature verification: passed after A → B, B → C, C → D,
  and on the deliberately failing-startup 1.0.4 bundle

The formal version, formal updater path, formal application bundle, and formal
user data were not modified by this experiment.

## Known limitations

- Ad-hoc signing does not provide Apple Developer ID identity or notarization.
  First installation remains subject to normal macOS Gatekeeper behavior.
- Sparkle authenticates the publisher-signed archive but does not substitute for
  the project's bundle-content release gate.
- Sparkle does not automatically roll back when a newly installed application
  exits during startup.
- Updates are intentionally refused from read-only DMGs and App Translocation.
- This experiment validated arm64 full ZIP updates only. Delta updates and other
  architectures were not tested.
- The local validation feed used HTTP loopback only. A production appcast must
  use stable HTTPS hosting.

## Recommendation

The required three consecutive real upgrades succeeded and the requested
failure boundaries were exercised. Proceeding to a formal mainline Sparkle
migration is recommended, but it should be a separate implementation task, not
a direct copy of the experiment.

The mainline migration must:

1. keep Sparkle as the only macOS replacement and relaunch mechanism;
2. retain the exact-version N-API bridge and pinned Sparkle supply chain;
3. require the bundle validator before the private EdDSA key can sign a release;
4. run a packaged-application startup smoke test before publishing;
5. clearly state that startup-crash rollback is not automatic;
6. keep the existing manual DMG path as the first-install and recovery path;
7. use the native Sparkle UI for the first production rollout before reconnecting
   the current custom update settings interface.
