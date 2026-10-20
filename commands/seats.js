/**
 * commands/seats.js — `posky seats` — Cambia la cantidad de asientos.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Uso:
 *   posky seats LIC-2026-000001 8
 *   posky seats LIC-2026-000001 8 --reducir
 *
 * NO cambia la fecha de expiración y NO regala tiempo. El `seats` de la
 * licencia es el `max_devices` que el server aplica al tenant.
 * ─────────────────────────────────────────────────────────────────────
 */
const ui = require('../lib/ui.js');
const core = require('../lib/core.js');
const passphraseLib = require('../lib/passphrase.js');

async function run(ctx) {
  const { positional, flags } = ctx;

  const licId = positional[0] || await ui.text({
    message: 'Licencia (lic_id)',
    placeholder: 'LIC-2026-000001',
    validate: (v) => (v && v.trim() ? undefined : 'El lic_id es obligatorio'),
  });

  let seats = positional[1] ? Number(positional[1]) : null;
  if (seats === null || !Number.isFinite(seats)) {
    const answer = await ui.text({
      message: 'Nueva cantidad de asientos',
      placeholder: '8',
      validate: (v) => (Number(v) >= 1 ? undefined : 'Debe ser >= 1'),
    });
    seats = Number(answer);
  }

  const passphrase = await passphraseLib.resolveAsync({
    prompt: 'Passphrase de la clave privada:',
  });

  const result = core.updateSeats({ licId, newSeats: Number(seats), passphrase });

  ui.success(`Asientos actualizados: ${licId}`);
  ui.note(
    [
      `Antes:                   ${result.oldSeats}`,
      `Ahora:                   ${result.payload.seats}`,
      `Expiración (sin cambio): ${result.payload.expires}`,
      `Archivo:                 ${result.filePath}`,
    ].join('\n'),
    'Detalle',
  );

  return result;
}

module.exports = { run };
