#!/usr/bin/env node
/**
 * tools/generate-keys.js — Genera el par de claves Ed25519 para firmar licencias.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Uso:  node tools/generate-keys.js
 *
 * Genera (una sola vez para todo el producto):
 *   keys/mipos_public.pem          — clave pública (SPKI PEM, sin cifrar)
 *   keys/mipos_private.pem         — clave privada (PKCS8 PEM, temporal, se borra)
 *   keys/mipos_private.enc.pem     — clave privada cifrada con AES-256-CBC (permanente)
 *
 * REGLAS DE ORO:
 *   - NUNCA commitear keys/ (vuelve a .gitignore)
 *   - Backup en 2 lugares físicos distintos: USB cifrado (VeraCrypt) +
 *     almacenamiento en la nube cifrado (Cryptomator/Bitwarden con adjunto)
 *   - Si pierdes la privada: no puedes emitir licencias nuevas para versiones
 *     ya desplegadas (hay que relanzar el server con clave nueva y reemitir)
 *   - Si te la roban: pueden fabricar licencias infinitas → por eso el PEM
 *     está cifrado con passphrase y tú desencriptas solo al emitir
 *   - La passphrase es LIC_PASS (se pasa como env var a los scripts de emisión)
 *
 * La clave pública se embebe en el build de pos-server (no en .env editable
 * por el cliente — eso permitiría poner una clave pública falsa).
 * ─────────────────────────────────────────────────────────────────────
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEYS_DIR = path.join(__dirname, 'keys');

// ANSI colors (opcional, funciona en la mayoría de terminales)
const colors = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

function main() {
  console.log(colors.cyan('=== Generador de par de claves Ed25519 para POS v4 ===\n'));

  // Verificar que la carpeta keys/ exista o crearla
  fs.mkdirSync(KEYS_DIR, { recursive: true });

  // Verificar si ya existen claves (no sobreescribir por accidente)
  const pubPath = path.join(KEYS_DIR, 'mipos_public.pem');
  const encPrivPath = path.join(KEYS_DIR, 'mipos_private.enc.pem');
  if (fs.existsSync(pubPath) && fs.existsSync(encPrivPath)) {
    console.log(colors.yellow('⚠  Ya existen claves en tools/keys/'));
    console.log(colors.yellow('   Si quieres regenerar, borra primero keys/ y vuelve a correr.'));
    console.log(colors.yellow('   Recuerda: si regeneras, debes reemitir TODAS las licencias.\n'));
    process.exit(1);
  }

  // 1) Generar par Ed25519
  console.log('1. Generando par de claves Ed25519...');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');

  // 2) Exportar clave pública (SPKI PEM, sin cifrar) — se embebe en el build
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  fs.writeFileSync(pubPath, pubPem, 'utf8');
  console.log(colors.green('   ✓ Clave pública → keys/mipos_public.pem'));

  // 3) Exportar clave privada (PKCS8 PEM) — versión temporal sin cifrar
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const tmpPrivPath = path.join(KEYS_DIR, 'mipos_private.pem');
  fs.writeFileSync(tmpPrivPath, privPem, 'utf8');

  // 4) Preguntar passphrase y cifrar con AES-256-CBC
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  readline.question(
    colors.yellow('2. Ingresa una passphrase fuerte para cifrar la clave privada (AES-256-CBC): '),
    (passphrase) => {
      if (passphrase.length < 16) {
        console.log(colors.red('✗  La passphrase debe tener al menos 16 caracteres.'));
        readline.close();
        process.exit(1);
      }

      const encPrivPath = path.join(KEYS_DIR, 'mipos_private.enc.pem');

      // Usar openssl para cifrar (más compatible, sigue la spec del usuario)
      const { execSync } = require('child_process');
      try {
        execSync(
          `openssl pkcs8 -topk8 -v2 aes-256-cbc -passout env:LIC_PASS_TMP ` +
          `-in "${tmpPrivPath}" -out "${encPrivPath}"`,
          { env: { ...process.env, LIC_PASS_TMP: passphrase } },
        );
      } catch (e) {
        console.log(colors.red('✗  Error al cifrar con openssl. Asegúrate de tener openssl en PATH.'));
        console.error(e.message);
        readline.close();
        process.exit(1);
      }

      // Borrar la versión sin cifrar
      fs.unlinkSync(tmpPrivPath);
      console.log(colors.green('   ✓ Clave privada cifrada → keys/mipos_private.enc.pem'));
      console.log(colors.green('   ✓ Versión sin cifrar borrada'));

      readline.close();

      // 5) Verificar la cifuración (desencriptar y confirmar)
      try {
        crypto.createPrivateKey({ key: fs.readFileSync(encPrivPath, 'utf8'), passphrase });
        console.log(colors.green('   ✓ Verificación: passphrase correcta, clave desbloqueable'));
      } catch {
        console.log(colors.red('✗  No se pudo verificar la clave cifrada. Algo salió mal.'));
        process.exit(1);
      }

      // 6) Instrucciones de backup
      console.log('\n' + colors.cyan('=== CLAVES GENERADAS ==='));
      console.log(colors.green('Clave pública:') + '  tools/keys/mipos_public.pem');
      console.log(colors.green('Clave privada (cifrada):') + '  tools/keys/mipos_private.enc.pem');
      console.log('\n' + colors.yellow('🔒 ACCIONES REQUERIDAS:'));
      console.log('  1. Backup de mipos_private.enc.pem + passphrase en dos lugares:');
      console.log('     a) USB cifrado (VeraCrypt)');
      console.log('     b) Almacenamiento en la nube cifrado (Cryptomator o Bitwarden)');
      console.log('  2. Nunca commitees tools/keys/ al repo (ya está en .gitignore)');
      console.log('  3. La passphrase se pasa como LIC_PASS en los scripts de emisión:');
      console.log(colors.green('     LIC_PASS="tu-passphrase" node tools/issue-license.js ...'));
      console.log('\n  Cómo embebe la clave pública en pos-server:');
      console.log(colors.green('     cd pos-server && npm run build:keys'));
      console.log('\n  Nota: tools/keys/ está en .gitignore. Si la removes,');
      console.log('        la build fallará hasta que generes las claves.');
    },
  );
}

main();
