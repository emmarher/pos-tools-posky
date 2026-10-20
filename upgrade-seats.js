#!/usr/bin/env node
/**
 * upgrade-seats.js — Amplía (o reduce) el número de asientos de una licencia.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Uso:  LIC_PASS="..." node upgrade-seats.js LIC-2026-000123 8
 *
 *   process.argv[2] = lic_id    (ej: LIC-2026-000123)
 *   process.argv[3] = new_seats (número de asientos, ej: 8)
 *
 * El tiempo NO se regala ni se reinicia: la fecha de expiración se mantiene.
 * Se conserva el lic_id y todos los demás campos.
 *
 * Wrapper de `posky seats`.
 * ─────────────────────────────────────────────────────────────────────
 */
const core = require('./lib/core.js');

function main() {
  const passphrase = process.env.LIC_PASS || process.env.POSKY_PASS;
  if (!passphrase) {
    console.error('✗  Falta LIC_PASS. Uso: LIC_PASS="..." node upgrade-seats.js ...');
    console.error('    (o usá la TUI: node bin/posky.js seats)');
    process.exit(1);
  }

  const licId = process.argv[2];
  const newSeats = parseInt(process.argv[3], 10);

  if (!licId || !Number.isFinite(newSeats) || newSeats < 1) {
    console.error('✗  Uso: LIC_PASS="..." node upgrade-seats.js <lic_id> <new_seats>');
    process.exit(1);
  }

  const result = core.updateSeats({ licId, newSeats, passphrase });

  console.log(`\n✓  Asientos actualizados: ${licId}`);
  console.log(`  ${result.oldSeats} → ${result.payload.seats} asientos`);
  console.log(`  Fecha de expiración sin cambios: ${result.payload.expires}`);
  console.log(`  Archivo actualizado: ${result.filePath}`);
}

try {
  main();
} catch (err) {
  console.error(`✗  ${err.message}`);
  process.exit(1);
}
