/**
 * commands/suspend.js — `posky suspend` — Suspende una licencia.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Uso:
 *   posky suspend LIC-2026-000001
 *   posky suspend LIC-2026-000001 --reactivar
 *
 * Suspender pone `expires` en el pasado: el cliente entra en modo degradado
 * (ventas bloqueadas, datos intactos). Los datos NO se borran.
 * Para reactivar: `posky renew <lic_id>` con una fecha futura.
 * ─────────────────────────────────────────────────────────────────────
 */
const ui = require('../lib/ui.js');
const core = require('../lib/core.js');
const passphraseLib = require('../lib/passphrase.js');

async function run(ctx) {
  const { positional, flags } = ctx;

  const licId = positional[0] || await ui.text({
    message: 'Licencia a suspender (lic_id)',
    placeholder: 'LIC-2026-000001',
    validate: (v) => (v && v.trim() ? undefined : 'El lic_id es obligatorio'),
  });

  const passphrase = await passphraseLib.resolveAsync({
    prompt: 'Passphrase de la clave privada:',
  });

  if (flags.reactivar) {
    const result = core.renewLicense({
      licId,
      newExpiry: core.daysFromNow(Number(flags.days) || 365),
      passphrase,
    });
    ui.success(`Licencia reactivada: ${licId} (expira ${result.payload.expires})`);
    return result;
  }

  const result = core.suspendLicense({ licId, passphrase });

  ui.success(`Licencia suspendida: ${licId}`);
  ui.note(
    [
      `Cliente:        ${result.payload.customer}`,
      `Fecha original: ${result.originalExpiry}`,
      `Archivo:        ${result.filePath}`,
    ].join('\n'),
    'Detalle',
  );
  ui.warn('El cliente queda en modo degradado (ventas bloqueadas, datos intactos).');
  ui.outro('Para reactivar: posky renew <lic_id>.');

  return result;
}

module.exports = { run };
