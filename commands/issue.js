/**
 * commands/issue.js — `posky issue` — Emite una licencia nueva.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Uso:
 *   posky issue                                          (modo interactivo)
 *   posky issue "Abarrotes La Esquina" sucursal-centro DEMO-0001 3
 *   posky issue "Cliente" sucursal KEY 3 --features inventory reports
 *   posky issue "Cliente" sucursal KEY 3 --days 365
 *
 * El license_key es el tenant code con el que el cliente entra al login.
 * Tras activar el .lic, pos-server adopta ese license_key.
 * ─────────────────────────────────────────────────────────────────────
 */
const ui = require('../lib/ui.js');
const core = require('../lib/core.js');
const passphraseLib = require('../lib/passphrase.js');
const { listFlag } = require('../lib/args.js');

const KNOWN_FEATURES = ['inventory', 'reports', 'garage', 'pricing', 'multi-branch'];

async function run(ctx) {
  const { positional, flags } = ctx;

  const customer = positional[0] || await ui.text({
    message: 'Nombre del cliente',
    placeholder: 'Abarrotes La Esquina',
    validate: (v) => (v && v.trim() ? undefined : 'El cliente es obligatorio'),
  });

  const branch = positional[1] || await ui.text({
    message: 'Sucursal',
    placeholder: 'sucursal-centro',
    validate: (v) => (v && v.trim() ? undefined : 'La sucursal es obligatoria'),
  });

  const licenseKey = positional[2] || await ui.text({
    message: 'License key (tenant code del login)',
    placeholder: 'DEMO-0001',
    validate: (v) => (v && v.trim() ? undefined : 'El license_key es obligatorio'),
  });

  let seats = positional[3] ? Number(positional[3]) : null;
  if (seats === null || !Number.isFinite(seats)) {
    const answer = await ui.text({
      message: 'Cantidad de asientos (dispositivos)',
      placeholder: '3',
      validate: (v) => (Number(v) >= 1 ? undefined : 'Debe ser >= 1'),
    });
    seats = Number(answer);
  }

  let features = listFlag(flags, 'features');
  if (features.length === 0) {
    const chosen = await ui.multiselect({
      message: 'Features habilitadas',
      options: KNOWN_FEATURES.map((f) => ({ value: f, label: f })),
      initialValues: ['inventory', 'reports'],
      required: false,
    });
    features = chosen && chosen.length ? chosen : core.DEFAULT_FEATURES;
  }

  // Vigencia: por defecto 1 año; --days N o --expires ISO
  let expires;
  if (flags.expires && typeof flags.expires === 'string') {
    expires = flags.expires;
  } else if (flags.days) {
    expires = core.daysFromNow(Number(flags.days));
  } else {
    const days = await ui.text({
      message: 'Vigencia en días',
      placeholder: '365',
      initialValue: '365',
      validate: (v) => (Number(v) >= 1 ? undefined : 'Debe ser >= 1'),
    });
    expires = core.daysFromNow(Number(days));
  }

  const passphrase = await passphraseLib.resolveAsync({
    prompt: 'Passphrase de la clave privada:',
  });

  const result = core.issueLicense({
    customer: String(customer).trim(),
    branch: String(branch).trim(),
    licenseKey: String(licenseKey).trim(),
    seats: Number(seats),
    features,
    expires,
    passphrase,
  });

  ui.success(`Licencia emitida: ${result.licId}`);
  ui.note(
    [
      `Cliente:      ${result.payload.customer}`,
      `Sucursal:     ${result.payload.branch}`,
      `License key:  ${result.payload.license_key}`,
      `Asientos:     ${result.payload.seats}`,
      `Features:     ${result.payload.features.join(', ')}`,
      `Emitida:      ${result.payload.issued}`,
      `Expira:       ${result.payload.expires}`,
      `Archivo:      ${result.filePath}`,
    ].join('\n'),
    'Detalle',
  );
  ui.outro('Pasá el .lic al cliente y subilo desde el wizard de activación.');

  return result;
}

module.exports = { run, KNOWN_FEATURES };
