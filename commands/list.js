/**
 * commands/list.js — `posky list` — Lista las licencias emitidas.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Uso:
 *   posky list
 *   posky list --json
 *
 * Lee el registry cifrado (hace falta la passphrase) y lo muestra como tabla.
 * Con --json vuelca el registry completo (para exportar / backup).
 * ─────────────────────────────────────────────────────────────────────
 */
const ui = require('../lib/ui.js');
const registryStore = require('../lib/registry.js');
const passphraseLib = require('../lib/passphrase.js');

function statusLabel(status) {
  if (status === 'suspended') return 'suspendida';
  if (status === 'active') return 'activa';
  return status || '—';
}

function expiryLabel(expires) {
  if (!expires) return '—';
  const d = new Date(expires);
  if (Number.isNaN(d.getTime())) return expires;
  const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
  if (days < 0) return `${expires} (vencida)`;
  if (days === 0) return `${expires} (vence hoy)`;
  return `${expires} (${days}d)`;
}

async function run(ctx) {
  const { flags } = ctx;

  const passphrase = await passphraseLib.resolveAsync({
    prompt: 'Passphrase de la clave privada:',
  });

  const reg = registryStore.load(passphrase);
  const ids = Object.keys(reg).sort();

  if (flags.json) {
    console.log(JSON.stringify(reg, null, 2));
    return reg;
  }

  if (ids.length === 0) {
    ui.info('No hay licencias emitidas todavía.');
    ui.outro('Emití la primera con: posky issue');
    return reg;
  }

  const rows = ids.map((id) => {
    const e = reg[id];
    return [
      id,
      e.customer || '—',
      e.license_key || '—',
      String(e.current_seats ?? '—'),
      expiryLabel(e.current_expires),
      statusLabel(e.status),
    ];
  });

  ui.outro('');
  ui.table(rows, ['LIC_ID', 'CLIENTE', 'LICENSE KEY', 'ASIENTOS', 'EXPIRA', 'ESTADO']);
  console.log('');
  ui.info(`${ids.length} licencia(s). Detalle: posky show <lic_id>`);

  return reg;
}

module.exports = { run };
