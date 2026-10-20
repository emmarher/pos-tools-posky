#!/usr/bin/env node
/**
 * generate-keys.js — Genera el par de claves Ed25519 para firmar licencias.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Uso:  node generate-keys.js
 *
 * Genera (una sola vez para todo el producto):
 *   keys/mipos_public.pem          — clave pública (SPKI PEM, sin cifrar)
 *   keys/mipos_private.enc.pem     — clave privada cifrada (permanente)
 *
 * El cifrado usa openssl (PKCS#8 + AES-256-CBC). Si openssl no está en el
 * PATH (típico en Windows sin Git for Windows) cae a un sobre propio de Node
 * (AES-256-GCM) con el mismo nombre de archivo.
 *
 * REGLAS DE ORO:
 *   - NUNCA commitear keys/ (ya está en .gitignore)
 *   - Backup en 2 lugares físicos distintos: USB cifrado (VeraCrypt) +
 *     almacenamiento en la nube cifrado (Cryptomator/Bitwarden con adjunto)
 *   - Si pierdes la privada: no puedes emitir licencias nuevas para versiones
 *     ya desplegadas (hay que relanzar el server con clave nueva y reemitir)
 *   - Si te la roban: pueden fabricar licencias infinitas → por eso el PEM
 *     está cifrado con passphrase y tú desencriptás solo al emitir
 *
 * La clave pública se embebe en el build de pos-server (no en .env editable
 * por el cliente — eso permitiría poner una clave pública falsa).
 * ─────────────────────────────────────────────────────────────────────
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const paths = require('./lib/paths.js');
const secureStore = require('./lib/secure-store.js');
const passphraseLib = require('./lib/passphrase.js');

const KEYS_DIR = paths.keysDir();

const colors = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

/** ¿Está openssl disponible? */
function hasOpenssl() {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', ['openssl'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Cifra la clave privada.
 * @returns {{ file: string, method: string }}
 */
function encryptPrivateKey(privPem, passphrase, targetPath) {
  if (hasOpenssl()) {
    const tmpPrivPath = path.join(paths.keysDir(), paths.KEY_FILES.privatePlain);
    fs.writeFileSync(tmpPrivPath, privPem, 'utf8');
    try {
      execFileSync('openssl', [
        'pkcs8', '-topk8', '-v2', 'aes-256-cbc',
        '-passout', 'env:LIC_PASS_TMP',
        '-in', tmpPrivPath,
        '-out', targetPath,
      ], { env: { ...process.env, LIC_PASS_TMP: passphrase } });
    } finally {
      try { fs.unlinkSync(tmpPrivPath); } catch { /* noop */ }
    }
    return { file: targetPath, method: 'openssl pkcs8 (AES-256-CBC)' };
  }

  // Fallback Node: sobre JSON con AES-256-GCM.
  const der = crypto.createPrivateKey(privPem).export({ type: 'pkcs8', format: 'der' });
  const envelope = secureStore.encrypt(der.toString('base64'), passphrase);
  secureStore.writeEnvelope(targetPath, envelope);
  return { file: targetPath, method: 'Node AES-256-GCM (sin openssl)' };
}

function main(opts = {}) {
  const interactive = opts.interactive !== false;

  console.log(colors.cyan('=== Generador de par de claves Ed25519 para POS v4 ===\n'));

  fs.mkdirSync(KEYS_DIR, { recursive: true });

  const pubPath = path.join(KEYS_DIR, paths.KEY_FILES.public);
  const encPrivPath = path.join(KEYS_DIR, paths.KEY_FILES.privateEncrypted);
  if (fs.existsSync(pubPath) && fs.existsSync(encPrivPath)) {
    console.log(colors.yellow('⚠  Ya existen claves en ' + KEYS_DIR));
    console.log(colors.yellow('   Si querés regenerar, borra esa carpeta y volvé a correr.'));
    console.log(colors.yellow('   Recordá: si regenerás, hay que reemitir TODAS las licencias.\n'));
    process.exitCode = 1;
    return null;
  }

  // 1) Par Ed25519
  console.log('1. Generando par de claves Ed25519...');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');

  // 2) Clave pública (SPKI PEM) — se embebe en el build de pos-server
  fs.writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' }), 'utf8');
  console.log(colors.green(`   ✓ Clave pública → ${pubPath}`));

  // 3) Clave privada en claro (temporal)
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

  // 4) Passphrase (enmascarada) + cifrado
  let passphrase;
  if (process.env.LIC_PASS || process.env.POSKY_PASS) {
    passphrase = process.env.LIC_PASS || process.env.POSKY_PASS;
    console.log('2. Passphrase tomada de la variable de entorno.');
  } else if (interactive && process.stdin.isTTY) {
    passphrase = passphraseLib.promptHidden(
      colors.yellow('2. Ingresá una passphrase fuerte para cifrar la clave privada: '),
    );
  } else {
    console.log(colors.red('✗  Necesito la passphrase: definí LIC_PASS o corré en una terminal.'));
    process.exitCode = 1;
    return null;
  }

  if (!passphrase || passphrase.length < 16) {
    console.log(colors.red('✗  La passphrase debe tener al menos 16 caracteres.'));
    process.exitCode = 1;
    return null;
  }

  const enc = encryptPrivateKey(privPem, passphrase, encPrivPath);
  console.log(colors.green(`   ✓ Clave privada cifrada → ${enc.file} (${enc.method})`));

  // 5) Verificación
  try {
    crypto.createPrivateKey({ key: fs.readFileSync(encPrivPath, 'utf8'), passphrase });
  } catch {
    // El sobre JSON se verifica con secure-store
    try {
      const derB64 = secureStore.decrypt(JSON.parse(fs.readFileSync(enc.file, 'utf8')), passphrase);
      crypto.createPrivateKey({ key: Buffer.from(derB64, 'base64'), format: 'der', type: 'pkcs8' });
    } catch (e) {
      console.log(colors.red(`✗  No se pudo verificar la clave cifrada: ${e.message}`));
      process.exitCode = 1;
      return null;
    }
  }
  console.log(colors.green('   ✓ Verificación: passphrase correcta, clave desbloqueable'));

  // 6) Instrucciones de backup
  console.log('\n' + colors.cyan('=== CLAVES GENERADAS ==='));
  console.log(colors.green('Clave pública:') + '  ' + pubPath);
  console.log(colors.green('Clave privada (cifrada):') + '  ' + enc.file);
  console.log('\n' + colors.yellow('🔒 ACCIONES REQUERIDAS:'));
  console.log('  1. Backup de la clave cifrada + passphrase en dos lugares:');
  console.log('     a) USB cifrado (VeraCrypt)');
  console.log('     b) Almacenamiento en la nube cifrado (Cryptomator o Bitwarden)');
  console.log('  2. Nunca commitees keys/ al repo (ya está en .gitignore)');
  console.log('  3. Para emitir: la passphrase se teclea en la TUI o va en LIC_PASS');
  console.log(colors.green('     node bin/posky.js issue'));
  console.log('\n  Cómo embebe la clave pública en pos-server:');
  console.log(colors.green('     cd pos-server && npm run build:keys'));
  console.log('\n  Nota: keys/ está en .gitignore. Si la removés,');
  console.log('        la build fallará hasta que generes las claves.');

  return { pubPath, encPrivPath: enc.file, method: enc.method };
}

if (require.main === module) {
  main({ interactive: true });
}

module.exports = { main, hasOpenssl };
