#!/usr/bin/env node
/**
 * renew-license.js — Renueva una licencia (misma lic_id, fecha extendida).
 *
 * ─────────────────────────────────────────────────────────────────────
 * Uso:  LIC_PASS="..." node renew-license.js LIC-2026-000123 2028-01-01
 *
 *   process.argv[2] = lic_id     (ej: LIC-2026-000123)
 *   process.argv[3] = new_expiry (fecha ISO, ej: 2028-01-01T00:00:00Z)
 *
 * Wrapper de `posky renew`. Se conserva el lic_id original (no se regala
 * tiempo) y se sobreescribe el .lic con la nueva firma.
 * ─────────────────────────────────────────────────────────────────────
 */
const core = require('./lib/core.js');

function main() {
  const passphrase = process.env.LIC_PASS || process.env.POSKY_PASS;
  if (!passphrase) {
    console.error('✗  Falta LIC_PASS. Uso: LIC_PASS="..." node renew-license.js ...');
    console.error('    (o usá la TUI: node bin/posky.js renew)');
    process.exit(1);
  }

  const licId = process.argv[2];
  const newExpiry = process.argv[3];

  if (!licId || !newExpiry) {
    console.error('✗  Uso: LIC_PASS="..." node renew-license.js <lic_id> <new_expiry>');
    process.exit(1);
  }

  const result = core.renewLicense({ licId, newExpiry, passphrase });

  console.log(`\n✓  Licencia renovada: ${licId}`);
  console.log(`  Fecha anterior:         ${result.prevExpires}`);
  console.log(`  Nueva fecha de expiración: ${result.payload.expires}`);
  console.log(`  Archivo actualizado: ${result.filePath}`);
}

try {
  main();
} catch (err) {
  console.error(`✗  ${err.message}`);
  process.exit(1);
}
