/**
 * tools/lib/licenseLib.js — Biblioteca compartida para firmar/verificar licencias Ed25519.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Qué hace este módulo:
 *   - loadPrivateKey(passphrase): desencripta la clave privada cifrada con AES-256-CBC
 *     usando el passphrase de LIC_PASS (nunca hardcodeado).
 *   - signLicense(payload, privateKey): produce "base64url(payload_json).base64url(firma)".
 *   - verifyLicense(licString, publicKeyPem): verifica la firma Ed25519 y devuelve
 *     { valid, payload }. Usado tanto por las herramientas (issue/renew) como por
 *     pos-server (verificación de arranque).
 *   - readLicense(licString): decodifica el payload SIN verificar (para inspección).
 *   - generateLicenseId(): genera "LIC-{año}-{6 dígitos}".
 *   - today(), inOneYear(from): helpers de fechas ISO.
 *
 * Formato del .lic:  base64url(JSON_payload).base64url(Ed25519_signature)
 * El payload incluye license_key para enlazar la licencia al tenant en la BD.
 * ─────────────────────────────────────────────────────────────────────
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** Versión del esquema de licencia (cambiar si el formato cambia). */
const LICENSE_SCHEMA_VERSION = 1;

/** Años de vigencia por defecto al emitir una nueva licencia. */
const DEFAULT_LICENSE_YEARS = 1;

/** Días de gracia tras detectar retroceso de reloj. */
const CLOCK_ROLLBACK_GRACE_DAYS = 7;

/** Días de gracia tras fingerprint mismatch. */
const FINGERPRINT_GRACE_DAYS = 15;

/** Días de aviso antes del vencimiento. */
const EXPIRY_WARNING_DAYS = 30;
/** Días de aviso crítico antes del vencimiento. */
const EXPIRY_CRITICAL_DAYS = 7;

/**
 * Carga la clave privada Ed25519 desde un archivo PEM cifrado con AES-256-CBC.
 * El passphrase viene de process.env.LIC_PASS (nunca hardcodeado).
 *
 * @param {string} pemPath — Ruta al archivo .enc.pem (default: keys/mipos_private.enc.pem)
 * @param {string} passphrase — Passphrase de desencriptación (de LIC_PASS)
 * @returns {crypto.KeyObject} Clave privada lista para firmar
 */
function loadPrivateKey(passphrase, pemPath) {
  const pem = fs.readFileSync(pemPath || path.join(__dirname, '../keys/mipos_private.enc.pem'), 'utf8');
  return crypto.createPrivateKey({ key: pem, passphrase });
}

/**
 * Carga la clave pública Ed25519 desde un archivo PEM sin cifrar.
 *
 * @param {string} pemPath — Ruta al archivo .pem público
 * @returns {crypto.KeyObject} Clave pública lista para verificar
 */
function loadPublicKey(pemPath) {
  const pem = fs.readFileSync(pemPath || path.join(__dirname, '../keys/mipos_public.pem'), 'utf8');
  return crypto.createPublicKey({ key: pem, type: 'spki' });
}

/**
 * Firma un payload de licencia y produce el formato base64url.signature.
 * La serialización JSON usa la misma representación que el servidor usa para
 * comparar la firma (JSON.stringify estándar, sin espacios).
 *
 * @param {object} payload — Datos de la licencia
 * @param {crypto.KeyObject} privateKey — Clave Ed25519 cargada
 * @returns {string} Licencia firmada en formato "base64url(payload).base64url(signature)"
 */
function signLicense(payload, privateKey) {
  const data = Buffer.from(JSON.stringify(payload));
  const signature = crypto.sign(null, data, privateKey);
  return `${data.toString('base64url')}.${signature.toString('base64url')}`;
}

/**
 * Verifica la firma Ed25519 de una licencia y decodifica el payload.
 *
 * @param {string} licString — Licencia en formato "base64url(payload).base64url(signature)"
 * @param {crypto.KeyObject|string} publicKey — Clave pública o PEM string
 * @returns {{ valid: boolean, payload: object|null, error?: string }}
 */
function verifyLicense(licString, publicKey) {
  if (typeof licString !== 'string') {
    return { valid: false, payload: null, error: 'Input is not a string' };
  }

  const parts = licString.split('.');
  if (parts.length !== 2) {
    return { valid: false, payload: null, error: 'Formato incorrecto: se espera payload.signature' };
  }

  const [payloadB64, signatureB64] = parts;
  if (!payloadB64 || !signatureB64) {
    return { valid: false, payload: null, error: 'Payload o firma vacía' };
  }

  let data, signature;
  try {
    data = Buffer.from(payloadB64, 'base64url');
    signature = Buffer.from(signatureB64, 'base64url');
  } catch (e) {
    return { valid: false, payload: null, error: 'Error decodificando base64url' };
  }

  let pubKey;
  try {
    if (typeof publicKey === 'string') {
      pubKey = crypto.createPublicKey({ key: publicKey, type: 'spki' });
    } else {
      pubKey = publicKey;
    }
  } catch (e) {
    return { valid: false, payload: null, error: 'Clave pública inválida' };
  }

  const isValid = crypto.verify(null, data, pubKey, signature);
  if (!isValid) {
    return { valid: false, payload: null, error: 'Firma Ed25519 inválida' };
  }

  try {
    const payload = JSON.parse(data.toString('utf8'));
    return { valid: true, payload };
  } catch (e) {
    return { valid: false, payload: null, error: 'Payload no es JSON válido' };
  }
}

/**
 * Lee y decodifica el payload de una licencia SIN verificar la firma.
 * Útil para debugging e inspección.
 *
 * @param {string} licString — Licencia firmada
 * @returns {object} Payload decodificado
 */
function readLicense(licString) {
  const [b64] = licString.split('.');
  return JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
}

/**
 * Genera un ID único de licencia: LIC-{año}-{6 dígitos con padding}.
 * El contador se lee/incrementa en registry.json.
 *
 * @param {object} registry — Objeto del registry.json cargado
 * @returns {string} ID de licencia, e.g. "LIC-2026-000123"
 */
function generateLicenseId(registry) {
  const year = new Date().getFullYear();
  const yearKey = String(year);
  // Contador por año: buscamos el mayor número existente para este año
  let maxId = 0;
  for (const key of Object.keys(registry || {})) {
    const match = key.match(new RegExp(`^LIC-${year}-(\\d{6})$`));
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxId) maxId = n;
    }
  }
  const nextNum = maxId + 1;
  return `LIC-${year}-${String(nextNum).padStart(6, '0')}`;
}

/** Fecha ISO de hoy (UTC, formato fecha sola para el campo `issued`/`expires`). */
function today() {
  return new Date().toISOString().split('T')[0];
}

/** Fecha ISO un año después de `from` (o de hoy). */
function inOneYear(from) {
  const base = from ? new Date(from) : new Date();
  const d = new Date(base);
  d.setFullYear(d.getFullYear() + DEFAULT_LICENSE_YEARS);
  return d.toISOString();
}

/** Fecha ISO `days` días después de hoy. */
function daysFromNow(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/** Carga el registry.json (o crea uno vacío si no existe). */
function loadRegistry(registryPath) {
  const p = registryPath || path.join(__dirname, '../registry.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

/** Guarda el registry.json (con pretty-print para diffs limpios). */
function saveRegistry(registry, registryPath) {
  const p = registryPath || path.join(__dirname, '../registry.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(registry, null, 2) + '\n', 'utf8');
}

module.exports = {
  LICENSE_SCHEMA_VERSION,
  DEFAULT_LICENSE_YEARS,
  CLOCK_ROLLBACK_GRACE_DAYS,
  FINGERPRINT_GRACE_DAYS,
  EXPIRY_WARNING_DAYS,
  EXPIRY_CRITICAL_DAYS,
  loadPrivateKey,
  loadPublicKey,
  signLicense,
  verifyLicense,
  readLicense,
  generateLicenseId,
  today,
  inOneYear,
  daysFromNow,
  loadRegistry,
  saveRegistry,
};
