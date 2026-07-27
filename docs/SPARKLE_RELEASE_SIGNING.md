# Sparkle release signing secrets

Sparkle EdDSA signing authenticates update archives published by Debate Studio.
The private key is a developer release secret. It is unrelated to user API
credentials, SQLite, `CredentialStore`, Apple Developer ID, and notarization.

The embedded Sparkle public key remains:

```text
n4G+b8A6touR/ytKrzrjEWXbaqhWcZpJMSt70eFa+ug=
```

Do not regenerate the key during a release. A different key would make existing
applications reject future updates.

## Local release signing

Keep the private key outside the repository:

```sh
mkdir -p "$HOME/Documents/DebateStudio-secrets"
chmod 700 "$HOME/Documents/DebateStudio-secrets"
chmod 600 "$HOME/Documents/DebateStudio-secrets/sparkle_private_key"
export SPARKLE_PRIVATE_KEY_FILE="$HOME/Documents/DebateStudio-secrets/sparkle_private_key"
npm run sparkle:key:check
```

The key file must:

- be an absolute, repository-external path;
- be a regular file rather than a symlink;
- use permission `600` or read-only `400`;
- contain the 32-byte Sparkle Ed25519 private key encoded as Base64;
- not be tracked by Git.

Release signing stops with a Chinese error if any check fails. The scripts never
read the Sparkle private key from macOS Keychain, never generate a replacement
key, and never silently create an unsigned appcast.

To sign a packaged ZIP and create an appcast:

```sh
node scripts/create-sparkle-appcast.mjs \
  --archive release/Debate-Studio-0.6.3-arm64.zip \
  --version 0.6.3 \
  --tag v0.6.3 \
  --output release/appcast.xml
```

The version and paths above are examples; use the package version and intended
release tag. The script explicitly passes `--ed-key-file` to Sparkle's pinned
`sign_update` tool.

## GitHub Actions

Configure the repository Actions Secret:

```text
SPARKLE_PRIVATE_KEY
```

Its value is the Base64 private-key file content. The macOS release workflow:

1. refuses to continue if the Secret is empty;
2. writes it to a mode-600 file under `RUNNER_TEMP`;
3. signs the ZIP and creates `appcast.xml`;
4. uploads only public release artifacts;
5. removes the temporary key in an `always()` cleanup step.

Workflow steps must not enable shell tracing or print the Secret. Private-key
files, their contents, and Keychain exports must never be uploaded as artifacts.

## End users

Users do not need a private key, a signing file, a password, or a Keychain
authorization prompt. The application contains only the public verification key.

This document prepares the release-side secret boundary. Enabling Sparkle as the
formal application updater remains a separate mainline integration decision.
