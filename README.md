# Session Token Sample App for Inworld API

This sample Node.js application mints a **multi-use session JWT** from your API key for client-side TTS/STT requests. The API key stays on the server; hand the `token` to your frontend or curl.

The entire implementation is in [`src/index.ts`](src/index.ts).

## Overview

Authentication has two steps:

1. Generate an HMAC-SHA256 signed authorization header from your API key
2. Call Inworld's token endpoint to receive a session JWT

```
Backend (this app)                    Client (browser / curl)
     |                                       |
     |  HMAC sign + POST token:generate      |
     |  ← session JWT                          |
     |  ──────────────────────────────────→  |  Authorization: Bearer <token>
     |                                       |  → Inworld TTS v1 API
```

## Prerequisites

- Node.js (v18+ recommended for native fetch in other examples)
- npm or yarn
- Valid Inworld API credentials from [Inworld Portal](https://platform.inworld.ai/api-keys)

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env` file:

   ```env
   INWORLD_API_KEY=your_base64_api_key_from_portal
   INWORLD_HOST=api.inworld.ai
   ```

   Optional:

   ```env
   INWORLD_ENGINE_HOST=api-engine.inworld.ai
   INWORLD_WORKSPACE=your-workspace-id
   INWORLD_KEY=your_key_id
   INWORLD_SECRET=your_key_secret
   ```

   `INWORLD_API_KEY` is the Base64 credential copied from the Portal (encode of `key:secret`). Alternatively, set `INWORLD_KEY` and `INWORLD_SECRET` separately.

## Build and run

```bash
npm run build
npm start
```

JSON-only output for scripting:

```bash
node dist/index.js --json-only
```

## Token response

```json
{
  "token": "eyJ...",
  "type": "Bearer",
  "expirationTime": "2026-09-15T15:05:57Z",
  "sessionId": "your-workspace:uuid"
}
```

The token is valid until `expirationTime` (typically a few hours). Session tokens are **multi-use** — the same token can authenticate many API calls until it expires.

## Export and test with curl

From the project directory, in the **same terminal session**:

```bash
export INWORLD_JWT=$(node dist/index.js --json-only | jq -r '.token')
echo "JWT length: ${#INWORLD_JWT}"
```

Verify the length is ~1400+ (not `0`).

### List TTS v1 voices

```bash
curl -s "https://api.inworld.ai/tts/v1/voices" \
  -H "Authorization: Bearer $INWORLD_JWT" \
  -H "Content-Type: application/json" | jq .
```

### Synthesize speech

Use the **TTS v1 API** with the **TTS-2 model** (`inworld-tts-2`):

```bash
curl -s -X POST "https://api.inworld.ai/tts/v1/voice" \
  -H "Authorization: Bearer $INWORLD_JWT" \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello, world!","voiceId":"Ashley","modelId":"inworld-tts-2"}' \
  --output speech.json
```

The response is JSON with base64-encoded audio, not a raw WAV file. Decode it:

```bash
jq -r '.audioContent' speech.json | base64 -d > speech.wav
afplay speech.wav   # macOS
```

One-liner (synthesize + decode + play on macOS):

```bash
curl -s -X POST "https://api.inworld.ai/tts/v1/voice" \
  -H "Authorization: Bearer $INWORLD_JWT" \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello, world!","voiceId":"Ashley","modelId":"inworld-tts-2"}' \
  | jq -r '.audioContent' | base64 -d > speech.wav && afplay speech.wav
```

### Use in JavaScript (frontend / client)

```javascript
const response = await fetch('https://api.inworld.ai/tts/v1/voices', {
  headers: {
    Authorization: 'Bearer YOUR_SESSION_TOKEN',
    'Content-Type': 'application/json',
  },
});
```

In production, your backend mints the token and the client fetches it from an endpoint such as `/api/tts-token` — never expose `INWORLD_API_KEY` in the browser.

## API vs model version

| Name | Meaning | Example |
| --- | --- | --- |
| TTS **v1 API** | REST endpoint path | `/tts/v1/voices`, `/tts/v1/voice` |
| **TTS-2 model** | Speech generation model | `"modelId": "inworld-tts-2"` |

The deprecated `tts/v1alpha` paths are removed. Use `/tts/v1/...` with `inworld-tts-2` or `inworld-tts-2-flash`.

## Implementation

Token mint request (from `src/index.ts`):

```typescript
const response = await axios.post<JwtTokenResponse>(
  `https://${host}/auth/v1/tokens/token:generate`,
  {
    key: apiKey,
    resources: resolveResources(),
  },
  {
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
  }
);
```

Endpoint:

```
POST https://api.inworld.ai/auth/v1/tokens/token:generate
```

Request body:

```json
{
  "key": "your_api_key_id",
  "resources": []
}
```

If `INWORLD_WORKSPACE` is set, `resources` becomes `["workspaces/your-workspace-id"]`.

## Signature generation

Requests to the token endpoint are authenticated with HMAC-SHA256, not the raw API key:

```
Authorization: IW1-HMAC-SHA256 ApiKey=...,DateTime=YYYYMMDDHHMMSS,Nonce=...,Signature=...
```

Signature parameters (in order):

1. DateTime (`YYYYMMDDHHMMSS` UTC)
2. Host (`api-engine.inworld.ai`, without port)
3. Method (`ai.inworld.engine.WorldEngine/GenerateToken`)
4. Nonce (random hex string)

Algorithm:

```typescript
let signature = `IW1${secret}`;
for (const param of [datetime, host, method, nonce]) {
  signature = HmacSHA256(param, signature);
}
signature = HmacSHA256('iw1_request', signature);
```

## Troubleshooting

### `SESSION_TOKEN_INVALID`

- Re-mint and re-export in the **same terminal**:
  ```bash
  export INWORLD_JWT=$(node dist/index.js --json-only | jq -r '.token')
  ```
- Do not use `head -1 | jq` on `npm start` output — the JSON is multi-line.
- Check `echo ${#INWORLD_JWT}` — must not be `0`.
- Token may have expired — check `expirationTime` and run `npm start` again.

### `TTS v1alpha API has been removed`

Use `/tts/v1/voices` and `/tts/v1/voice`, not `/tts/v1alpha/...`.

### `invalid authorization signature` (403 on mint)

- Verify `INWORLD_API_KEY` in `.env` is the full Base64 string from the Portal.
- Ensure the key has not been revoked in [Inworld Portal](https://platform.inworld.ai/api-keys).

### `authentication is required` when loading env vars in shell

Use a space in `cut`:

```bash
export INWORLD_API_KEY=$(grep '^INWORLD_API_KEY=' .env | cut -d= -f2)
```

Not `cut -d=-f2`.

## References

- [Inworld TTS documentation](https://docs.inworld.ai/tts/get-started)
- [Session tokens](https://docs.inworld.ai/portal/session-tokens)
- [TTS models](https://docs.inworld.ai/tts/tts-models)
