/**
 * Inworld Session Token Generator
 *
 * Mints a multi-use session JWT from your API key for client-side TTS/STT requests.
 * The API key stays on the server; hand the token to the client.
 *
 * Example usage of the generated token:
 *
 * ```
 * const response = await fetch('https://api.inworld.ai/tts/v1/voices', {
 *   headers: {
 *     'Authorization': 'Bearer ...',
 *     'Content-Type': 'application/json'
 *   }
 * });
 * ```
 */
import * as crypto from 'crypto';
import { HmacSHA256 } from 'crypto-js';
import * as dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

interface ApiKey {
  key: string;
  secret: string;
}

interface JwtTokenResponse {
  token: string;
  expirationTime: string;
  type: string;
  sessionId?: string;
}

function resolveApiKey(): ApiKey {
  const basic = (process.env.INWORLD_API_KEY || '').trim();
  if (basic) {
    const decoded = Buffer.from(basic, 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    const key = idx > 0 ? decoded.slice(0, idx) : '';
    const secret = idx > 0 ? decoded.slice(idx + 1) : '';
    if (!key || !secret) {
      throw new Error('INWORLD_API_KEY must be base64 of "<key>:<secret>" (both parts non-empty)');
    }
    return { key, secret };
  }

  const key = (process.env.INWORLD_KEY || '').trim();
  const secret = (process.env.INWORLD_SECRET || '').trim();
  if (!key || !secret) {
    throw new Error(
      'Set INWORLD_API_KEY (Basic Base64 from the Studio API Keys panel) or both INWORLD_KEY and INWORLD_SECRET'
    );
  }
  return { key, secret };
}

function resolveResources(): string[] {
  const workspace = (process.env.INWORLD_WORKSPACE || '').trim();
  if (!workspace) return [];
  return [`workspaces/${workspace}`];
}

function getDateTime(): string {
  const parts = new Date().toISOString().split('T');
  const date = parts[0].replace(/-/g, '');
  const time = parts[1].replace(/:/g, '').substring(0, 6);
  return `${date}${time}`;
}

function getSignatureKey(key: string, params: string[]): string {
  let signature: string | CryptoJS.lib.WordArray = `IW1${key}`;

  params.forEach((p) => {
    signature = HmacSHA256(p, signature);
  });

  return HmacSHA256('iw1_request', signature).toString();
}

function getAuthorization({ apiKey, engineHost }: { apiKey: ApiKey; engineHost: string }): string {
  const { key, secret } = apiKey;
  const path = '/ai.inworld.engine.WorldEngine/GenerateToken';

  const datetime = getDateTime();
  const nonce = crypto.randomBytes(16).toString('hex').slice(1, 12);
  const method = path.substring(1);

  const signature = getSignatureKey(secret, [
    datetime,
    engineHost.replace(':443', ''),
    method,
    nonce,
  ]);

  return `IW1-HMAC-SHA256 ApiKey=${key},DateTime=${datetime},Nonce=${nonce},Signature=${signature}`;
}

function generateAuthHeader(): string {
  const apiKey = resolveApiKey();
  const engineHost = process.env.INWORLD_ENGINE_HOST || 'api-engine.inworld.ai';
  return getAuthorization({ apiKey, engineHost });
}

async function getJwtToken(): Promise<JwtTokenResponse> {
  const host = process.env.INWORLD_HOST || 'api.inworld.ai';
  const authHeader = generateAuthHeader();
  const apiKey = resolveApiKey().key;

  try {
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

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('API Error:', error.response?.data || error.message);
    } else {
      console.error('Error:', error);
    }
    throw error;
  }
}

async function main() {
  const jsonOnly = process.argv.includes('--json-only');

  try {
    const jwtToken = await getJwtToken();

    if (jsonOnly) {
      console.log(JSON.stringify(jwtToken));
      return;
    }

    console.log(JSON.stringify(jwtToken, null, 2));
    console.log('\nThis session token can be used to authenticate Inworld API requests.');
    console.log('Include it in your API requests as:');
    console.log(`Authorization: ${jwtToken.type} ${jwtToken.token.substring(0, 15)}...`);
    console.log('\nThe token expires at:', jwtToken.expirationTime);
    console.log('\nExport token for curl (recommended):');
    console.log("export INWORLD_JWT=$(node dist/index.js --json-only | jq -r '.token')");
    console.log('\nList TTS v1 voices:');
    console.log('curl -s "https://api.inworld.ai/tts/v1/voices" \\');
    console.log('  -H "Authorization: Bearer $INWORLD_JWT" \\');
    console.log('  -H "Content-Type: application/json" | jq .');
    console.log('\nSynthesize speech (response is JSON with base64 audioContent):');
    console.log('curl -X POST "https://api.inworld.ai/tts/v1/voice" \\');
    console.log('  -H "Authorization: Bearer $INWORLD_JWT" \\');
    console.log('  -H "Content-Type: application/json" \\');
    console.log("  -d '{\"text\":\"Hello, world!\",\"voiceId\":\"Ashley\",\"modelId\":\"inworld-tts-2\"}' \\");
    console.log('  --output speech.json');
  } catch (error) {
    console.error('Error in main:', error);
    process.exitCode = 1;
  }
}

main();
