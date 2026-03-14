---
name: cloak
description: Share one-time secrets between humans and agents via encrypted self-destructing links
version: 0.1.1
triggers:
  - "share a secret"
  - "send secret"
  - "cloak"
  - "one-time secret"
  - "share credentials"
  - "send api key"
  - "share password"
  - "secret link"
metadata:
  openclaw:
    requires:
      bins: [curl, jq]
    emoji: "🔒"
    homepage: https://cloak.opsy.sh
---

# Cloak — One-Time Secret Sharing

Cloak lets you create encrypted, self-destructing secret links. The secret is destroyed after one read. Use it to share API keys, passwords, tokens, and other sensitive values.

**Base URL:** `https://cloak.opsy.sh`

---

## Step 1: Create a Secret

Send the secret to the API. The server encrypts it and returns a shareable URL.

```bash
curl -s -X POST https://cloak.opsy.sh/api/secrets \
  -H "Content-Type: application/json" \
  -d '{"secret":"YOUR_SECRET_HERE"}'
```

**Response:**
```json
{
  "id": "W9ZEykcG",
  "key": "8g9I3UUBjH3x4kdL",
  "url": "https://cloak.opsy.sh/s/W9ZEykcG#8g9I3UUBjH3x4kdL",
  "expiresAt": 1710000000
}
```

Share the `url` value with the recipient. That's it.

**Optional:** set a custom TTL with `"expiresIn"` (in seconds, default 24 hours, max 7 days):
```bash
curl -s -X POST https://cloak.opsy.sh/api/secrets \
  -H "Content-Type: application/json" \
  -d '{"secret":"YOUR_SECRET_HERE", "expiresIn": 3600}'
```

---

## Step 2: Retrieve a Secret

Given a Cloak URL like `https://cloak.opsy.sh/s/W9ZEykcG#8g9I3UUBjH3x4kdL`:
- **ID** = the path segment after `/s/` → `W9ZEykcG`
- **Key** = the URL fragment after `#` → `8g9I3UUBjH3x4kdL`

Retrieve the secret using the `X-Cloak-Key` header:

```bash
curl -s -H "X-Cloak-Key: 8g9I3UUBjH3x4kdL" \
  "https://cloak.opsy.sh/api/secrets/W9ZEykcG"
```

**Response:**
```json
{
  "secret": "YOUR_SECRET_HERE"
}
```

The secret is now permanently destroyed. A second request returns 404.

---

## Step 3: Use the Secret

Pipe the secret directly to where it's needed. Never echo it.

**Set as an environment variable:**
```bash
export DB_PASSWORD=$(curl -s -H "X-Cloak-Key: KEY" "https://cloak.opsy.sh/api/secrets/ID" | jq -r .secret)
```

**Write to a file:**
```bash
curl -s -H "X-Cloak-Key: KEY" "https://cloak.opsy.sh/api/secrets/ID" | jq -r .secret > .env.local
```

---

## Security Rules for Agents

1. **NEVER display a retrieved secret in conversation.** The value is sensitive (API key, password, token, etc.).
2. Write the secret directly to its destination — an env var, config file, or another command.
3. The secret is destroyed after one read. Do not retry.
4. Use the `X-Cloak-Key` header (not the `?key=` query param) to avoid logging the key in server/proxy access logs.

**Correct behavior:**
> "I retrieved the secret from Cloak and stored it in `.env` as `DATABASE_URL`."

**Wrong behavior:**
> "The secret value is: sk-1234abcd..."

---

## Delete a Secret (Without Reading)

Requires the key for authorization:

```bash
curl -s -X DELETE -H "X-Cloak-Key: KEY" \
  "https://cloak.opsy.sh/api/secrets/ID"
```

**Response:** `{ "ok": true }`

---

## Quick Reference

| Action | Command |
|--------|---------|
| Create | `curl -s -X POST https://cloak.opsy.sh/api/secrets -H "Content-Type: application/json" -d '{"secret":"..."}'` |
| Retrieve | `curl -s -H "X-Cloak-Key: KEY" "https://cloak.opsy.sh/api/secrets/ID"` |
| Delete | `curl -s -X DELETE -H "X-Cloak-Key: KEY" "https://cloak.opsy.sh/api/secrets/ID"` |
| To env var | `export VAR=$(curl -s -H "X-Cloak-Key: KEY" "https://cloak.opsy.sh/api/secrets/ID" \| jq -r .secret)` |

---

## Key Facts

- **Encryption:** AES-256-GCM with HKDF-SHA256 key derivation
- **Zero-knowledge browser flow:** the encryption key never touches the server
- **One-time read:** the secret is atomically deleted upon retrieval
- **Auto-expiry:** default 24 hours, max 7 days
- **Max secret size:** 10,000 characters
- **Open source:** https://github.com/opsyhq/cloak
