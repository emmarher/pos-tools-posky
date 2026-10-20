/**
 * commands/keys.js — `posky keys` — Gestión de las claves Ed25519.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Subcomandos:
 *   posky keys list                  — estado de los archivos de clave
 *   posky keys verify                — comprueba que el par público/privado cierra
 *   posky keys generate              — genera el par de producción (una sola vez)
 *   posky keys passphrase --save     — guarda la passphrase en el keychain
 *   posky keys passphrase --remove   — la borra del keychain
 * ─────────────────────────────────────────────────────────────────────
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ui = require('../lib/ui.js');
const paths = require('../lib/paths.js');
const keychain = require('../lib/keychain.js');
const passphraseLib = require('../lib/passphrase.js');
const licenseLib = require('../lib/licenseLib.js');

const KEY_TABLE = [
  { file: 'public', label: 'Pública (producción)', critical: true },
  { file: 'privateEncrypted', label: 'Privada cifrada (producción)', critical: true },
  { file: 'trialPublic', label: 'Pública (trial)', critical: false },
  { file: 'trialPrivate', label: 'Privada (trial)', critical: false },
];

function fileInfo(file) {
  const p = path.join(paths.keysDir(), file);
  if (!fs.existsSync(p)) return { path: p, exists: false };
  const stat = fs.statSync(p);
  return { path: p, exists: true, size: stat.size };
}

async function list() {
  ui.outro('');
  ui.table(
    KEY_TABLE.map((k) => {
      const info = fileInfo(paths.KEY_FILES[k.file]);
      return [
        k.label,
        info.exists ? '✓ presente' : '— ausente',
        info.exists ? `${info.size} B` : '',
        info.path,
      ];
    }),
    ['CLAVE', 'ESTADO', 'TAMAÑO', 'RUTA'],
  );
  console.log('');
  ui.info(`Carpeta de claves: ${paths.keysDir()}`);
  ui.info('La clave pública se embebe en pos-server con: cd pos-server && npm run build:keys');
  ui.outro('');
}

// ── verify ────────────────────────────────────────────────────────────────

async function verify() {
  const pubPath = path.join(paths.keysDir(), paths.KEY_FILES.public);
  const privPath = path.join(paths.keysDir(), paths.KEY_FILES.privateEncrypted);

  if (!fs.existsSync(pubPath)) {
    ui.error(`No existe la clave pública: ${pubPath}`);
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(privPath)) {
    ui.error(`No existe la clave privada cifrada: ${privPath}`);
    process.exitCode = 1;
    return;
  }

  const passphrase = await passphraseLib.resolveAsync({
    prompt: 'Passphrase de la clave privada:',
  });

  try {
    const priv = licenseLib.loadPrivateKey(passphrase, privPath);
    const pub = licenseLib.loadPublicKey(pubPath);

    // El par cierra si la firma se verifica con la pública.
    const probe = Buffer.from('posky-key-check');
    const sig = crypto.sign(null, probe, priv);
    const ok = crypto.verify(null, probe, pub, sig);

    if (!ok) {
      ui.error('La clave pública NO corresponde a la clave privada. Revisar el backup.');
      process.exitCode = 1;
      return;
    }

    // Y el server tiene embebida la misma pública.
    const embedded = path.resolve(paths.REPO_ROOT, '../pos-server/src/keys/publicKey.ts');
    let same = 'no verificable (pos-server no encontrado)';
    if (fs.existsSync(embedded)) {
      const content = fs.readFileSync(embedded, 'utf8');
      const pubPem = fs.readFileSync(pubPath, 'utf8');
      const normalized = pubPem.replace(/\s+/g, '');
      same = content.replace(/\s+/g, '').includes(normalized)
        ? '✓ pos-server/src/keys/publicKey.ts coincide'
        : '✗ pos-server tiene OTRA clave pública (corré npm run build:keys)';
    }

    ui.success('El par de claves es coherente.');
    ui.info(same);
    ui.outro('');
  } catch (e) {
    ui.error(e.message);
    process.exitCode = 1;
  }
}

// ── generate ──────────────────────────────────────────────────────────────

async function generate() {
  const { main } = require('../generate-keys.js');
  await main({ interactive: true });
}

// ── passphrase / keychain ─────────────────────────────────────────────────

async function passphraseSub(flags) {
  if (flags.remove) {
    const ok = keychain.remove();
    if (ok) {
      ui.success('Passphrase eliminada del keychain.');
    } else {
      ui.warn('No había nada guardado (o el keychain no está disponible).');
    }
    ui.outro('');
    return;
  }

  if (!keychain.isSupported()) {
    ui.error(`El keychain no está disponible en esta plataforma (${process.platform}).`);
    ui.info('Usá la variable LIC_PASS o tecleá la passphrase cuando se la pida.');
    process.exitCode = 1;
    return;
  }

  const pass = await passphraseLib.resolveAsync({
    allowKeychain: false,
    prompt: 'Passphrase a guardar en el keychain:',
  });
  keychain.save(pass);
  ui.success(`Passphrase guardada en el ${keychain.backendName()}.`);
  ui.outro('');
}

// ── dispatch ──────────────────────────────────────────────────────────────

async function run(ctx) {
  const { positional, flags } = ctx;
  const sub = positional[0] || 'list';

  switch (sub) {
    case 'list':
      return list();
    case 'verify':
      return verify();
    case 'generate':
      return generate();
    case 'passphrase':
      return passphraseSub(flags);
    default:
      ui.error(`Subcomando desconocido: keys ${sub}`);
      ui.info('Disponibles: list · verify · generate · passphrase');
      process.exitCode = 1;
      return undefined;
  }
}

module.exports = { run };
