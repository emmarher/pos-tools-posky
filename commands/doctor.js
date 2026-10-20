/**
 * commands/doctor.js — `posky doctor` — Diagnóstico del toolkit.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Uso:
 *   posky doctor           (checks sin tocar la clave privada)
 *   posky doctor --full    (además descifra la clave y el registry)
 *
 * Cada check devuelve: ok | warn | fail, con un mensaje explicativo.
 * ─────────────────────────────────────────────────────────────────────
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ui = require('../lib/ui.js');
const paths = require('../lib/paths.js');
const keychain = require('../lib/keychain.js');
const registryStore = require('../lib/registry.js');
const passphraseLib = require('../lib/passphrase.js');

const results = [];

function check(name, status, message) {
  results.push({ name, status, message });
  return status;
}

/** Intenta escribir un archivo temporal para comprobar permisos. */
function canWrite(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.posky-probe-${process.pid}`);
    fs.writeFileSync(probe, 'x');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

async function run(ctx) {
  const { flags } = ctx;
  const full = Boolean(flags.full);

  results.length = 0;

  // 1) Node
  const major = Number(process.versions.node.split('.')[0]);
  check(
    'Node.js',
    major >= 18 ? 'ok' : 'fail',
    `v${process.versions.node} ${major >= 18 ? '(ok)' : '(se requiere >= 18)'}`,
  );

  // 2) POSKY_HOME
  const home = paths.poskyHome();
  check(
    'POSKY_HOME',
    fs.existsSync(home) ? 'ok' : 'warn',
    fs.existsSync(home) ? home : `${home} (no existe todavía)`,
  );
  check(
    'POSKY_HOME escribible',
    canWrite(home) ? 'ok' : 'fail',
    canWrite(home) ? 'sí' : 'no se puede escribir — revisar permisos',
  );

  // 3) Claves
  const keysDir = paths.keysDir();
  const pub = path.join(keysDir, paths.KEY_FILES.public);
  const priv = path.join(keysDir, paths.KEY_FILES.privateEncrypted);
  const trialPub = path.join(keysDir, paths.KEY_FILES.trialPublic);

  check('Clave pública (producción)', fs.existsSync(pub) ? 'ok' : 'fail',
    fs.existsSync(pub) ? pub : `falta ${pub}`);
  check('Clave privada cifrada', fs.existsSync(priv) ? 'ok' : 'fail',
    fs.existsSync(priv) ? priv : `falta ${priv}`);
  check('Clave pública (trial)', fs.existsSync(trialPub) ? 'ok' : 'warn',
    fs.existsSync(trialPub) ? trialPub : `falta ${trialPub} (solo para POST /license/trial)`);

  // 4) Registry
  const regFile = paths.registryFile();
  const regExists = fs.existsSync(regFile);
  check('Registry cifrado', regExists ? 'ok' : 'warn',
    regExists ? regFile : `${regFile} (se crea en la primera emisión)`);

  // 5) Carpeta de .lic emitidos
  const out = paths.outDir();
  const outOk = canWrite(out);
  check('Carpeta out/', outOk ? 'ok' : 'fail', out);

  // 6) Clave embebida en pos-server
  const embedded = path.resolve(paths.REPO_ROOT, '../pos-server/src/keys/publicKey.ts');
  if (!fs.existsSync(embedded)) {
    check('pos-server publicKey.ts', 'warn', 'pos-server no encontrado (¿se está en otro repo?)');
  } else if (!fs.existsSync(pub)) {
    check('pos-server publicKey.ts', 'warn', 'sin clave pública para comparar');
  } else {
    const content = fs.readFileSync(embedded, 'utf8').replace(/\s+/g, '');
    const pubPem = fs.readFileSync(pub, 'utf8').replace(/\s+/g, '');
    check(
      'pos-server publicKey.ts',
      content.includes(pubPem) ? 'ok' : 'fail',
      content.includes(pubPem)
        ? 'coincide con la clave pública de producción'
        : 'DIFIERE — el server tiene otra clave. Corré: cd pos-server && npm run build:keys',
    );
  }

  // 7) Keychain
  check(
    'Keychain del sistema',
    keychain.isSupported() ? 'ok' : 'warn',
    keychain.isSupported() ? keychain.backendName() : 'no disponible en esta plataforma',
  );

  // 8) Legacy: registry plano todavía en el repo
  const legacy = paths.legacyRegistryFile();
  if (fs.existsSync(legacy)) {
    check('Registry plano heredado', 'warn',
      `${legacy} — migrar a cifrado: posky doctor --migrar`);
  }

  // --- checks profundos ---
  if (full && fs.existsSync(priv) && fs.existsSync(regFile)) {
    let passphrase = null;
    try {
      passphrase = await passphraseLib.resolveAsync({
        prompt: 'Passphrase de la clave privada (para el chequeo profundo):',
      });
    } catch {
      check('Descifrado', 'warn', 'sin passphrase — se omiten los chequeos profundos');
    }

    if (passphrase) {
      try {
        require('../lib/licenseLib.js').loadPrivateKey(passphrase, priv);
        check('Descifrado de la clave privada', 'ok', 'passphrase correcta');
      } catch (e) {
        check('Descifrado de la clave privada', 'fail', e.message);
      }

      try {
        const reg = registryStore.load(passphrase);
        check('Descifrado del registry', 'ok', `${Object.keys(reg).length} licencia(s)`);
      } catch (e) {
        check('Descifrado del registry', 'fail', e.message);
      }
    }
  }

  // --- migración ---
  if (flags.migrar) {
    const passphrase = await passphraseLib.resolveAsync({
      prompt: 'Passphrase para cifrar el registry migrado:',
    });
    const res = registryStore.migrateLegacy(passphrase);
    const copied = registryStore.migrateLegacyOut();
    if (res.migrated) {
      ui.success(`Registry migrado: ${res.from} → ${res.to} (${res.count} licencia(s))`);
    } else {
      ui.info('No hay nada que migrar.');
    }
    if (copied > 0) ui.success(`${copied} archivo(s) .lic copiados a ${paths.outDir()}`);
    ui.outro('');
  }

  // --- reporte ---
  const icon = { ok: '✓', warn: '!', fail: '✗' };
  console.log('');
  for (const r of results) {
    const line = `${icon[r.status]} ${r.name.padEnd(28)} ${r.message}`;
    if (r.status === 'fail') console.error(line);
    else if (r.status === 'warn') console.warn(line);
    else console.log(line);
  }
  console.log('');

  const fails = results.filter((r) => r.status === 'fail').length;
  const warns = results.filter((r) => r.status === 'warn').length;

  if (fails) {
    ui.error(`${fails} check(s) fallaron, ${warns} aviso(s).`);
    process.exitCode = 1;
  } else if (warns) {
    ui.warn(`Todo ok con ${warns} aviso(s).`);
  } else {
    ui.success('Todo ok.');
  }
  ui.outro('');

  return results;
}

module.exports = { run };
