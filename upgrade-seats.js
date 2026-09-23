#!/usr/bin/env node
/**
 * tools/upgrade-seats.js — Amplía el número de asientos de una licencia.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Uso:  LIC_PASS="..." node tools/upgrade-seats.js LIC-2026-000123 8
 *
 * Args:
 *   process.argv[2] = lic_id      (ej: LIC-2026-000123)
 *   process.argv[3] = new_seats   (número de asientos, ej: 8)
 *
 * El tiempo NO se regala ni se reinicia: la fecha de expiración se mantiene.
 * Se conserva el lic_id y todos los demás campos. Se firma con una nueva
 * firma y se sobreescribe el .lic + registry.json.
 * ─────────────────────────────────────────────────────────────────────
 */
const path = require('path');
const {
  loadPrivateKey,
  signLicense,
  readLicense,
  loadRegistry,
  saveRegistry,
} = require('./lib/licenseLib.js');

function main() {
  const passphrase = process.env.LIC_PASS;
  if (!passphrase) {
    console.error('✗  Falta LIC_PASS. Uso: LIC_PASS="..." node tools/upgrade-seats.js ...');
    process.exit(1);
  }

  const licId = process.argv[2];
  const newSeats = parseInt(process.argv[3], 10);

  if (!licId || !Number.isFinite(newSeats) || newSeats < 1) {
    console.error('✗  Uso: LIC_PASS="..." node tools/upgrade-seats.js <lic_id> <new_seats>');
    process.exit(1);
  }

  const registry = loadRegistry();
  const entry = registry[licId];
  if (!entry) {
    console.error(`✗  Licencia no encontrada en registry: ${licId}`);
    process.exit(1);
  }

  if (newSeats <= entry.current_seats) {
    console.error(`✗  Los nuevos asientos (${newSeats}) deben ser mayores que los actuales (${entry.current_seats}).`);
    process.exit(1);
  }

  // Cargar la licencia .lic existente
  const fs = require('fs');
  const existingLicPath = path.join(__dirname, 'out', `${licId}.lic`);
  let existingLic;
  try {
    existingLic = fs.readFileSync(existingLicPath, 'utf8');
  } catch (e) {
    console.error(`✗  No se encontró el archivo .lic: ${existingLicPath}`);
    process.exit(1);
  }

  // Decodificar payload, cambiar seats
  const payload = readLicense(existingLic);
  const oldSeats = payload.seats;
  payload.seats = newSeats;

  // Firmar
  const privateKey = loadPrivateKey(passphrase);
  const licString = signLicense(payload, privateKey);

  // Sobreescribir .lic
  fs.writeFileSync(existingLicPath, licString, 'utf8');

  // Actualizar registry
  entry.current_seats = newSeats;
  entry.history.push({
    action: 'upgraded',
    prev_seats: oldSeats,
    new_seats: newSeats,
    at: new Date().toISOString(),
  });
  saveRegistry(registry);

  console.log(`\n✓  Asientos actualizados: ${licId}`);
  console.log(`  ${oldSeats} → ${newSeats} asientos`);
  console.log(`  Fecha de expiración sin cambios: ${payload.expires}`);
  console.log(`  Archivo actualizado: ${existingLicPath}`);
}
