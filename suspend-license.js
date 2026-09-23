#!/usr/bin/env node
/**
 * tools/suspend-license.js — Suspende una licencia (modo degradado forzado).
 *
 * ─────────────────────────────────────────────────────────────────────
 * Uso:  LIC_PASS="..." node tools/suspend-license.js LIC-2026-000123
 *
 * Args:
 *   process.argv[2] = lic_id (ej: LIC-2026-000123)
 *
 * Marca la licencia como suspendida estableciendo `expires` en el pasado.
 * El cliente pasa a modo degradado (ventas bloqueadas, datos intactos).
 * Se conserva el lic_id — para reactivar, emite una renovación normal
 * (renew-license.js) que restablece la fecha futura.
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
    console.error('✗  Falta LIC_PASS. Uso: LIC_PASS="..." node tools/suspend-license.js ...');
    process.exit(1);
  }

  const licId = process.argv[2];
  if (!licId) {
    console.error('✗  Uso: LIC_PASS="..." node tools/suspend-license.js <lic_id>');
    process.exit(1);
  }

  const registry = loadRegistry();
  const entry = registry[licId];
  if (!entry) {
    console.error(`✗  Licencia no encontrada en registry: ${licId}`);
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

  // Decodificar payload, establecer expires en el pasado (suspensión)
  const payload = readLicense(existingLic);
  const originalExpiry = payload.expires;
  payload.expires = new Date(Date.now() - 86400000).toISOString(); // 1 día en el pasado

  // Firmar con la nueva fecha
  const privateKey = loadPrivateKey(passphrase);
  const licString = signLicense(payload, privateKey);

  // Sobreescribir .lic
  fs.writeFileSync(existingLicPath, licString, 'utf8');

  // Actualizar registry
  entry.status = 'suspended';
  entry.history.push({
    action: 'suspended',
    prev_expires: originalExpiry,
    at: new Date().toISOString(),
  });
  saveRegistry(registry);

  console.log(`\n✓  Licencia suspendida: ${licId}`);
  console.log(`  Cliente: ${entry.customer}`);
  console.log(`  Fecha original: ${originalExpiry}`);
  console.log(`  Archivo actualizado: ${existingLicPath}`);
  console.log(`  El cliente está en modo degradado (ventas bloqueadas, datos intactos)`);
}
