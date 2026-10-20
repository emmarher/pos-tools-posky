/**
 * commands/show.js — `posky show` — Detalle de una licencia.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Uso:
 *   posky show LIC-2026-000001
 *   posky show LIC-2026-000001 --lic      (muestra el contenido del .lic)
 * ─────────────────────────────────────────────────────────────────────
 */
const fs = require('fs');
const ui = require('../lib/ui.js');
const core = require('../lib/core.js');
const registryStore = require('../lib/registry.js');
const passphraseLib = require('../lib/passphrase.js');

async function run(ctx) {
  const { positional, flags } = ctx;

  const licId = positional[0] || await ui.text({
    message: 'Licencia (lic_id)',
    placeholder: 'LIC-2026-000001',
    validate: (v) => (v && v.trim() ? undefined : 'El lic_id es obligatorio'),
  });

  const passphrase = await passphraseLib.resolveAsync({
    prompt: 'Passphrase de la clave privada:',
  });

  const reg = registryStore.load(passphrase);
  const entry = reg[licId];
  if (!entry) {
    ui.error(`Licencia no encontrada en el registry: ${licId}`);
    process.exitCode = 1;
    return null;
  }

  const filePath = core.licFilePath(licId);
  let payload = null;
  if (fs.existsSync(filePath)) {
    payload = core.readLicenseFile(filePath).payload;
  }

  const lines = [
    `Licencia:    ${licId}`,
    `Cliente:     ${entry.customer}`,
    `Sucursal:    ${entry.branch}`,
    `License key: ${entry.license_key}`,
    `Asientos:    ${entry.current_seats}`,
    `Expira:      ${entry.current_expires}`,
    `Estado:      ${entry.status}`,
    `Archivo:     ${filePath}${fs.existsSync(filePath) ? '' : ' (no encontrado)'}`,
  ];
  if (payload) {
    lines.push(`Emitida:     ${payload.issued}`);
    lines.push(`Features:    ${(payload.features || []).join(', ')}`);
  }

  ui.note(lines.join('\n'), `Licencia ${licId}`);

  const history = entry.history || [];
  if (history.length) {
    const rows = history.map((h) => [
      h.action,
      h.at ? new Date(h.at).toISOString().slice(0, 19).replace('T', ' ') : '—',
      h.prev_expires || h.prev_seats || h.expires || '—',
      h.new_expires || h.new_seats || '—',
    ]);
    console.log('');
    ui.table(rows, ['ACCIÓN', 'CUANDO', 'ANTES', 'DESPUÉS']);
  }

  if (flags.lic && fs.existsSync(filePath)) {
    console.log('');
    ui.note(fs.readFileSync(filePath, 'utf8'), 'Contenido del .lic');
  }

  ui.outro('');
  return entry;
}

module.exports = { run };
