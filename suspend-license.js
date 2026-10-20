#!/usr/bin/env node
/**
 * suspend-license.js — Suspende una licencia (modo degradado forzado).
 *
 * ─────────────────────────────────────────────────────────────────────
 * Uso:  LIC_PASS="..." node suspend-license.js LIC-2026-000123
 *
 *   process.argv[2] = lic_id (ej: LIC-2026-000123)
 *
 * Marca la licencia como suspendida estableciendo `expires` en el pasado.
 * El cliente pasa a modo degradado (ventas bloqueadas, datos intactos).
 * Para reactivar: node renew-license.js <lic_id> <fecha futura>.
 *
 * Wrapper de `posky suspend`.
 * ─────────────────────────────────────────────────────────────────────
 */
const core = require('./lib/core.js');

function main() {
  const passphrase = process.env.LIC_PASS || process.env.POSKY_PASS;
  if (!passphrase) {
    console.error('✗  Falta LIC_PASS. Uso: LIC_PASS="..." node suspend-license.js ...');
    console.error('    (o usá la TUI: node bin/posky.js suspend)');
    process.exit(1);
  }

  const licId = process.argv[2];
  if (!licId) {
    console.error('✗  Uso: LIC_PASS="..." node suspend-license.js <lic_id>');
    process.exit(1);
  }

  const result = core.suspendLicense({ licId, passphrase });

  console.log(`\n✓  Licencia suspendida: ${licId}`);
  console.log(`  Cliente: ${result.payload.customer}`);
  console.log(`  Fecha original: ${result.originalExpiry}`);
  console.log(`  Archivo actualizado: ${result.filePath}`);
  console.log(`  El cliente está en modo degradado (ventas bloqueadas, datos intactos)`);
}

try {
  main();
} catch (err) {
  console.error(`✗  ${err.message}`);
  process.exit(1);
}
