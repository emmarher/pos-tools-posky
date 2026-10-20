/**
 * tests/helpers.js — Utilidades compartidas por los tests.
 *
 * Crea un entorno aislado (POSKY_HOME temporal) con un par de claves
 * Ed25519 de prueba, para no tocar las claves reales de producción.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const secureStore = require('../lib/secure-store.js');

const TEST_PASS = 'passphrase-de-prueba-1234';

/**
 * Crea un entorno de prueba aislado.
 * @returns {{ home: string, keys: string, out: string, pass: string, cleanup: Function }}
 */
function makeEnv(prefix = 'posky-test-') {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const home = path.join(base, 'home');
  const keys = path.join(base, 'keys');
  const out = path.join(base, 'out');

  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(keys, { recursive: true });
  fs.mkdirSync(out, { recursive: true });

  // Par Ed25519 de prueba
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(
    path.join(keys, 'mipos_public.pem'),
    publicKey.export({ type: 'spki', format: 'pem' }),
  );

  // Privada cifrada con el sobre de Node (mismo formato que secure-store)
  const der = privateKey.export({ type: 'pkcs8', format: 'der' });
  secureStore.writeEnvelope(
    path.join(keys, 'mipos_private.enc.pem'),
    secureStore.encrypt(der.toString('base64'), TEST_PASS),
  );

  // Clave trial (pública + privada en claro) para las pruebas de la familia trial
  const trial = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(
    path.join(keys, 'trial_public.pem'),
    trial.publicKey.export({ type: 'spki', format: 'pem' }),
  );
  fs.writeFileSync(
    path.join(keys, 'trial_private.pem'),
    trial.privateKey.export({ type: 'pkcs8', format: 'pem' }),
  );

  const prevEnv = {
    POSKY_HOME: process.env.POSKY_HOME,
    POSKY_KEYS_DIR: process.env.POSKY_KEYS_DIR,
    POSKY_OUT_DIR: process.env.POSKY_OUT_DIR,
    LIC_PASS: process.env.LIC_PASS,
  };

  process.env.POSKY_HOME = home;
  process.env.POSKY_KEYS_DIR = keys;
  process.env.POSKY_OUT_DIR = out;
  process.env.LIC_PASS = TEST_PASS;

  function cleanup() {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(base, { recursive: true, force: true });
  }

  return { base, home, keys, out, pass: TEST_PASS, cleanup };
}

module.exports = { makeEnv, TEST_PASS };
