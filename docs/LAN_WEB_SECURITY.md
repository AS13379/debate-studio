# LAN Web Console security model

The LAN Web Console is an optional local control surface. Debate Studio on macOS remains the only process that owns the database, model credentials, provider configuration, and runtime services.

## Trust boundary

The browser may request explicitly mapped, redacted DTOs through the local HTTP server. It cannot call repositories, read the credential vault, inspect local paths, or invoke arbitrary Electron IPC. The server never trusts proxy forwarding headers and does not configure UPnP, port forwarding, a tunnel, or a public listener service.

## Threats addressed

- unauthenticated devices on the same network;
- password guessing and abusive request rates;
- cross-site requests, DNS rebinding, forged Host or Origin values;
- unauthenticated WebSocket subscriptions;
- oversized or malformed request bodies;
- public-source requests reaching a machine with an exposed interface;
- accidental disclosure of API keys, credential references, cookies, local paths, or technical error details.

Controls include an encrypted random access password, opaque in-memory sessions, HttpOnly and SameSite cookies, synchronizer CSRF tokens, exact Host/Origin checks, private-address filtering, request and login rate limits, strict payload limits, security response headers, dedicated response DTOs, and redacted structured logging.

## HTTP limitation

Phase A intentionally uses HTTP to avoid self-signed certificate warnings. HTTP does not protect against passive sniffing or an active attacker already present on the trusted LAN. The feature must not be enabled on public Wi-Fi. A future HTTPS mode may be added without changing the application-service boundary.

## Non-goals for Phase A

The console cannot create debates, configure credentials, upload files, inspect private research, restore databases, access diagnostics, export files, or expose local filesystem paths. Sessions are intentionally invalidated when the server stops, the password changes, or Debate Studio exits.
