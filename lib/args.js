/**
 * lib/args.js — Parser de argumentos de línea de comandos.
 *
 * Soporta:
 *   --flag valor      --flag=valor      --booleano      --no-booleano
 *   --flag v1 v2 v3   (flags "greedy": consumen los valores siguientes
 *                      hasta el próximo argumento que empiece por --)
 *   --flag a --flag b (flags repetidas → arreglo)
 *   -h               --help
 *   --               (fin de flags; el resto es posicional)
 */
const DEFAULT_GREEDY = ['features'];

/**
 * @param {string[]} argv
 * @param {object} [opts]
 * @param {string[]} [opts.greedy] — Flags que consumen varios valores
 * @returns {{ positional: string[], flags: object }}
 */
function parse(argv, opts = {}) {
  const greedy = new Set(opts.greedy || DEFAULT_GREEDY);
  const positional = [];
  const flags = {};
  const alias = { h: 'help', v: 'version' };

  /** Guarda un valor, acumulando en arreglo si la flag ya existe. */
  function set(key, value) {
    if (flags[key] === undefined) {
      flags[key] = value;
    } else if (Array.isArray(flags[key])) {
      flags[key].push(value);
    } else {
      flags[key] = [flags[key], value];
    }
  }

  let i = 0;
  let noMoreFlags = false;

  while (i < argv.length) {
    const arg = argv[i];

    if (noMoreFlags || !arg.startsWith('-')) {
      positional.push(arg);
      i += 1;
      continue;
    }

    if (arg === '--') {
      noMoreFlags = true;
      i += 1;
      continue;
    }

    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const eq = body.indexOf('=');

      if (eq !== -1) {
        set(body.slice(0, eq), body.slice(eq + 1));
        i += 1;
        continue;
      }

      if (body.startsWith('no-')) {
        flags[body.slice(3)] = false;
        i += 1;
        continue;
      }

      // Flag greedy: consume todos los valores siguientes que no sean flags.
      if (greedy.has(body)) {
        const values = [];
        while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
          values.push(argv[i + 1]);
          i += 1;
        }
        if (values.length) {
          set(body, values.length === 1 ? values[0] : values);
        } else {
          flags[body] = true;
        }
        i += 1;
        continue;
      }

      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        set(body, next);
        i += 2;
      } else {
        flags[body] = true;
        i += 1;
      }
      continue;
    }

    // Flags cortas agrupadas: -abc
    const shorts = arg.slice(1);
    for (let s = 0; s < shorts.length; s += 1) {
      const key = alias[shorts[s]] || shorts[s];
      const isLast = s === shorts.length - 1;
      const next = argv[i + 1];
      if (isLast && next !== undefined && !next.startsWith('--')) {
        set(key, next);
        i += 1;
      } else {
        flags[key] = true;
      }
    }
    i += 1;
  }

  return { positional, flags };
}

/** Lee una flag tipo lista: --features a b c  (o  --features=a,b) */
function listFlag(flags, name) {
  const value = flags[name];
  if (value === undefined || value === true || value === false) return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .flatMap((v) => String(v).split(/[,\s]+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Convierte un valor de flag a número, o devuelve null. */
function numFlag(flags, name) {
  const value = flags[name];
  if (value === undefined || value === true || value === false) return null;
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(n) ? n : null;
}

module.exports = { parse, listFlag, numFlag };
