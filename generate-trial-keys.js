#!/usr/bin/env node
/**
 * tools/generate-trial-keys.js — Genera par Ed25519 dedicado para licencias trial (1 día).
 *
 * Uso:  node tools/generate-trial-keys.js [--force]
 *       TRIAL_PASS="..." node tools/generate-trial-keys.js   # para cifrar con AES-256-CBC
 *
 * Genera:
 *   keys/trial_public.pem         — clave pública SPKI (se embebe en build: trialPublicKey.ts)
 *   keys/trial_private.pem        — clave privada PKCS8 sin cifrar (solo dev, no commitear)
 *   keys/trial_private.enc.pem    — clave privada cifrada AES-256-CBC (si TRIAL_PASS está seteado)
 *
 * La familia trial usa claves aisladas de las productivas (mipos_*). Rotar la trial
 * no impacta licencias productivas.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const KEYS_DIR = path.join(__dirname, 'keys');
const colors = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

function main() {
  const force = process.argv.includes('--force');
  console.log(colors.cyan('=== Generador de claves trial Ed25519 (POS v4) ===\n'));
  fs.mkdirSync(KEYS_DIR, { recursive: true });

  const pubPath = path.join(KEYS_DIR, 'trial_public.pem');
  const privPath = path.join(KEYS_DIR, 'trial_private.pem');
  const encPrivPath = path.join(KEYS_DIR, 'trial_private.enc.pem');

  if ((fs.existsSync(pubPath) || fs.existsSync(privPath) || fs.existsSync(encPrivPath)) && !force) {
    console.log(colors.yellow('⚠  Ya existen claves trial en tools/keys/'));
    console.log(colors.yellow('   Usa --force para regenerar (recuerda re-generar trialPublicKey.ts).'));
    process.exit(1);
  }

  console.log('1. Generando par Ed25519 trial...');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  fs.writeFileSync(pubPath, pubPem, 'utf8');
  fs.writeFileSync(privPath, privPem, 'utf8');
  console.log(colors.green('   ✓ trial_public.pem'));
  console.log(colors.green('   ✓ trial_private.pem (dev, sin cifrar — no commitear)'));

  const passphrase = process.env.TRIAL_PASS || process.env.LIC_PASS;
  if (passphrase && passphrase.length >= 8) {
    try {
      execSync(
        `openssl pkcs8 -topk8 -v2 aes-256-cbc -passout env:TRIAL_PASS_TMP -in "${privPath}" -out "${encPrivPath}"`,
        { env: { ...process.env, TRIAL_PASS_TMP: passphrase } },
      );
      console.log(colors.green('   ✓ trial_private.enc.pem (AES-256-CBC)'));
      try {
        crypto.createPrivateKey({ key: fs.readFileSync(encPrivPath, 'utf8'), passphrase });
        console.log(colors.green('   ✓ Verificación passphrase OK'));
      } catch {
        console.log(colors.red('   ✗ Verificación de passphrase falló'));
      }
    } catch (e) {
      console.log(colors.red('   ✗ Error cifrando con openssl: ' + e.message));
    }
  } else {
    console.log(colors.yellow('   (sin TRIAL_PASS → no se genera .enc.pem; para prod define TRIAL_PASS)'));
  }

  console.log('\n' + colors.cyan('=== CLAVES TRIAL GENERADAS ==='));
  console.log(colors.green('Pública:') + '  tools/keys/trial_public.pem → embed en trialPublicKey.ts');
  console.log(colors.green('Privada:') + '  tools/keys/trial_private(.enc).pem → POS_SERVER usa para POST /license/trial');
  console.log('Siguiente: npm run build:keys  (genera ambos publicKey.ts)');
}

main();
