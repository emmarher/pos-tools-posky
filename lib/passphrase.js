/**
 * lib/passphrase.js — Resolución de la passphrase de la clave privada.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Orden de resolución:
 *   1. Variable de entorno  LIC_PASS / POSKY_PASS   (automatización, CI)
 *   2. Keychain del sistema                         (opcional, opt-in)
 *   3. Prompt enmascarado en la terminal            (vía principal)
 *
 * El prompt es SINCRÓNICO a propósito: todo el núcleo de licencias
 * (firmar, leer, escribir) es síncrono y así se mantiene simple.
 * Funciona igual en macOS (Terminal/iTerm) y en Windows (Windows Terminal).
 *
 * La passphrase NUNCA se escribe en disco por este módulo, salvo que el
 * usuario lo pida explícitamente (keychain).
 * ─────────────────────────────────────────────────────────────────────
 */
const fs = require('fs');
const keychain = require('./keychain.js');

class PassphraseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PassphraseError';
  }
}

/**
 * Escribe un prompt de entrada oculta (sin eco) y devuelve lo tecleado.
 * @param {string} question
 * @returns {string}
 */
function promptHidden(question) {
  const stdin = process.stdin;
  const stdout = process.stdout;

  if (!stdin.isTTY) {
    throw new PassphraseError(
      'No hay terminal interactiva para leer la passphrase.\n' +
      'Usá la variable de entorno:  LIC_PASS="..." posky issue ...',
    );
  }

  stdout.write(question);

  const wasRaw = Boolean(stdin.isRaw);
  if (stdin.setRawMode) stdin.setRawMode(true);
  // OJO: NO usar stdin.resume() — el stream se adjudicaría el fd 0 y el
  // fs.readSync de abajo se quedaría sin datos.

  let value = '';
  const chunk = Buffer.alloc(1);

  try {
    for (;;) {
      let bytes = 0;
      try {
        bytes = fs.readSync(0, chunk, 0, 1, null);
      } catch (e) {
        if (e && e.code === 'EAGAIN') continue;
        if (e && e.code === 'EOF') break;
        throw e;
      }
      if (bytes === 0) break;

      const ch = chunk.toString('utf8');

      if (ch === '\r' || ch === '\n') {
        stdout.write('\n');
        break;
      }
      if (ch === '\u0003') { // Ctrl+C
        stdout.write('\n');
        process.exit(130);
      }
      if (ch === '\u0004') { // Ctrl+D -> EOF (solo si no hay nada tipeado)
        if (value.length === 0) {
          stdout.write('\n');
          break;
        }
        continue;
      }
      if (ch === '\u007f' || ch === '\b') { // Backspace
        if (value.length > 0) {
          value = value.slice(0, -1);
          stdout.write('\b \b');
        }
        continue;
      }
      // Ignora el resto de caracteres de control
      if (ch < ' ') continue;

      value += ch;
      stdout.write('*');
    }
  } finally {
    if (stdin.setRawMode) stdin.setRawMode(wasRaw);
    stdin.pause();
  }

  return value;
}

/**
 * Resuelve la passphrase.
 *
 * @param {object} opts
 * @param {boolean} opts.allowPrompt  — Permitir el prompt (default true)
 * @param {boolean} opts.allowKeychain — Consultar el keychain (default true)
 * @param {boolean} opts.required      — Fallar si no se obtiene (default true)
 * @param {string}  opts.prompt        — Texto del prompt
 * @returns {string|null}
 */
function resolve(opts = {}) {
  const {
    allowPrompt = true,
    allowKeychain = true,
    required = true,
    prompt = 'Passphrase de la clave privada: ',
  } = opts;

  // 1) Entorno
  const fromEnv = process.env.LIC_PASS || process.env.POSKY_PASS;
  if (fromEnv) return fromEnv;

  // 2) Keychain
  if (allowKeychain && keychain.isSupported()) {
    const stored = keychain.load();
    if (stored) return stored;
  }

  // 3) Prompt enmascarado
  if (allowPrompt && process.stdin.isTTY) {
    const typed = promptHidden(prompt);
    if (typed) return typed;
  }

  if (!required) return null;

  throw new PassphraseError(
    'No se pudo obtener la passphrase.\n' +
    '  - Definí LIC_PASS en el entorno, o\n' +
    '  - Ejecutá el comando en una terminal interactiva para teclearla, o\n' +
    '  - Guardala en el keychain:  posky keys passphrase --save',
  );
}

/**
 * Variante asíncrona: usa el prompt de @clack/prompts (estilizado) cuando
 * hay terminal, y cae al prompt síncrono si clack no está disponible.
 *
 * @param {object} opts — mismos parámetros que `resolve`
 * @returns {Promise<string|null>}
 */
async function resolveAsync(opts = {}) {
  const {
    allowPrompt = true,
    allowKeychain = true,
    required = true,
    prompt = 'Passphrase de la clave privada:',
  } = opts;

  const fromEnv = process.env.LIC_PASS || process.env.POSKY_PASS;
  if (fromEnv) return fromEnv;

  if (allowKeychain && keychain.isSupported()) {
    const stored = keychain.load();
    if (stored) return stored;
  }

  if (allowPrompt && process.stdin.isTTY && process.stdout.isTTY) {
    // Prompt propio (enmascarado, síncrono) en vez del de @clack: es el
    // camino más crítico del toolkit y tiene que funcionar sí o sí,
    // también bajo Windows Terminal y en pipelines de automatización.
    const typed = promptHidden(`${prompt} `);
    if (typed) return typed;
  }

  if (!required) return null;

  throw new PassphraseError(
    'No se pudo obtener la passphrase.\n' +
    '  - Definí LIC_PASS en el entorno, o\n' +
    '  - Ejecutá el comando en una terminal interactiva para teclearla, o\n' +
    '  - Guardala en el keychain:  posky keys passphrase --save',
  );
}

module.exports = { resolve, resolveAsync, promptHidden, PassphraseError };
