const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96 bits for AES-GCM
const PASSPHRASE_BYTES = 12; // 12 random bytes = 96 bits → 16 base64url chars

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Derive a full AES-256 key from a short passphrase + secret ID (as salt).
// This is how Privnote keeps URLs short while maintaining strong encryption.
async function deriveKey(
  passphrase: string,
  salt: string,
  usage: string[]
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "HKDF",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode(salt),
      info: new TextEncoder().encode("cloak-v1"),
    },
    baseKey,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    usage
  );
}

// Generate a short random passphrase (goes in the URL fragment)
export function generatePassphrase(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(PASSPHRASE_BYTES));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function encrypt(
  plaintext: string,
  passphrase: string,
  secretId: string
): Promise<{ encryptedData: string; iv: string }> {
  const key = await deriveKey(passphrase, secretId, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    encoded
  );

  return {
    encryptedData: toBase64Url(ciphertext),
    iv: toBase64Url(iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength)),
  };
}

export async function decrypt(
  encryptedData: string,
  iv: string,
  passphrase: string,
  secretId: string
): Promise<string> {
  const key = await deriveKey(passphrase, secretId, ["decrypt"]);
  const cipherBytes = fromBase64Url(encryptedData);
  const ivBytes = fromBase64Url(iv);

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: ivBytes },
    key,
    cipherBytes
  );

  return new TextDecoder().decode(decrypted);
}
