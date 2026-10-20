/**
 * lib/paths.js — Resolución de rutas del toolkit.
 *
 * ─────────────────────────────────────────────────────────────────────
 * El toolkit tiene dos "hogares":
 *
 *   1. La CARPETA DEL REPO (tools-posky/) → código + claves (gitignored).
 *   2. POSKY_HOME (por defecto ~/.pos-posky) → datos locales y sensibles:
 *        registry.json.enc   (registry cifrado con la passphrase)
 *        out/                (archivos .lic emitidos)
 *        keys/               (opcional: copia de las claves privadas)
 *
 * Todo es sobreescribible por entorno para poder empaquetar el toolkit
 * más adelante (Etapa 3) sin tocar el código:
 *
 *   POSKY_HOME          — raíz de datos locales
 *   POSKY_KEYS_DIR      — carpeta de claves Ed25519
 *   POSKY_OUT_DIR       — carpeta de .lic emitidos
 *   POSKY_REGISTRY_FILE — archivo del registry cifrado
 * ─────────────────────────────────────────────────────────────────────
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

/** Raíz del repo del toolkit (tools-posky/). */
const REPO_ROOT = path.resolve(__dirname, '..');

function poskyHome() {
  const custom = process.env.POSKY_HOME;
  if (custom && custom.trim()) return path.resolve(custom);
  return path.join(os.homedir(), '.pos-posky');
}

/**
 * Carpeta de claves Ed25519.
 * Prioridad: POSKY_KEYS_DIR → $POSKY_HOME/keys (si existe) → tools-posky/keys.
 */
function keysDir() {
  const custom = process.env.POSKY_KEYS_DIR;
  if (custom && custom.trim()) return path.resolve(custom);

  const homeKeys = path.join(poskyHome(), 'keys');
  if (fs.existsSync(homeKeys)) return homeKeys;

  return path.join(REPO_ROOT, 'keys');
}

/** Carpeta donde se guardan los .lic emitidos. */
function outDir() {
  const custom = process.env.POSKY_OUT_DIR;
  if (custom && custom.trim()) return path.resolve(custom);
  return path.join(poskyHome(), 'out');
}

/** Archivo del registry cifrado. */
function registryFile() {
  const custom = process.env.POSKY_REGISTRY_FILE;
  if (custom && custom.trim()) return path.resolve(custom);
  return path.join(poskyHome(), 'registry.json.enc');
}

/** Registry plano heredado (dentro del repo) — solo para migración. */
function legacyRegistryFile() {
  return path.join(REPO_ROOT, 'registry.json');
}

/** Carpeta out heredada (dentro del repo) — solo para migración. */
function legacyOutDir() {
  return path.join(REPO_ROOT, 'out');
}

/** Nombres de los archivos de clave. */
const KEY_FILES = {
  public: 'mipos_public.pem',
  privateEncrypted: 'mipos_private.enc.pem',
  privatePlain: 'mipos_private.pem',
  trialPublic: 'trial_public.pem',
  trialPrivate: 'trial_private.pem',
  trialPrivateEncrypted: 'trial_private.enc.pem',
};

module.exports = {
  REPO_ROOT,
  KEY_FILES,
  poskyHome,
  keysDir,
  outDir,
  registryFile,
  legacyRegistryFile,
  legacyOutDir,
};
