# Debate Studio Sparkle 2 isolated validation

This directory is an isolated macOS updater experiment. It deliberately uses:

- product name `Debate Studio Update Test`
- bundle identifier `com.leander.debatestudio.update-test`
- user data directory `debate-studio-update-test`
- a local-only update feed during validation
- a dedicated Sparkle EdDSA key read from an external file

It does not import Debate Studio application code, repositories, SQLite databases,
credentials, or settings. It must never replace `/Applications/Debate Studio.app`.

Pinned supply-chain inputs:

- Sparkle `2.9.4`
- Sparkle archive SHA-256
  `ce89daf967db1e1893ed3ebd67575ed82d3902563e3191ca92aaec9164fbdef9`
- audited reference implementation commit
  `Innei/electron-sparkle-updater@4662378b020b8b14cbade9a241345cb5946f8181`

The reference package is not installed. The minimal N-API bridge in this
directory is maintained as experiment source and links directly to the pinned
official Sparkle framework.

The bridge uses Sparkle's native update UI and exposes a polling snapshot for
Electron containing:

- update phase and localized error
- selected update version
- expected and received download bytes
- normalized download progress
- whether a session is active
- automatic-check preference

Generated keys, frameworks, native build output, packaged apps, feeds, archives,
logs and validation state are ignored by Git.

## Validation boundary

- The formal `/Applications/Debate Studio.app` is never read, replaced, or
  launched by this experiment.
- The test application uses
  `~/Library/Application Support/debate-studio-update-test` only.
- Test archives and feeds are generated below
  `/private/tmp/debate-studio-sparkle-validation`.
- The Sparkle private signing key stays in a repository-external file selected
  through `SPARKLE_PRIVATE_KEY_FILE`. Only the public key is embedded in the
  test application.

## Commands

```sh
npm test
./scripts/fetch-sparkle.sh
./scripts/build-native.sh
node scripts/build-test-version.mjs 1.0.0
SPARKLE_PRIVATE_KEY_FILE="$HOME/Documents/DebateStudio-secrets/sparkle_private_key" \
  ./scripts/make-appcast.sh 1.0.1
node scripts/feed-server.mjs
```

`build-test-version.mjs` validates the bundle identifier, version,
`app.asar`, Sparkle framework, N-API bridge, contained symlinks, and final
code signature before creating and signing a ZIP update. ZIP files are made
with `ditto -c -k --sequesterRsrc --keepParent`.
