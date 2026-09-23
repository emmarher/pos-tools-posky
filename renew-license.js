#!/usr/bin/env node
/**
 * tools/renew-license.js — Renueva una licencia (misma lic_id, fecha extendida).
 *
 * ─────────────────────────────────────────────────────────────────────
 * Uso:  LIC_PASS="..." node tools/renew-license.js LIC-2026-000123 2028-01-01
 *
 * Args:
 *   process.argv[2] = lic_id          (ej: LIC-2026-000123)
 *   process.argv[3] = new_expiry      (fecha ISO, ej: 2028-01-01T00:00:00Z)
 *
 * Se conserva el lic_id original (no se regala tiempo — el cliente paga por
 * la nueva vigencia). Se generan una nueva firma y se sobreescribe el .lic.
 * El registry.json registra el evento con historial.
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
    console.error('✗  Falta LIC_PASS. Uso: LIC_PASS="..." node tools/renew-license.js ...');
    process.exit(1);
  }

  const licId = process.argv[2];
  const newExpiry = process.argv[3];

  if (!licId || !newExpiry) {
    console.error('✗  Uso: LIC_PASS="..." node tools/renew-license.js <lic_id> <new_expiry>');
    process.exit(1);
  }

  const registry = loadRegistry();
  const entry = registry[licId];
  if (!entry) {
    console.error(`✗  Licencia no encontrada en registry: ${licId}`);
    process.exit(1);
  }

  // Cargar la licencia .lic existente para preservar todos los campos
  const fs = require('fs');
  const existingLicPath = path.join(__dirname, 'out', `${licId}.lic`);
  let existingLic;
  try {
    existingLic = fs.readFileSync(existingLicPath, 'utf8');
  } catch (e) {
    console.error(`✗  No se encontró el archivo .lic: ${existingLicPath}`);
    process.exit(1);
  }

  // Decodificar payload existente (sin verificar — ya fue verificado al emitir)
  const payload = readLicense(existingLic);
  payload.expires = newExpiry; // extender fecha

  // Firmar con la nueva fecha
  const privateKey = loadPrivateKey(passphrase);
  const licString = signLicense(payload, privateKey);

  // Sobreescribir .lic
  fs.writeFileSync(existingLicPath, licString, 'utf8');

  // Actualizar registry con historial
  entry.current_expires = newExpiry;
  entry.history.push({
    action: 'renewed',
    prev_expires: entry.current_expires,
    new_expires: newExpiry,
    at: new Date().toISOString(),
  });
  // No cambiamos status (sigue 'active' si no se suspendió)
  saveRegistry(registry);

  console.log(`\n✓  Licencia renovada: ${licId}`);
  console.log(`  Nueva fecha de expiración: ${newExpiry}`);
  console.log(`  Archivo actualizado: ${existingLicPath}`);
}
