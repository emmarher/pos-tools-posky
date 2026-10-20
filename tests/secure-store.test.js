/**
 * tests/secure-store.test.js — Cifrado del registry.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const secureStore = require('../lib/secure-store.js');

test('encrypt/decrypt: round trip', () => {
  const secret = JSON.stringify({ 'LIC-2026-000001': { customer: 'Abarrotes' } });
  const envelope = secureStore.encrypt(secret, 'clave-fuerte-1234');
  assert.strictEqual(envelope.format, secureStore.FORMAT);
  assert.strictEqual(envelope.kdf.algo, 'pbkdf2-sha256');
  assert.strictEqual(envelope.cipher.algo, 'aes-256-gcm');
  assert.strictEqual(secureStore.decrypt(envelope, 'clave-fuerte-1234'), secret);
});

test('passphrase incorrecta → error', () => {
  const envelope = secureStore.encrypt('secreto', 'clave-buena-1234');
  assert.throws(() => secureStore.decrypt(envelope, 'clave-mala-9999'), /Passphrase incorrecta/);
});

test('manipulación del ciphertext → error (GCM detecta)', () => {
  const envelope = secureStore.encrypt('secreto', 'clave-buena-1234');
  const raw = Buffer.from(envelope.data, 'base64');
  raw[0] ^= 0xff;
  envelope.data = raw.toString('base64');
  assert.throws(() => secureStore.decrypt(envelope, 'clave-buena-1234'));
});

test('el IV es aleatorio en cada escritura', () => {
  const a = secureStore.encrypt('mismo texto', 'clave');
  const b = secureStore.encrypt('mismo texto', 'clave');
  assert.notStrictEqual(a.cipher.iv, b.cipher.iv);
  assert.notStrictEqual(a.kdf.salt, b.kdf.salt);
  assert.notStrictEqual(a.data, b.data);
});

test('el sobre NO contiene el texto en claro', () => {
  const envelope = secureStore.encrypt('Abarrotes La Esquina', 'clave');
  assert.ok(!JSON.stringify(envelope).includes('Abarrotes'));
});

test('formato desconocido → error', () => {
  assert.throws(() => secureStore.decrypt({ format: 'otro' }, 'clave'), /desconocido/);
});
