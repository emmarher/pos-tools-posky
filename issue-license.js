#!/usr/bin/env node
/**
 * issue-license.js — Emite una nueva licencia firmada Ed25519.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Uso:  LIC_PASS="..." node issue-license.js "Cliente" sucursal-1 LICENSE-0001 5
 *
 *   process.argv[2] = customer    (nombre del cliente)
 *   process.argv[3] = branch      (sucursal)
 *   process.argv[4] = license_key (tenant code del login)
 *   process.argv[5] = seats       (número de asientos/dispositivos)
 *   process.argv[6+] = features   (opcional: --features inventory garage reports)
 *
 * Este script es un wrapper de `posky issue` y se mantiene por compatibilidad
 * con los flujos automatizados. La TUI (bin/posky.js) es la vía principal.
 *
 * El registry se guarda CIFRADO en $POSKY_HOME/registry.json.enc
 * (antes: tools-posky/registry.json en claro dentro del repo).
 * ─────────────────────────────────────────────────────────────────────
 */
const path = require('path');
const core = require('./lib/core.js');
const paths = require('./lib/paths.js');

function main() {
  const passphrase = process.env.LIC_PASS || process.env.POSKY_PASS;
  if (!passphrase) {
    console.error('✗  Falta LIC_PASS. Uso: LIC_PASS="..." node issue-license.js ...');
    console.error('    (o usá la TUI: node bin/posky.js issue)');
    process.exit(1);
  }

  const customer = process.argv[2];
  const branch = process.argv[3];
  const licenseKey = process.argv[4];
  const seats = parseInt(process.argv[5], 10);

  if (!customer || !branch || !licenseKey || !Number.isFinite(seats) || seats < 1) {
    console.error('✗  Uso: node issue-license.js <customer> <branch> <license_key> <seats> [--features f1 f2 ...]');
    process.exit(1);
  }

  // Features: opcional, después de --features
  const features = [];
  const featureIdx = process.argv.indexOf('--features');
  if (featureIdx !== -1) {
    for (let i = featureIdx + 1; i < process.argv.length; i++) {
      if (process.argv[i].startsWith('--')) break;
      features.push(process.argv[i]);
    }
  }

  const result = core.issueLicense({
    customer,
    branch,
    licenseKey,
    seats,
    features: features.length ? features : core.DEFAULT_FEATURES,
    passphrase,
  });

  console.log(`\n✓  Licencia emitida: ${result.licId}`);
  console.log(`  Cliente:    ${result.payload.customer}`);
  console.log(`  Sucursal:   ${result.payload.branch}`);
  console.log(`  License key: ${result.payload.license_key}`);
  console.log(`  Asientos:   ${result.payload.seats}`);
  console.log(`  Features:   ${result.payload.features.join(', ')}`);
  console.log(`  Expira:     ${result.payload.expires}`);
  console.log(`\n  Archivo:    ${result.filePath}`);
  console.log(`  Registry:   ${paths.registryFile()} (cifrado)`);
  console.log(`\n  Siguiente paso: copia ${result.licId}.lic al cliente`);
  console.log(`  y subilo desde el wizard de activación.`);
}

main();
