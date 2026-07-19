# LAN Web Console security model

The LAN Web Console is an optional local control surface. Debate Studio on macOS remains the only process that owns the database, model credentials, provider configuration, and runtime services.

## Trust boundary

The browser may request explicitly mapped, redacted DTOs through the local HTTP server. It cannot call repositories, read the credential vault, inspect local paths, or invoke arbitrary Electron IPC. The server never trusts proxy forwarding headers and does not configure UPnP, port forwarding, a tunnel, or a public listener service.

## Threats addressed

- untrusted devices on the same network when LAN mode is enabled;
- abusive request rates;
- cross-site requests, DNS rebinding, forged Host or Origin values;
- unauthenticated WebSocket subscriptions;
- oversized or malformed request bodies;
- public-source requests reaching a machine with an exposed interface;
- accidental disclosure of API keys, credential references, cookies, local paths, or technical error details.

The user explicitly chooses between `localhost` mode and passwordless LAN mode. Localhost mode binds to loopback and rejects non-loopback sources. LAN mode is deliberately frictionless: any device on the same private network can open and control the console. Controls still include opaque in-memory sessions, HttpOnly and SameSite cookies, synchronizer CSRF tokens, exact Host/Origin checks, source-address filtering, request rate limits, strict payload limits, security response headers, dedicated response DTOs, and redacted structured logging.

## HTTP limitation

The console intentionally uses HTTP and no access password. It does not protect against another device on the same LAN, passive sniffing, or an active attacker already present on the network. Passwordless LAN mode must not be enabled on public or untrusted Wi-Fi.

## Phase B media and export boundary

Phase B allows debate creation, read-only research/history views, image/PDF uploads, and Markdown/HTML exports through narrow application services. It does not expose repositories or local filesystem paths.

- Uploads accept only PNG, JPEG, GIF, WebP, and PDF content. The declared MIME type must match the file signature.
- Images are limited to 10 MiB and PDFs to 25 MiB. Filenames are reduced to their basename before the existing `AssetProcessor` stores them.
- The browser receives an asset ID and safe metadata, never the managed local path.
- Export records omit `filePath`. Completed files are streamed through an authenticated download route only after their path is verified to remain inside the managed export directory.
- API keys, credential references, provider authorization headers, diagnostics, database backup/restore, and arbitrary local files remain unavailable to the Web console.

Transient browser sessions are intentionally invalidated when the server stops or Debate Studio exits. These sessions exist only to support CSRF protection and WebSocket continuity; they are created automatically and are not device pairing or an account system.
