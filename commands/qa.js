/**
 * commands/qa.js — `posky qa` — Verifica un .lic de punta a punta.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Uso:
 *   posky qa LIC-2026-000001.lic
 *   posky qa LIC-2026-000001.lic --server http://localhost:3000
 *   posky qa LIC-2026-000001.lic --server http://localhost:3000 --token <JWT>
 *
 * Verifica (en local):
 *   1. Formato payload.firma
 *   2. Firma Ed25519 (familia de producción o de trial)
 *   3. Versión de esquema soportada
 *   4. Campos obligatorios (license_key, seats, customer, expires)
 *   5. Vigencia (informativa)
 *
 * Con --server, además prueba el endpoint real del servidor:
 *   GET  /license/status   → estado del server
 *   POST /license/upload   →Activation del .lic (necesita token o bootstrap)
 *
 * Esto cubre el hueco histórico: nunca se había probado en vivo una
 * licencia firmada con la clave de PRODUCCIÓN contra un pos-server real.
 * ─────────────────────────────────────────────────────────────────────
 */
const fs = require('fs');
const path = require('path');
const ui = require('../lib/ui.js');
const core = require('../lib/core.js');
const http = require('../lib/http.js');
const { LICENSE_SCHEMA_VERSION } = require('../lib/licenseLib.js');

const findings = [];

function add(status, label, message) {
  findings.push({ status, label, message });
}

async function run(ctx) {
  const { positional, flags } = ctx;
  findings.length = 0;

  let target = positional[0];
  if (!target) {
    const files = core.listLicenseFiles();
    if (files.length === 0) {
      ui.error('No hay licencias emitidas para verificar.');
      process.exitCode = 1;
      return;
    }
    target = await ui.select({
      message: '¿Qué licencia verificamos?',
      options: files.map((f) => ({ value: f, label: path.basename(f) })),
    });
  }

  const filePath = path.resolve(String(target));
  if (!fs.existsSync(filePath)) {
    ui.error(`No existe el archivo: ${filePath}`);
    process.exitCode = 1;
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8').trim();

  // 1) Formato
  const parts = content.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    add('fail', 'Formato', 'No tiene la forma payload.firma');
    ui.error('Formato inválido: se espera "base64url(payload).base64url(firma)".');
    process.exitCode = 1;
    return;
  }
  add('ok', 'Formato', 'payload.firma');

  // 2) Firma
  let payload = null;
  const main = core.verifyLicenseFile(content);
  if (main.valid) {
    payload = main.payload;
    add('ok', 'Firma', 'válida (familia de producción)');
  } else {
    const trial = core.verifyTrialLicenseFile(content);
    if (trial.valid) {
      payload = trial.payload;
      add('ok', 'Firma', 'válida (familia trial)');
    } else {
      add('fail', 'Firma', main.error || 'inválida');
    }
  }

  if (!payload) {
    ui.error('La firma no valida. La licencia fue alterada o el server tiene otra clave.');
    process.exitCode = 1;
    return;
  }

  // 3) Esquema
  if (typeof payload.schema === 'number' && payload.schema <= LICENSE_SCHEMA_VERSION) {
    add('ok', 'Esquema', `v${payload.schema} (soportado: <= v${LICENSE_SCHEMA_VERSION})`);
  } else {
    add('fail', 'Esquema', `v${payload.schema} — el server soporta hasta v${LICENSE_SCHEMA_VERSION}`);
  }

  // 4) Campos obligatorios
  const required = ['license_key', 'customer', 'expires'];
  const missing = required.filter((f) => !payload[f]);
  if (missing.length === 0) {
    add('ok', 'Campos', 'license_key, customer y expires presentes');
  } else {
    add('fail', 'Campos', `faltan: ${missing.join(', ')}`);
  }

  if (Number.isFinite(payload.seats) && payload.seats >= 1) {
    add('ok', 'Asientos', String(payload.seats));
  } else {
    add('fail', 'Asientos', `valor inválido: ${payload.seats}`);
  }

  // 5) Vigencia
  const expires = payload.expires ? new Date(payload.expires) : null;
  if (expires && !Number.isNaN(expires.getTime())) {
    const days = Math.ceil((expires.getTime() - Date.now()) / 86400000);
    if (days > 0) {
      add('ok', 'Vigencia', `expira ${payload.expires} (${days} día/s)`);
    } else {
      add('warn', 'Vigencia', `expira ${payload.expires} (vencida hace ${-days} día/s)`);
    }
  } else {
    add('fail', 'Vigencia', `fecha inválida: ${payload.expires}`);
  }

  // ── Chequeo contra el server ──
  if (flags.server) {
    const server = String(flags.server).replace(/\/$/, '');
    try {
      const status = await http.request(`${server}/license/status`);
      if (status.status === 200) {
        const d = status.data && status.data.data;
        add('ok', 'Server /license/status', `${status.status} · ${d ? `status=${d.status}` : 'ok'}`);
      } else if (status.status === 404) {
        add('warn', 'Server /license/status', '404 — el server no tiene licencia cargada');
      } else {
        add('warn', 'Server /license/status', `HTTP ${status.status}`);
      }
    } catch (e) {
      add('fail', 'Server /license/status', `no se pudo conectar: ${e.message}`);
    }

    try {
      const upload = await http.request(`${server}/license/upload`, {
        method: 'POST',
        token: typeof flags.token === 'string' ? flags.token : undefined,
        body: { license_data: content },
      });
      if (upload.status === 200) {
        add('ok', 'Server /license/upload', '200 — licencia aceptada');
      } else if (upload.status === 401 || upload.status === 403) {
        add('warn', 'Server /license/upload',
          `HTTP ${upload.status} — hace falta un token de admin (settings:manage) o que el server esté en bootstrap`);
      } else {
        const msg = upload.data && upload.data.message ? upload.data.message : '';
        add('warn', 'Server /license/upload', `HTTP ${upload.status} ${msg}`);
      }
    } catch (e) {
      add('fail', 'Server /license/upload', `no se pudo conectar: ${e.message}`);
    }
  }

  // ── Reporte ──
  ui.note(
    [
      `Archivo:      ${filePath}`,
      `lic_id:       ${payload.lic_id || '—'}`,
      `Cliente:      ${payload.customer || '—'}`,
      `Sucursal:     ${payload.branch || '—'}`,
      `License key:  ${payload.license_key || '—'}`,
      `Asientos:     ${payload.seats ?? '—'}`,
      `Features:     ${(payload.features || []).join(', ') || '—'}`,
      `Emitida:      ${payload.issued || '—'}`,
      `Expira:       ${payload.expires || '—'}`,
      `Fingerprint:  ${payload.hw_fingerprint ?? 'null'}`,
    ].join('\n'),
    'Payload',
  );

  console.log('');
  const icon = { ok: '✓', warn: '!', fail: '✗' };
  for (const f of findings) {
    const line = `${icon[f.status]} ${f.label.padEnd(24)} ${f.message}`;
    if (f.status === 'fail') console.error(line);
    else if (f.status === 'warn') console.warn(line);
    else console.log(line);
  }
  console.log('');

  const fails = findings.filter((f) => f.status === 'fail').length;
  if (fails) {
    ui.error(`${fails} verificación(es) fallaron.`);
    process.exitCode = 1;
  } else {
    ui.success('La licencia pasó todas las verificaciones.');
  }
  ui.outro('');

  return findings;
}

module.exports = { run };
