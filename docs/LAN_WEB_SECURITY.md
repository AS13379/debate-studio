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

Phase A intentionally uses HTTP and no access password. It does not protect against another device on the same LAN, passive sniffing, or an active attacker already present on the network. Passwordless LAN mode must not be enabled on public or untrusted Wi-Fi. A future HTTPS or paired-device mode may be added without changing the application-service boundary.

## Non-goals for Phase A

The console cannot create debates, configure credentials, upload files, inspect private research, restore databases, access diagnostics, export files, or expose local filesystem paths. Sessions are intentionally invalidated when the server stops or Debate Studio exits.
