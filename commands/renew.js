/**
 * commands/renew.js — `posky renew` — Renueva (extiende) una licencia.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Uso:
 *   posky renew LIC-2026-000001
 *   posky renew LIC-2026-000001 --days 365
 *   posky renew LIC-2026-000001 --expires 2028-01-01T00:00:00Z
 *
 * Conserva el lic_id y todos los campos. NO regala tiempo: la nueva fecha
 * la define el operador. Si la licencia estaba suspendida, queda activa.
 * ─────────────────────────────────────────────────────────────────────
 */
const ui = require('../lib/ui.js');
const core = require('../lib/core.js');
const registryStore = require('../lib/registry.js');
const passphraseLib = require('../lib/passphrase.js');

async function run(ctx) {
  const { positional, flags } = ctx;

  const licId = positional[0] || await ui.text({
    message: 'Licencia a renovar (lic_id)',
    placeholder: 'LIC-2026-000001',
    validate: (v) => (v && v.trim() ? undefined : 'El lic_id es obligatorio'),
  });

  let expires;
  if (flags.expires && typeof flags.expires === 'string') {
    expires = flags.expires;
  } else if (flags.days) {
    expires = core.daysFromNow(Number(flags.days));
  } else {
    const days = await ui.text({
      message: 'Nueva vigencia en días (desde hoy)',
      placeholder: '365',
      initialValue: '365',
      validate: (v) => (Number(v) >= 1 ? undefined : 'Debe ser >= 1'),
    });
    expires = core.daysFromNow(Number(days));
  }

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

  const result = core.renewLicense({ licId, newExpiry: expires, passphrase });

  ui.success(`Licencia renovada: ${licId}`);
  ui.note(
    [
      `Cliente:          ${entry.customer}`,
      `Vencía:           ${result.prevExpires}`,
      `Nueva expiración: ${result.payload.expires}`,
      `Archivo:          ${result.filePath}`,
    ].join('\n'),
    'Detalle',
  );
  ui.outro('Reenviá el .lic al cliente para que lo suba desde el wizard.');

  return result;
}

module.exports = { run };
