/**
 * tests/core.test.js — Emisión / renovación / suspensión / asientos.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { makeEnv } = require('./helpers.js');

test('issue: crea el .lic, lo registra y el payload tiene la forma esperada', () => {
  const env = makeEnv();
  try {
    const core = require('../lib/core.js');
    const result = core.issueLicense({
      customer: 'Abarrotes La Esquina',
      branch: 'sucursal-centro',
      licenseKey: 'DEMO-0001',
      seats: 3,
      features: ['inventory', 'reports'],
      expires: '2027-10-20T00:00:00.000Z',
      passphrase: env.pass,
    });

    assert.strictEqual(result.licId, 'LIC-2026-000001');
    assert.strictEqual(result.payload.schema, 1);
    assert.strictEqual(result.payload.license_key, 'DEMO-0001');
    assert.strictEqual(result.payload.seats, 3);
    assert.strictEqual(result.payload.hw_fingerprint, null);
    assert.match(result.payload.issued, /^\d{4}-\d{2}-\d{2}$/);

    // El archivo existe y tiene la forma payload.firma
    assert.ok(fs.existsSync(result.filePath));
    const content = fs.readFileSync(result.filePath, 'utf8').trim();
    assert.strictEqual(content.split('.').length, 2);

    // La firma verifica contra la clave pública
    const check = core.verifyLicenseFile(content);
    assert.strictEqual(check.valid, true);
    assert.strictEqual(check.payload.lic_id, 'LIC-2026-000001');
  } finally {
    env.cleanup();
  }
});

test('issue: el registry queda cifrado y no en claro en el disco', () => {
  const env = makeEnv();
  try {
    const core = require('../lib/core.js');
    core.issueLicense({
      customer: 'Cliente Secreto',
      branch: 'sucursal',
      licenseKey: 'KEY-1',
      seats: 2,
      passphrase: env.pass,
    });

    const regFile = path.join(env.home, 'registry.json.enc');
    assert.ok(fs.existsSync(regFile));
    const raw = fs.readFileSync(regFile, 'utf8');
    assert.ok(!raw.includes('Cliente Secreto'), 'el registry no debe contener texto en claro');
  } finally {
    env.cleanup();
  }
});

test('issue: los IDs son secuenciales por año', () => {
  const env = makeEnv();
  try {
    const core = require('../lib/core.js');
    const a = core.issueLicense({ customer: 'A', branch: 'b', licenseKey: 'K1', seats: 1, passphrase: env.pass });
    const b = core.issueLicense({ customer: 'B', branch: 'b', licenseKey: 'K2', seats: 1, passphrase: env.pass });
    assert.strictEqual(a.licId, 'LIC-2026-000001');
    assert.strictEqual(b.licId, 'LIC-2026-000002');
  } finally {
    env.cleanup();
  }
});

test('renew: conserva el lic_id, cambia expires y guarda el historial', () => {
  const env = makeEnv();
  try {
    const core = require('../lib/core.js');
    const issued = core.issueLicense({
      customer: 'A', branch: 'b', licenseKey: 'K1', seats: 2,
      expires: '2027-01-01T00:00:00.000Z', passphrase: env.pass,
    });

    const renewed = core.renewLicense({
      licId: issued.licId,
      newExpiry: '2028-01-01T00:00:00.000Z',
      passphrase: env.pass,
    });

    assert.strictEqual(renewed.licId, issued.licId);
    assert.strictEqual(renewed.payload.expires, '2028-01-01T00:00:00.000Z');
    assert.strictEqual(renewed.payload.customer, 'A');
    assert.strictEqual(renewed.prevExpires, '2027-01-01T00:00:00.000Z');

    const reg = require('../lib/registry.js').load(env.pass);
    const actions = reg[issued.licId].history.map((h) => h.action);
    assert.deepStrictEqual(actions, ['issued', 'renewed']);
    // El historial guarda la fecha ANTERIOR (no la nueva) — bug corregido
    assert.strictEqual(reg[issued.licId].history[1].prev_expires, '2027-01-01T00:00:00.000Z');
  } finally {
    env.cleanup();
  }
});

test('renew: reactiva una licencia suspendida', () => {
  const env = makeEnv();
  try {
    const core = require('../lib/core.js');
    const issued = core.issueLicense({ customer: 'A', branch: 'b', licenseKey: 'K1', seats: 2, passphrase: env.pass });
    core.suspendLicense({ licId: issued.licId, passphrase: env.pass });

    const reg = require('../lib/registry.js').load(env.pass);
    assert.strictEqual(reg[issued.licId].status, 'suspended');

    core.renewLicense({ licId: issued.licId, newExpiry: '2028-01-01T00:00:00.000Z', passphrase: env.pass });
    const reg2 = require('../lib/registry.js').load(env.pass);
    assert.strictEqual(reg2[issued.licId].status, 'active');
  } finally {
    env.cleanup();
  }
});

test('suspend: pone expires en el pasado y marca el estado', () => {
  const env = makeEnv();
  try {
    const core = require('../lib/core.js');
    const issued = core.issueLicense({ customer: 'A', branch: 'b', licenseKey: 'K1', seats: 2, passphrase: env.pass });
    const result = core.suspendLicense({ licId: issued.licId, passphrase: env.pass });

    assert.ok(new Date(result.payload.expires).getTime() < Date.now());
    const reg = require('../lib/registry.js').load(env.pass);
    assert.strictEqual(reg[issued.licId].status, 'suspended');
  } finally {
    env.cleanup();
  }
});

test('seats: cambia los asientos y NO la expiración', () => {
  const env = makeEnv();
  try {
    const core = require('../lib/core.js');
    const issued = core.issueLicense({
      customer: 'A', branch: 'b', licenseKey: 'K1', seats: 2,
      expires: '2027-01-01T00:00:00.000Z', passphrase: env.pass,
    });
    const result = core.updateSeats({ licId: issued.licId, newSeats: 10, passphrase: env.pass });

    assert.strictEqual(result.oldSeats, 2);
    assert.strictEqual(result.payload.seats, 10);
    assert.strictEqual(result.payload.expires, '2027-01-01T00:00:00.000Z');
  } finally {
    env.cleanup();
  }
});

test('renew de una licencia inexistente → error', () => {
  const env = makeEnv();
  try {
    const core = require('../lib/core.js');
    assert.throws(
      () => core.renewLicense({ licId: 'LIC-2026-999999', newExpiry: '2028-01-01T00:00:00.000Z', passphrase: env.pass }),
      /no encontrada en el registry/,
    );
  } finally {
    env.cleanup();
  }
});

test('issue sin license_key → error', () => {
  const env = makeEnv();
  try {
    const core = require('../lib/core.js');
    assert.throws(
      () => core.issueLicense({ customer: 'A', branch: 'b', seats: 1, passphrase: env.pass }),
      /license_key/,
    );
  } finally {
    env.cleanup();
  }
});
