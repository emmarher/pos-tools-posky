#!/usr/bin/env node
/**
 * bin/posky.js — Punto de entrada del toolkit de licencias POS.
 *
 * ─────────────────────────────────────────────────────────────────────
 *   posky                       → menú interactivo
 *   posky issue [...]           → emitir licencia
 *   posky renew <lic_id>        → renovar
 *   posky suspend <lic_id>      → suspender / reactivar
 *   posky seats <lic_id> <n>    → cambiar asientos
 *   posky list                  → listar emitidas
 *   posky show <lic_id>         → detalle + historial
 *   posky keys [...]            → claves Ed25519
 *   posky doctor                → diagnóstico
 *   posky qa <archivo.lic>      → verificar un .lic
 *
 * La passphrase de la clave privada se pide en la terminal (enmascarada) o
 * sale de LIC_PASS. Ver lib/passphrase.js.
 * ─────────────────────────────────────────────────────────────────────
 */
const { parse } = require('../lib/args.js');
const ui = require('../lib/ui.js');
const registryStore = require('../lib/registry.js');
const passphraseLib = require('../lib/passphrase.js');

const pkg = require('../package.json');

const COMMANDS = {
  issue: () => require('../commands/issue.js'),
  renew: () => require('../commands/renew.js'),
  suspend: () => require('../commands/suspend.js'),
  seats: () => require('../commands/seats.js'),
  list: () => require('../commands/list.js'),
  show: () => require('../commands/show.js'),
  keys: () => require('../commands/keys.js'),
  doctor: () => require('../commands/doctor.js'),
  qa: () => require('../commands/qa.js'),
};

const MENU = [
  { value: 'issue', label: 'Emitir licencia', hint: 'nueva' },
  { value: 'renew', label: 'Renovar licencia', hint: 'extender vigencia' },
  { value: 'suspend', label: 'Suspender / reactivar', hint: 'modo degradado' },
  { value: 'seats', label: 'Cambiar asientos', hint: 'max_devices' },
  { value: 'list', label: 'Listar licencias', hint: 'ver emitidas' },
  { value: 'show', label: 'Ver detalle', hint: 'una licencia' },
  { value: 'qa', label: 'Verificar un .lic', hint: 'QA' },
  { value: 'keys', label: 'Claves Ed25519', hint: 'generar / verificar' },
  { value: 'doctor', label: 'Diagnóstico', hint: 'chequeos' },
];

function printHelp() {
  console.log(`
posky ${pkg.version} — Toolkit de licencias Ed25519 para POS v4

USO
  posky                          Menú interactivo
  posky <comando> [args]        Comando puntual

COMANDOS
  issue     Emitir una licencia nueva
            posky issue "Cliente" sucursal LICENSE_KEY 3 [--features a b] [--days 365]
  renew     Renovar (extender la vigencia)
            posky renew LIC-2026-000001 [--days 365 | --expires ISO]
  suspend   Suspender una licencia
            posky suspend LIC-2026-000001 [--reactivar]
  seats     Cambiar la cantidad de asientos
            posky seats LIC-2026-000001 8
  list      Listar las licencias emitidas
  show      Ver el detalle y el historial de una licencia
            posky show LIC-2026-000001 [--lic]
  keys      Gestionar las claves Ed25519
            posky keys list | verify | generate | passphrase --save
  doctor    Diagnóstico del toolkit
            posky doctor [--full] [--migrar]
  qa        Verificar un .lic (firma, esquema, campos) y opcionalmente
            contra un server en marcha
            posky qa LIC-2026-000001.lic [--server http://localhost:3000] [--token JWT]

PASSPHRASE
  Se pide en la terminal (enmascarada). Alternativas:
    LIC_PASS="..."            variable de entorno
    posky keys passphrase --save   guardarla en el keychain del sistema

RUTAS
  POSKY_HOME          datos locales (registry cifrado, .lic emitidos) — ~/.pos-posky
  POSKY_KEYS_DIR      carpeta de claves Ed25519
  POSKY_OUT_DIR       carpeta de .lic emitidos
  POSKY_REGISTRY_FILE archivo del registry cifrado
`);
}

/** Menú interactivo principal. */
async function menu() {
  ui.intro('POSky — licencias POS v4');

  let choice;
  for (;;) {
    choice = await ui.select({ message: '¿Qué querés hacer?', options: MENU });
    if (choice === null) {
      ui.cancel('Chau.');
      return;
    }
    break;
  }

  const cmd = COMMANDS[choice]();
  await cmd.run({ positional: [], flags: {} });
}

async function main() {
  const argv = process.argv.slice(2);
  const { positional, flags } = parse(argv);

  if (flags.version) {
    console.log(pkg.version);
    return;
  }

  const command = positional.shift();

  if (!command) {
    if (!ui.isInteractive()) {
      printHelp();
      return;
    }
    await menu();
    return;
  }

  if (flags.help || command === 'help') {
    printHelp();
    return;
  }

  const loader = COMMANDS[command];
  if (!loader) {
    ui.error(`Comando desconocido: ${command}`);
    console.log('');
    printHelp();
    process.exitCode = 1;
    return;
  }

  // Migración del registry plano heredado (silenciosa, idempotente).
  if (command !== 'doctor' && command !== 'keys') {
    try {
      const passphrase = process.env.LIC_PASS || process.env.POSKY_PASS;
      if (passphrase) registryStore.migrateLegacy(passphrase);
    } catch {
      /* la migración no es crítica: el comando reportará el error real */
    }
  }

  const cmd = loader();
  await cmd.run({ positional, flags });
}

main().catch((err) => {
  if (err && err.name === 'PassphraseError') {
    ui.error(err.message);
  } else {
    ui.error(err && err.message ? err.message : String(err));
    if (process.env.POSKY_DEBUG) console.error(err);
  }
  process.exitCode = 1;
});
