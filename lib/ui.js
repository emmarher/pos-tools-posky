/**
 * lib/ui.js — Capa de presentación de la TUI.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Envoltorio sobre @clack/prompts con dos modos:
 *
 *   - INTERACTIVO (TTY): prompts ricos, con navegación por flechas.
 *   - NO INTERACTIVO (pipe / CI): se usan los argumentos de la línea de
 *     comandos; los prompts que falten fallan con un mensaje claro.
 *
 * Todos los prompts devuelven `null` si el usuario cancela (Ctrl+C / ESC),
 * para que el comando pueda salir limpiamente.
 * ─────────────────────────────────────────────────────────────────────
 */
const p = require('@clack/prompts');

/** ¿Estamos en una terminal interactiva? */
function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function notInteractiveError(what) {
  return new Error(
    `Falta ${what} y no hay terminal interactiva.\n` +
    'Pasalo como argumento en la línea de comandos (ver --help).',
  );
}

function intro(message) {
  if (isInteractive()) p.intro(message);
  else console.log(`\n=== ${message} ===`);
}

function outro(message) {
  if (isInteractive()) p.outro(message);
  else if (message) console.log(message);
}

function note(message, title) {
  if (isInteractive()) p.note(message, title);
  else console.log(`\n[${title || 'nota'}]\n${message}`);
}

function success(message) {
  if (isInteractive()) p.log.success(message);
  else console.log(`✓ ${message}`);
}

function error(message) {
  if (isInteractive()) p.log.error(message);
  else console.error(`✗ ${message}`);
}

function warn(message) {
  if (isInteractive()) p.log.warn(message);
  else console.warn(`! ${message}`);
}

function info(message) {
  if (isInteractive()) p.log.info(message);
  else console.log(`· ${message}`);
}

function step(message) {
  if (isInteractive()) p.log.step(message);
  else console.log(`→ ${message}`);
}

/** Texto libre. Devuelve null si se cancela. */
async function text(opts) {
  if (!isInteractive()) throw notInteractiveError(opts.message || 'el valor');
  const value = await p.text(opts);
  return p.isCancel(value) ? null : value;
}

/** Confirmación sí/no. Devuelve null si se cancela. */
async function confirm(opts) {
  if (!isInteractive()) throw notInteractiveError('la confirmación');
  const value = await p.confirm(opts);
  return p.isCancel(value) ? null : value;
}

/** Selección única. Devuelve null si se cancela. */
async function select(opts) {
  if (!isInteractive()) throw notInteractiveError('la opción');
  const value = await p.select(opts);
  return p.isCancel(value) ? null : value;
}

/** Selección múltiple. Devuelve null si se cancela. */
async function multiselect(opts) {
  if (!isInteractive()) throw notInteractiveError('las opciones');
  const value = await p.multiselect(opts);
  return p.isCancel(value) ? null : value;
}

/** Entrada de contraseña (enmascarada). Devuelve null si se cancela. */
async function password(opts) {
  if (!isInteractive()) throw notInteractiveError('la passphrase');
  const value = await p.password(opts);
  return p.isCancel(value) ? null : value;
}

/** Spinner de operación en curso. */
function spinner() {
  const s = isInteractive() ? p.spinner() : null;
  return {
    start(message) {
      if (s) s.start(message);
      else process.stdout.write(`… ${message}\n`);
    },
    message(message) {
      if (s) s.message(message);
    },
    stop(message, code = 0) {
      if (s) s.stop(message, code);
      else if (message) console.log(message);
    },
  };
}

/** Salida por cancelación. */
function cancel(message = 'Operación cancelada.') {
  if (isInteractive()) p.cancel(message);
  else console.error(message);
  process.exit(0);
}

/** Imprime una tabla simple (sin dependencias). */
function table(rows, headers) {
  const all = headers ? [headers, ...rows] : rows;
  const widths = [];
  for (const row of all) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] || 0, String(cell).length);
    });
  }
  const line = (row) =>
    row.map((cell, i) => String(cell).padEnd(widths[i])).join('  ').trimEnd();

  if (headers) {
    console.log(line(headers));
    console.log(widths.map((w) => '─'.repeat(w)).join('  '));
  }
  for (const row of rows) console.log(line(row));
}

module.exports = {
  isInteractive,
  intro,
  outro,
  note,
  success,
  error,
  warn,
  info,
  step,
  text,
  confirm,
  select,
  multiselect,
  password,
  spinner,
  cancel,
  table,
  clack: p,
};
