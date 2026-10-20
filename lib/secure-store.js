/**
 * lib/secure-store.js — Almacén cifrado (AES-256-GCM + PBKDF2-SHA256).
 *
 * ─────────────────────────────────────────────────────────────────────
 * El registry (datos de clientes: nombre, license_key, historial) NO puede
 * vivir en claro dentro de un repo. Se cifra con la misma passphrase que
 * protege la clave privada de emisión.
 *
 * Formato del archivo (JSON legible, un solo objeto):
 * {
 *   "format": "posky-secure-store",
 *   "version": 1,
 *   "kdf":    { "algo": "pbkdf2-sha256", "iterations": 310000, "salt": "<b64>" },
 *   "cipher": { "algo": "aes-256-gcm", "iv": "<b64>", "tag": "<b64>" },
 *   "data":   "<b64 ciphertext>"
 * }
 *
 * - PBKDF2-SHA256 con salt aleatorio de 16 bytes y 310k iteraciones.
 * - AES-256-GCM → confidencialidad + integridad (el tag detecta manipulación).
 * - El `iv` es aleatorio por escritura; reutilizarlo con la misma clave
 *   rompería el GCM, por eso se genera en cada `encrypt`.
 * ─────────────────────────────────────────────────────────────────────
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FORMAT = 'posky-secure-store';
const VERSION = 1;
const KDF_ITERATIONS = 310000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;

function deriveKey(passphrase, salt, iterations) {
  return crypto.pbkdf2Sync(
    Buffer.from(String(passphrase), 'utf8'),
    salt,
    iterations,
    KEY_BYTES,
    'sha256',
  );
}

/**
 * Cifra un string y devuelve el sobre listo para escribir en disco.
 *
 * @param {string} plaintext
 * @param {string} passphrase
 * @returns {object} Sobre JSON
 */
function encrypt(plaintext, passphrase) {
  if (!passphrase) throw new Error('Se necesita la passphrase para cifrar.');

  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const key = deriveKey(passphrase, salt, KDF_ITERATIONS);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([
    cipher.update(Buffer.from(String(plaintext), 'utf8')),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    format: FORMAT,
    version: VERSION,
    kdf: { algo: 'pbkdf2-sha256', iterations: KDF_ITERATIONS, salt: salt.toString('base64') },
    cipher: { algo: 'aes-256-gcm', iv: iv.toString('base64'), tag: tag.toString('base64') },
    data: data.toString('base64'),
  };
}

/**
 * Descifra un sobre y devuelve el string en claro.
 *
 * @param {object} envelope — Objeto devuelto por `encrypt` (o parseado del disco)
 * @param {string} passphrase
 * @returns {string}
 */
function decrypt(envelope, passphrase) {
  if (!envelope || envelope.format !== FORMAT) {
    throw new Error('Formato de archivo cifrado desconocido o corrupto.');
  }
  if (envelope.version !== VERSION) {
    throw new Error(`Versión de archivo cifrado no soportada: ${envelope.version}`);
  }
  if (!passphrase) throw new Error('Se necesita la passphrase para descifrar.');

  const salt = Buffer.from(envelope.kdf.salt, 'base64');
  const iterations = envelope.kdf.iterations || KDF_ITERATIONS;
  const key = deriveKey(passphrase, salt, iterations);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.cipher.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.cipher.tag, 'base64'));

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Passphrase incorrecta o archivo cifrado manipulado.');
  }
}

/** Escribe un sobre cifrado en disco (con permisos 0600). */
function writeEnvelope(filePath, envelope) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(envelope, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    /* best-effort: en Windows los permisos POSIX no aplican */
  }
}

/** Lee un sobre cifrado de disco. Devuelve null si el archivo no existe. */
function readEnvelope(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw new Error(`No se pudo leer ${filePath}: ${e.message}`);
  }
}

module.exports = {
  FORMAT,
  VERSION,
  KDF_ITERATIONS,
  encrypt,
  decrypt,
  writeEnvelope,
  readEnvelope,
};
