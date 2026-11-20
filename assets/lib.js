/** Logic shared by the page and the sealing tool. No DOM here, so it is tested in Node. */

/** PBKDF2 rounds. High on purpose: with no server, a slow key is the only brake on guessing. */
export const ITERATIONS = 600_000;

/**
 * The code she types and the code the letter was sealed with are compared in this form:
 * letters and digits only, lower case. Capitals, spaces and punctuation never lock her out
 * (an iPhone keyboard swaps quotes and dashes, and can add a full stop on its own).
 */
export function normalizeCode(text) {
  return String(text ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const fromBase64 = (text) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

async function deriveKey(secret, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Locks any JSON content under a code: AES-256-GCM, key from PBKDF2-SHA256, a fresh salt and IV every time. */
export async function sealContent(payload, code, { iterations = ITERATIONS } = {}) {
  const secret = normalizeCode(code);
  if (!secret) throw new Error('The code needs at least one letter or digit.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(secret, salt, iterations);
  const plain = new TextEncoder().encode(JSON.stringify(payload));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  return { v: 1, iterations, salt: toBase64(salt), iv: toBase64(iv), data: toBase64(new Uint8Array(data)) };
}

/**
 * Opens what sealContent locked. A wrong code, or sealed data that was altered, fails the cipher's
 * own authentication check and rejects with err.code === 'wrong-code'. There is no separate
 * password check that could be attacked or skipped.
 */
export async function openSealed(sealed, code) {
  const wrong = (cause) => Object.assign(new Error('That code does not open the letter.', { cause }), { code: 'wrong-code' });
  const secret = normalizeCode(code);
  if (!secret) throw wrong();
  const key = await deriveKey(secret, fromBase64(sealed.salt), sealed.iterations);
  const iv = fromBase64(sealed.iv);
  const data = fromBase64(sealed.data);
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  } catch (cause) {
    throw wrong(cause);
  }
  return JSON.parse(new TextDecoder().decode(plain));
}
