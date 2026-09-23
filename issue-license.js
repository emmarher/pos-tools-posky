#!/usr/bin/env node
/**
 * tools/issue-license.js — Emite una nueva licencia firmada Ed25519.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Uso:  LIC_PASS="..." node tools/issue-license.js "Cliente" sucursal-1 LICENSE-0001 5
 *
 * Args:
 *   process.argv[2] = customer    (nombre del cliente, ej: "Abarrotes La Esquina")
 *   process.argv[3] = branch      (sucursal, ej: "sucursal-centro")
 *   process.argv[4] = license_key (tenant code, ej: DEMO-0001)
 *   process.argv[5] = seats       (número de asientos/dispositivos)
 *   process.argv[6+] = features   (opcional: --features inventory garage reports)
 *
 * La passphrase de la clave privada viene de LIC_PASS (env var),
 * NUNCA hardcodeada. La licencia emitida se guarda en tools/out/{lic_id}.lic
 * y se registra en tools/registry.json con historial.
 * ─────────────────────────────────────────────────────────────────────
 */
const path = require('path');
const {
  loadPrivateKey,
  signLicense,
  generateLicenseId,
  today,
  inOneYear,
  loadRegistry,
  saveRegistry,
  LICENSE_SCHEMA_VERSION,
} = require('./lib/licenseLib.js');

function main() {
  const passphrase = process.env.LIC_PASS;
  if (!passphrase) {
    console.error('✗  Falta LIC_PASS. Uso: LIC_PASS="..." node tools/issue-license.js ...');
    process.exit(1);
  }

  const customer = process.argv[2];
  const branch = process.argv[3];
  const licenseKey = process.argv[4];
  const seats = parseInt(process.argv[5], 10);

  if (!customer || !branch || !licenseKey || !Number.isFinite(seats) || seats < 1) {
    console.error('✗  Uso: node tools/issue-license.js <customer> <branch> <license_key> <seats> [--features f1 f2 ...]');
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
  if (features.length === 0) {
    features.push('inventory', 'garage', 'reports'); // defaults del PRD
  }

  // Cargar registry para generar ID secuencial
  const registry = loadRegistry();

  // Generar ID de licencia
  const licId = generateLicenseId(registry);

  // Construir payload
  const payload = {
    schema: LICENSE_SCHEMA_VERSION,
    lic_id: licId,
    license_key: licenseKey,
    customer: customer,
    branch: branch,
    seats: seats,
    features: features,
    issued: today(),
    expires: inOneYear(),
    hw_fingerprint: null,
  };

  // Cargar clave privada y firmar
  const privateKey = loadPrivateKey(passphrase);
  const licString = signLicense(payload, privateKey);

  // Guardar .lic en tools/out/
  const fs = require('fs');
  const outDir = path.join(__dirname, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const licPath = path.join(outDir, `${licId}.lic`);
  fs.writeFileSync(licPath, licString, 'utf8');

  // Registrar en registry.json
  registry[licId] = {
    customer: customer,
    license_key: licenseKey,
    branch: branch,
    current_expires: payload.expires,
    current_seats: seats,
    status: 'active',
    history: [
      {
        action: 'issued',
        expires: payload.expires,
        seats: seats,
        features: features,
        issued: payload.issued,
        at: new Date().toISOString(),
      },
    ],
  };
  saveRegistry(registry);

  console.log(`\n✓  Licencia emitida: ${licId}`);
  console.log(`  Cliente:    ${customer}`);
  console.log(`  Sucursal:   ${branch}`);
  console.log(`  License key: ${licenseKey}`);
  console.log(`  Asientos:   ${seats}`);
  console.log(`  Features:   ${features.join(', ')}`);
  console.log(`  Expira:     ${payload.expires}`);
  console.log(`\n  Archivo:    ${licPath}`);
  console.log(`  Registry:   tools/registry.json`);
  console.log(`\n  Siguiente paso: copia ${licId}.lic a la carpeta de datos del server`);
  console.log(`  (${process.env.LICENSE_FILE_PATH || '~/.pos/license.lic'})`);
}

main();
