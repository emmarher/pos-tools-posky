#!/usr/bin/env node
/**
 * generate-trial-keys.js — Genera par Ed25519 dedicado para licencias trial (1 día).
 *
 * ─────────────────────────────────────────────────────────────────────
 * Uso:  node generate-trial-keys.js [--force]
 *       TRIAL_PASS="..." node generate-trial-keys.js   # para cifrar la privada
 *
 * Genera (en $POSKY_KEYS_DIR, por defecto tools-posky/keys):
 *   trial_public.pem         — clave pública SPKI (se embebe en build: trialPublicKey.ts)
 *   trial_private.pem        — clave privada PKCS8 sin cifrar (solo dev, no commitear)
 *   trial_private.enc.pem    — clave privada cifrada AES-256-CBC (si TRIAL_PASS está seteado)
 *
 * La familia trial usa claves aisladas de las productivas (mipos_*). Rotar la trial
 * no impacta licencias productivas.
 *
 * OJO: pos-server busca la clave trial privada en varias rutas (keyToolDirs()).
 * En producción el instalador NO incluye esta clave → POST /license/trial
 * queda deshabilitado (además, TRIAL_ENABLED=false).
 * ─────────────────────────────────────────────────────────────────────
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const paths = require('./lib/paths.js');
const secureStore = require('./lib/secure-store.js');

const KEYS_DIR = paths.keysDir();
const colors = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

function hasOpenssl() {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', ['openssl'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function main() {
  const force = process.argv.includes('--force');
  console.log(colors.cyan('=== Generador de claves trial Ed25519 (POS v4) ===\n'));
  fs.mkdirSync(KEYS_DIR, { recursive: true });

  const pubPath = path.join(KEYS_DIR, paths.KEY_FILES.trialPublic);
  const privPath = path.join(KEYS_DIR, paths.KEY_FILES.trialPrivate);
  const encPrivPath = path.join(KEYS_DIR, paths.KEY_FILES.trialPrivateEncrypted);

  if ((fs.existsSync(pubPath) || fs.existsSync(privPath) || fs.existsSync(encPrivPath)) && !force) {
    console.log(colors.yellow(`⚠  Ya existen claves trial en ${KEYS_DIR}`));
    console.log(colors.yellow('   Usa --force para regenerar (recordá re-generar trialPublicKey.ts).'));
    process.exitCode = 1;
    return;
  }

  console.log('1. Generando par Ed25519 trial...');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  fs.writeFileSync(pubPath, pubPem, 'utf8');
  fs.writeFileSync(privPath, privPem, 'utf8');
  console.log(colors.green(`   ✓ ${paths.KEY_FILES.trialPublic}`));
  console.log(colors.green(`   ✓ ${paths.KEY_FILES.trialPrivate} (dev, sin cifrar — no commitear)`));

  const passphrase = process.env.TRIAL_PASS || process.env.LIC_PASS;
  if (passphrase && passphrase.length >= 8) {
    if (hasOpenssl()) {
      try {
        execFileSync('openssl', [
          'pkcs8', '-topk8', '-v2', 'aes-256-cbc',
          '-passout', 'env:TRIAL_PASS_TMP',
          '-in', privPath, '-out', encPrivPath,
        ], { env: { ...process.env, TRIAL_PASS_TMP: passphrase } });
        console.log(colors.green(`   ✓ ${paths.KEY_FILES.trialPrivateEncrypted} (AES-256-CBC)`));
        crypto.createPrivateKey({ key: fs.readFileSync(encPrivPath, 'utf8'), passphrase });
        console.log(colors.green('   ✓ Verificación passphrase OK'));
      } catch (e) {
        console.log(colors.red('   ✗ Error cifrando con openssl: ' + e.message));
      }
    } else {
      const der = crypto.createPrivateKey(privPem).export({ type: 'pkcs8', format: 'der' });
      secureStore.writeEnvelope(encPrivPath, secureStore.encrypt(der.toString('base64'), passphrase));
      console.log(colors.green(`   ✓ ${paths.KEY_FILES.trialPrivateEncrypted} (Node AES-256-GCM, sin openssl)`));
    }
  } else {
    console.log(colors.yellow('   (sin TRIAL_PASS → no se genera la cifrada; en prod definí TRIAL_PASS)'));
  }

  console.log('\n' + colors.cyan('=== CLAVES TRIAL GENERADAS ==='));
  console.log(colors.green('Pública:') + '  ' + pubPath + ' → embed en trialPublicKey.ts');
  console.log(colors.green('Privada:') + '  ' + privPath + ' → la usa POS_SERVER en POST /license/trial');
  console.log('Siguiente: cd pos-server && npm run build:keys  (genera ambos publicKey.ts)');
}

if (require.main === module) main();

module.exports = { main };
