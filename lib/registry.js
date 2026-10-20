/**
 * lib/registry.js — Registry de licencias issued (cifrado en reposo).
 *
 * ─────────────────────────────────────────────────────────────────────
 * El registry guarda, por cada lic_id emitido:
 *   { customer, license_key, branch, current_expires, current_seats,
 *     status: 'active' | 'suspended', history: [{ action, ... }] }
 *
 * Vive cifrado en $POSKY_HOME/registry.json.enc con la passphrase de emisión.
 * Si todavía existe el registry plano heredado (tools-posky/registry.json),
 * se migra automáticamente al primer uso.
 * ─────────────────────────────────────────────────────────────────────
 */
const fs = require('fs');
const path = require('path');
const secureStore = require('./secure-store.js');
const paths = require('./paths.js');

/** Lee el registry cifrado. Devuelve {} si todavía no existe. */
function load(passphrase, registryPath) {
  const file = registryPath || paths.registryFile();
  const envelope = secureStore.readEnvelope(file);
  if (!envelope) return {};

  const plaintext = secureStore.decrypt(envelope, passphrase);
  try {
    return JSON.parse(plaintext);
  } catch {
    throw new Error(`El registry ${file} no contiene JSON válido.`);
  }
}

/** Escribe el registry cifrado. */
function save(registry, passphrase, registryPath) {
  const file = registryPath || paths.registryFile();
  const envelope = secureStore.encrypt(JSON.stringify(registry, null, 2) + '\n', passphrase);
  secureStore.writeEnvelope(file, envelope);
  return file;
}

/**
 * Migra el registry plano heredado (tools-posky/registry.json) al formato
 * cifrado. No destructivo: el original se renombra a `.migrated`.
 *
 * @returns {{ migrated: boolean, from?: string, to?: string, count?: number }}
 */
function migrateLegacy(passphrase) {
  const legacy = paths.legacyRegistryFile();
  const target = paths.registryFile();

  if (fs.existsSync(target)) return { migrated: false };
  if (!fs.existsSync(legacy)) return { migrated: false };

  let plain = {};
  try {
    plain = JSON.parse(fs.readFileSync(legacy, 'utf8'));
  } catch {
    return { migrated: false };
  }

  const count = Object.keys(plain).length;
  if (count === 0) return { migrated: false };

  save(plain, passphrase, target);
  fs.renameSync(legacy, `${legacy}.migrated`);

  return { migrated: true, from: legacy, to: target, count };
}

/**
 * Migra los .lic emitidos desde la carpeta out/ heredada a la nueva.
 * Copia (no borra) para no perder nada.
 *
 * @returns {number} cantidad de archivos copiados
 */
function migrateLegacyOut() {
  const legacy = paths.legacyOutDir();
  const target = paths.outDir();

  if (!fs.existsSync(legacy)) return 0;
  if (path.resolve(legacy) === path.resolve(target)) return 0;

  let copied = 0;
  fs.mkdirSync(target, { recursive: true });
  for (const name of fs.readdirSync(legacy)) {
    if (!name.endsWith('.lic')) continue;
    const dest = path.join(target, name);
    if (fs.existsSync(dest)) continue;
    fs.copyFileSync(path.join(legacy, name), dest);
    copied += 1;
  }
  return copied;
}

module.exports = { load, save, migrateLegacy, migrateLegacyOut };
