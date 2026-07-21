# Debate Studio v0.5.0

## Highlights

- Replaces the unsigned Squirrel.Mac installer with a Debate Studio project-signed community updater.
- Verifies Ed25519 signatures, SHA256, package size, architecture, version and Bundle ID before installation.
- Automatically backs up and restores the previous app if the new version cannot launch.
- Keeps SQLite data, model configuration, prompts, API credentials, debate history and research data unchanged.
- Adds explicit download, verification, installation, rollback and cache status in Settings.

## Upgrade notice

Versions v0.4.9 and earlier require one final manual DMG installation of v0.5.0. In-app community updates are available starting with v0.5.0.

The macOS build is not signed or notarized with Apple Developer ID. Debate Studio's Ed25519 signature verifies the origin and integrity of update packages; it does not bypass Gatekeeper.

## Privacy

The updater only contacts this repository's GitHub Releases. It does not read or upload API keys, local databases, debate content, research material, logs or user identity.
