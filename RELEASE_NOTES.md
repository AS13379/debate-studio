# Debate Studio v0.5.1

## Highlights

- Replaces the single research tool quota with a staged anti-loop policy.
- Limits repeated model decisions, searches, page reads and downloaded text during exploration without blocking local research finalization.
- Keeps note saving, claim drafting, evidence publication and normal research completion available after exploration limits are reached.
- Automatically publishes reliable full-text sources that the model explicitly recommended before automatic research completes.
- Adds Quick, Standard and Deep presets focused on waiting time and source coverage rather than API cost reduction.
- Persists research phase, anti-loop counters and completion reasons through SQLite migration v16.

## Compatibility

Existing research presets are migrated automatically. SQLite data, model configuration, prompts, API credentials, debate history and research records remain in the same local application data directory.

## Privacy

All debate and research data remains local. Debate Studio does not upload API keys, databases, debate content, research material, logs or user identity.

## macOS notice

This community build is not signed or notarized with Apple Developer ID. The in-app updater verifies update packages with the Debate Studio project's Ed25519 key and SHA256 before installation; it does not bypass Gatekeeper.
