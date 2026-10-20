/**
 * lib/core.js — Lógica de negocio del toolkit de licencias (SÍNCRONA).
 *
 * ─────────────────────────────────────────────────────────────────────
 * Aquí viven las operaciones que cambian el estado de una licencia:
 * emitir, renovar, suspender y ampliar asientos. Todo es síncrono a
 * propósito: la capa de comandos (TUI) es asíncrona, pero el núcleo no
 * necesita serlo y así se mantiene trivial de testear.
 *
 * Contrato del payload (idéntico al que espera pos-server):
 *   { schema, lic_id, license_key, customer, branch, seats, features,
 *     issued: 'YYYY-MM-DD', expires: ISO-8601, hw_fingerprint: null }
 * ─────────────────────────────────────────────────────────────────────
 */
const fs = require('fs');
const path = require('path');

const licenseLib = require('./licenseLib.js');
const paths = require('./paths.js');
const registryStore = require('./registry.js');

const {
  LICENSE_SCHEMA_VERSION,
  loadPrivateKey,
  loadPublicKey,
  signLicense,
  readLicense,
  verifyLicense,
  generateLicenseId,
  today,
  inOneYear,
  daysFromNow,
} = licenseLib;

/** Features por defecto (los del PRD original). */
const DEFAULT_FEATURES = ['inventory', 'garage', 'reports'];

/** Ruta del archivo .lic de una licencia emitida. */
function licFilePath(licId, outDir) {
  return path.join(outDir || paths.outDir(), `${licId}.lic`);
}

/** Ruta de la clave privada cifrada de emisión. */
function privateKeyPath() {
  return path.join(paths.keysDir(), paths.KEY_FILES.privateEncrypted);
}

/** Ruta de la clave pública principal. */
function publicKeyPath() {
  return path.join(paths.keysDir(), paths.KEY_FILES.public);
}

// ── Emisión ───────────────────────────────────────────────────────────────

/**
 * Emite una licencia nueva y la registra.
 *
 * @param {object} opts
 * @param {string} opts.customer
 * @param {string} opts.branch
 * @param {string} opts.licenseKey   — tenant code con el que entra el cliente
 * @param {number} opts.seats        — max_devices
 * @param {string[]} [opts.features]
 * @param {string} [opts.expires]    — ISO; por defecto 1 año
 * @param {string} opts.passphrase
 * @returns {{ licId, payload, licString, filePath, registry }}
 */
function issueLicense(opts) {
  const {
    customer,
    branch,
    licenseKey,
    seats,
    features = DEFAULT_FEATURES,
    expires,
    issued,
    passphrase,
  } = opts;

  if (!customer) throw new Error('Falta el nombre del cliente.');
  if (!branch) throw new Error('Falta la sucursal.');
  if (!licenseKey) throw new Error('Falta el license_key (tenant code del login).');
  if (!Number.isFinite(seats) || seats < 1) throw new Error('La cantidad de asientos debe ser >= 1.');
  if (!passphrase) throw new Error('Falta la passphrase.');

  const reg = registryStore.load(passphrase);
  const licId = generateLicenseId(reg);

  const payload = {
    schema: LICENSE_SCHEMA_VERSION,
    lic_id: licId,
    license_key: licenseKey,
    customer,
    branch,
    seats,
    features: features.length ? features : DEFAULT_FEATURES,
    issued: issued || today(),
    expires: expires || inOneYear(),
    hw_fingerprint: null,
  };

  const privateKey = loadPrivateKey(passphrase, privateKeyPath());
  const licString = signLicense(payload, privateKey);

  const out = paths.outDir();
  fs.mkdirSync(out, { recursive: true });
  const filePath = licFilePath(licId, out);
  fs.writeFileSync(filePath, licString, 'utf8');

  reg[licId] = {
    customer,
    license_key: licenseKey,
    branch,
    current_expires: payload.expires,
    current_seats: seats,
    status: 'active',
    history: [
      {
        action: 'issued',
        expires: payload.expires,
        seats,
        features: payload.features,
        issued: payload.issued,
        at: new Date().toISOString(),
      },
    ],
  };
  registryStore.save(reg, passphrase);

  return { licId, payload, licString, filePath, registry: reg };
}

// ── Renovación ────────────────────────────────────────────────────────────

/**
 * Renueva una licencia: conserva el lic_id y todos los campos, cambia `expires`.
 * NO regala tiempo: la nueva fecha la define el operador.
 */
function renewLicense(opts) {
  const { licId, newExpiry, passphrase } = opts;
  if (!licId) throw new Error('Falta el lic_id.');
  if (!newExpiry) throw new Error('Falta la nueva fecha de expiración.');
  if (!passphrase) throw new Error('Falta la passphrase.');

  const reg = registryStore.load(passphrase);
  const entry = reg[licId];
  if (!entry) throw new Error(`Licencia no encontrada en el registry: ${licId}`);

  const filePath = licFilePath(licId);
  if (!fs.existsSync(filePath)) {
    throw new Error(`No se encontró el archivo .lic: ${filePath}`);
  }

  const payload = readLicense(fs.readFileSync(filePath, 'utf8'));
  const prevExpires = payload.expires;
  payload.expires = newExpiry;

  const privateKey = loadPrivateKey(passphrase, privateKeyPath());
  const licString = signLicense(payload, privateKey);
  fs.writeFileSync(filePath, licString, 'utf8');

  entry.current_expires = newExpiry;
  if (entry.status === 'suspended') entry.status = 'active';
  entry.history.push({
    action: 'renewed',
    prev_expires: prevExpires,
    new_expires: newExpiry,
    at: new Date().toISOString(),
  });
  registryStore.save(reg, passphrase);

  return { licId, payload, licString, filePath, prevExpires };
}

// ── Suspensión ────────────────────────────────────────────────────────────

/**
 * Suspende una licencia: pone `expires` en el pasado.
 * El cliente queda en modo degradado (ventas bloqueadas, datos intactos).
 * Para reactivar: `renewLicense` con una fecha futura.
 */
function suspendLicense(opts) {
  const { licId, passphrase } = opts;
  if (!licId) throw new Error('Falta el lic_id.');
  if (!passphrase) throw new Error('Falta la passphrase.');

  const reg = registryStore.load(passphrase);
  const entry = reg[licId];
  if (!entry) throw new Error(`Licencia no encontrada en el registry: ${licId}`);

  const filePath = licFilePath(licId);
  if (!fs.existsSync(filePath)) {
    throw new Error(`No se encontró el archivo .lic: ${filePath}`);
  }

  const payload = readLicense(fs.readFileSync(filePath, 'utf8'));
  const originalExpiry = payload.expires;
  payload.expires = new Date(Date.now() - 86400000).toISOString(); // 1 día en el pasado

  const privateKey = loadPrivateKey(passphrase, privateKeyPath());
  const licString = signLicense(payload, privateKey);
  fs.writeFileSync(filePath, licString, 'utf8');

  entry.status = 'suspended';
  entry.history.push({
    action: 'suspended',
    prev_expires: originalExpiry,
    at: new Date().toISOString(),
  });
  registryStore.save(reg, passphrase);

  return { licId, payload, licString, filePath, originalExpiry };
}

// ── Asientos ──────────────────────────────────────────────────────────────

/**
 * Amplía (o reduce) los asientos. NO cambia la fecha de expiración.
 */
function updateSeats(opts) {
  const { licId, newSeats, passphrase } = opts;
  if (!licId) throw new Error('Falta el lic_id.');
  if (!Number.isFinite(newSeats) || newSeats < 1) {
    throw new Error('La cantidad de asientos debe ser >= 1.');
  }
  if (!passphrase) throw new Error('Falta la passphrase.');

  const reg = registryStore.load(passphrase);
  const entry = reg[licId];
  if (!entry) throw new Error(`Licencia no encontrada en el registry: ${licId}`);

  const filePath = licFilePath(licId);
  if (!fs.existsSync(filePath)) {
    throw new Error(`No se encontró el archivo .lic: ${filePath}`);
  }

  const payload = readLicense(fs.readFileSync(filePath, 'utf8'));
  const oldSeats = payload.seats;
  payload.seats = newSeats;

  const privateKey = loadPrivateKey(passphrase, privateKeyPath());
  const licString = signLicense(payload, privateKey);
  fs.writeFileSync(filePath, licString, 'utf8');

  entry.current_seats = newSeats;
  entry.history.push({
    action: 'upgraded',
    prev_seats: oldSeats,
    new_seats: newSeats,
    at: new Date().toISOString(),
  });
  registryStore.save(reg, passphrase);

  return { licId, payload, licString, filePath, oldSeats };
}

// ── Consulta / QA ─────────────────────────────────────────────────────────

/** Verifica la firma de un .lic contra la clave pública principal. */
function verifyLicenseFile(licContent) {
  const pub = loadPublicKey(publicKeyPath());
  return verifyLicense(licContent, pub);
}

/** Verifica contra la familia trial. */
function verifyTrialLicenseFile(licContent) {
  const trialPubPath = path.join(paths.keysDir(), paths.KEY_FILES.trialPublic);
  if (!fs.existsSync(trialPubPath)) {
    return { valid: false, payload: null, error: 'No existe la clave pública de trial.' };
  }
  const pub = loadPublicKey(trialPubPath);
  return verifyLicense(licContent, pub);
}

/** Lee un .lic del disco y lo devuelve con su contenido. */
function readLicenseFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8').trim();
  return { content, payload: readLicense(content) };
}

/** Lista los .lic emitidos en la carpeta out/. */
function listLicenseFiles(outDir) {
  const dir = outDir || paths.outDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.lic'))
    .sort()
    .map((f) => path.join(dir, f));
}

module.exports = {
  DEFAULT_FEATURES,
  issueLicense,
  renewLicense,
  suspendLicense,
  updateSeats,
  verifyLicenseFile,
  verifyTrialLicenseFile,
  readLicenseFile,
  listLicenseFiles,
  licFilePath,
  privateKeyPath,
  publicKeyPath,
  daysFromNow,
  inOneYear,
  today,
};
