# Technical Doc: Encrypted Integration Secrets
Date: 2026-09-17 | Blueprint M1–M4

## Architecture
```
Admin UI (/admin section) ──POST──▶ /api/v1/admin/integrations (requireAdmin)
        │                                       │ validate (JWT shape + live 200) + redact
        ▼                                       ▼
IntegrationSecret table ──read──▶ src/lib/secrets.ts ──▶ session resolver
(key, AES-GCM blob, updatedAt)      ▲ fallback chain: DB → file → env
```

## Schema (`IntegrationSecret`)
- `key String @unique` — e.g. `stockbit_refresh_token`
- `encValue String` — `v1.<base64 iv>.<base64 ciphertext>.<base64 tag>`
- `updatedAt DateTime @updatedAt`
- No plaintext column exists by construction.

## Crypto (`src/lib/secrets.ts`, NEW — stdlib `node:crypto` only)
- `getMasterKey(): Buffer` — `SECRETS_MASTER_KEY` env, 64-hex-chars (32 bytes). Throws actionable error when absent/malformed. Never logged.
- `encryptSecret(plain): string` / `decryptSecret(blob): string` — AES-256-GCM, 12-byte random IV per write.
- `readSecret(key): Promise<string|null>` / `writeSecret(key, plain): Promise<void>`.
- Resolver rewire (`idx-stockbit/session.ts`): precedence DB → `data/stockbit-session.json` → env. Rotation writes back to DB when the row exists (else file, preserving current standalone behavior).

## API contract (`POST /api/v1/admin/integrations`, `GET` list)
- Auth: `requireAdmin` (Bearer or nexus-session cookie + role=admin). Non-admin → 403, no existence oracle (same 403 for missing/invalid auth).
- POST body: `{ key: 'stockbit_refresh_token', value: '<jwt>' }`.
- Validation BEFORE save: JWT 3-segment shape; live `POST exodus/login/refresh` must 200 (proves the token works without spending rotation budget — note: refresh ROTATES, so validation consumes one rotation; documented in UI copy).
- Response: `{ ok: true, key, updatedAt }` — echo NEVER includes the value.
- GET list: `[{ key, updatedAt, healthy: bool, lastError: string|null }]` — health from a lightweight check (never the secret).
- Logging: all error paths pass through `redactJwt`; the value never reaches disk unencrypted, logs, or responses.

## Validation-rotation caveat (honest)
Validating a refresh token via `/login/refresh` spends one rotation (old RT retired, new RT returned). The API therefore SAVES the rotated pair on success — validation and staging are one atomic step. UI copy states this. There is no read-only validity check for a Stockbit RT; this is upstream behavior, not our choice.

## Migration
`add_integration_secrets_*/migration.sql` — CREATE IF NOT EXISTS + IF-NOT-EXISTS unique guard (repo convention), + down.sql.
