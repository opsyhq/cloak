<p align="center">
  <h1 align="center">Cloak</h1>
  <p align="center"><strong>One-time secret sharing for humans & agents.</strong></p>
  <p align="center">
    AES-256-GCM encrypted, zero-knowledge in the browser,<br/>
    self-destructing after one read.
  </p>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@opsyhq/cloak"><img src="https://img.shields.io/npm/v/@opsyhq/cloak" alt="npm version"></a>
  <a href="https://github.com/opsyhq/cloak/blob/main/LICENSE"><img src="https://img.shields.io/github/license/opsyhq/cloak" alt="license"></a>
  <a href="https://github.com/opsyhq/cloak/actions/workflows/deploy.yml"><img src="https://github.com/opsyhq/cloak/actions/workflows/deploy.yml/badge.svg" alt="deploy"></a>
</p>

<p align="center">
  <a href="https://cloak.opsy.sh">Live App</a> ·
  <a href="#quickstart">Quickstart</a> ·
  <a href="#api">API</a> ·
  <a href="#cli">CLI</a> ·
  <a href="#for-ai-agents">For AI Agents</a> ·
  <a href="#self-hosting">Self-Hosting</a>
</p>

---

You need to send someone an API key, database password, or token. You can't put it in Slack, email, or a terminal log — it'll live there forever.

**Cloak creates encrypted, self-destructing secret links.** Share the link. It works once. Then the secret is permanently destroyed.

```
https://cloak.opsy.sh/s/W9ZEykcG#8g9I3UUBjH3x4kdL
                       ^^^^^^^^ ^^^^^^^^^^^^^^^^
                       ID        key (never sent to server)
```

> **Zero-knowledge in the browser.** The encryption key stays in the URL fragment — browsers never send it to the server. The server only stores an encrypted blob it can't read.

## Quickstart

### Browser

Open [cloak.opsy.sh](https://cloak.opsy.sh). Paste your secret. Get a link. Share it.

### curl

```bash
# Create — secret from env var, never touches shell history
curl -s -X POST https://cloak.opsy.sh/api/secrets \
  -H "Content-Type: application/json" \
  -d "{\"secret\":\"$MY_SECRET\"}"
# → {"id":"W9ZEykcG","key":"8g9I3UUBjH3x4kdL","url":"https://cloak.opsy.sh/s/W9ZEykcG#8g9I3UUBjH3x4kdL"}

# Retrieve — straight to env var, never printed
export MY_SECRET=$(curl -s -H "X-Cloak-Key: 8g9I3UUBjH3x4kdL" \
  "https://cloak.opsy.sh/api/secrets/W9ZEykcG" | jq -r .secret)
```

### CLI

```bash
# Create (reads from stdin)
echo "$SECRET" | npx @opsyhq/cloak create
echo "$SECRET" | npx @opsyhq/cloak create --ttl 1h

# Retrieve
npx @opsyhq/cloak get "https://cloak.opsy.sh/s/W9ZEykcG#8g9I3UUBjH3x4kdL"

# Retrieve as export statement
npx @opsyhq/cloak get "https://cloak.opsy.sh/s/W9ZEykcG#8g9I3UUBjH3x4kdL" --env
# → export SECRET='the-value'
```

## How It Works

```
Browser (zero-knowledge)              Server (Hono + CF Workers)         D1
  │                                      │                               │
  ├─ generate ID + passphrase            │                               │
  ├─ HKDF(passphrase, ID) → AES key     │                               │
  ├─ AES-256-GCM encrypt                │                               │
  ├─ POST {id, encryptedData, iv} ─────→ store blob ───────────────────→ │
  │                                      │                               │
  ├─ GET /api/secrets/:id ─────────────→ atomic delete + return blob ──→ │
  ├─ HKDF(passphrase, ID) → AES key     │                               │
  ├─ AES-256-GCM decrypt                │                               │
  └─ display secret                      │                               │

curl / Agent (server-assisted)
  │                                      │                               │
  ├─ POST {secret} ───────────────────→  generate ID + passphrase        │
  │                                      HKDF → encrypt → store ───────→ │
  │ ← {id, key, url} ──────────────────                                  │
  │                                      │                               │
  ├─ GET /api/secrets/:id ─────────────→ atomic delete + decrypt ──────→ │
  │  X-Cloak-Key: passphrase            │                               │
  │ ← {secret} ────────────────────────                                  │
```

**Browser flow** — true zero-knowledge. The server never sees the plaintext or the encryption key.

**curl/agent flow** — server assists with encryption. Plaintext is sent over TLS and processed transiently, never stored. For true zero-knowledge from the terminal, use the CLI with client-side encryption.

## API

### `POST /api/secrets`

Create a secret. Two modes:

<details open>
<summary><strong>Server-encrypt (curl/agent)</strong></summary>

```bash
curl -s -X POST https://cloak.opsy.sh/api/secrets \
  -H "Content-Type: application/json" \
  -d '{"secret":"sk-abc123", "expiresIn": 3600}'
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `secret` | string | required | The secret (max 10,000 chars) |
| `expiresIn` | number | 86400 | TTL in seconds (min 60, max 604800) |

Response:
```json
{
  "id": "W9ZEykcG",
  "key": "8g9I3UUBjH3x4kdL",
  "url": "https://cloak.opsy.sh/s/W9ZEykcG#8g9I3UUBjH3x4kdL",
  "expiresAt": 1710000000
}
```
</details>

<details>
<summary><strong>Client-encrypt (browser, zero-knowledge)</strong></summary>

```bash
curl -s -X POST https://cloak.opsy.sh/api/secrets \
  -H "Content-Type: application/json" \
  -d '{"id":"AbCdEfGh", "encryptedData":"base64url...", "iv":"base64url...", "expiresIn": 3600}'
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | required | Client-generated ID (6-16 alphanumeric) |
| `encryptedData` | string | required | Base64url ciphertext |
| `iv` | string | required | Base64url IV |
| `expiresIn` | number | 86400 | TTL in seconds |

Response: `{ "id": "AbCdEfGh", "expiresAt": 1710000000 }`

Returns `409` on ID collision — retry with a new ID.
</details>

### `GET /api/secrets/:id`

Retrieve and destroy a secret.

**With key (server decrypts):**
```bash
curl -s -H "X-Cloak-Key: 8g9I3UUBjH3x4kdL" \
  "https://cloak.opsy.sh/api/secrets/W9ZEykcG"
# → {"secret":"sk-abc123"}
```

**Without key (returns encrypted blob for client-side decryption):**
```bash
curl -s "https://cloak.opsy.sh/api/secrets/W9ZEykcG"
# → {"encryptedData":"...","iv":"..."}
```

The secret is atomically deleted upon retrieval. Returns `404` if not found, expired, or already read. Returns `403` if the key is wrong.

### `DELETE /api/secrets/:id`

Destroy a secret without reading it. Requires the key.

```bash
curl -s -X DELETE -H "X-Cloak-Key: 8g9I3UUBjH3x4kdL" \
  "https://cloak.opsy.sh/api/secrets/W9ZEykcG"
# → {"ok":true}
```

## CLI

```bash
npx @opsyhq/cloak <command>
```

| Command | Description |
|---------|-------------|
| `create [--ttl 1h]` | Read secret from stdin, print URL |
| `get <url>` | Retrieve secret, print to stdout |
| `get <url> --env` | Print as `export SECRET='...'` |

Set `CLOAK_URL` to use a self-hosted instance.

## For AI Agents

When an agent receives a Cloak URL:

1. **Parse the URL** — ID is the path after `/s/`, key is the fragment after `#`
2. **Call the API** — `curl -s -H "X-Cloak-Key: KEY" "https://cloak.opsy.sh/api/secrets/ID"`
3. **Never display the secret** — pipe it to a file, env var, or command. Never echo it in conversation.

The Cloak reveal page embeds agent instructions in a hidden DOM element and supports `Accept: application/json` content negotiation for structured retrieval instructions.

<details>
<summary><strong>OpenClaw / ClawHub</strong></summary>

**Skill** — published to [ClawHub](https://clawhub.ai) as `cloak`. Teaches agents to use the API via curl.

```bash
clawhub install cloak
```

**Plugin** — `plugin/` provides `cloak_create` and `cloak_get` as native agent tools.

**Secret Provider** — `cli/openclaw-resolver.ts` acts as an `exec` provider for injecting secrets into agent environments without them appearing in conversation.

```json
{
  "source": "exec",
  "provider": "cloak",
  "command": "cloak-resolver",
  "passEnv": ["CLOAK_URL"]
}
```
</details>

## Security

- **AES-256-GCM** with HKDF-SHA256 key derivation (96-bit passphrase entropy)
- **Zero-knowledge browser flow** — server never sees plaintext or key
- **Atomic one-time read** — `DELETE ... RETURNING` prevents race condition double-reads
- **Authenticated delete** — requires the encryption key
- **CORS restricted** — API only accepts requests from the app's origin
- **No crawling** — `robots.txt`, `X-Robots-Tag` headers, `noindex` meta tags
- **Auto-expiry** — hourly cleanup via Cloudflare Cron Triggers

## Self-Hosting

```bash
git clone https://github.com/opsyhq/cloak
cd cloak
bun install

# Create D1 database
bunx wrangler d1 create cloak-db
# Copy database_id into wrangler.toml

# Apply schema
bun run db:init

# Dev
bun run dev

# Deploy
bun run deploy
```

Set your custom domain in `wrangler.toml`:
```toml
[vars]
BASE_URL = "https://secrets.yourdomain.com"
```

---

<p align="center">
  Built by <a href="https://github.com/opsyhq"><strong>OpsyHQ</strong></a> · Apache-2.0 License
</p>
