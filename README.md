# Licencias POS v4 — Generacion, renovacion y operacion

> **Edicion firmada Ed25519.** Cada `.lic` es `base64url(payload_json).base64url(firma)` y se verifica en el arranque del servidor con la clave publica embebida. Sin `.lic` valida el servidor entra en degradado (dev) o bloquea (prod).

---

## 1) Arquitectura rapida

```
tools/keys/ ──► pos-server/src/keys/publicKey.ts (prebuild)
   │
   ├─ mipos_public.pem (SPKI, sin cifrar) ──► embebida en build via npm run build:keys
   └─ mipos_private.enc.pem (PKCS8 + AES-256-CBC, passphrase LIC_PASS)

payload .lic ──► license_key → tenants.license_key, seats → max_devices, expires → license_expires_at
              └─► license_state(lic_id,customer,features,hw_fingerprint) + license_anti_rollback(HMAC) + license_audit
```

Vigencia por defecto **1 año** (`DEFAULT_LICENSE_YEARS=1` en `tools/lib/licenseLib.js:28`, `today()` + `inOneYear()` `issue-license.js:77`).
Gracia: reloj 7d `CLOCK_ROLLBACK_GRACE_DAYS` / fingerprint 15d `FINGERPRINT_GRACE_DAYS`.

---

## 2) Generar par de claves (una sola vez)

```bash
node tools/generate-keys.js
# genera tools/keys/mipos_public.pem + tools/keys/mipos_private.enc.pem
# pide passphrase >=16 chars para AES-256-CBC, borra la privada sin cifrar
# backup obligatorio: USB VeraCrypt + nube Cryptomator/Bitwarden (ya en .gitignore)

# familia trial aislada (para POST /license/trial 1 día — no afecta prod)
node tools/generate-trial-keys.js            # genera trial_public.pem + trial_private.pem
TRIAL_PASS="..." node tools/generate-trial-keys.js --force  # opcional cifrado trial_private.enc.pem

# embebe ambas publicas en el servidor (no van por .env — evita suplantacion)
cd pos-server && npm run build:keys   # lee ../../tools/keys/mipos_public.pem → src/keys/publicKey.ts (+ trialPublicKey.ts)
```

Si ves `⚠ Ya existen claves` borra `tools/keys/` solo si vas a reemitir TODAS las licencias.

---

## 3) Emitir licencia nueva

```bash
LIC_PASS="tu-passphrase" node tools/issue-license.js "Abarrotes La Esquina" sucursal-centro DEMO-0001 3 --features inventory garage reports
# uso: issue-license.js <customer> <branch> <license_key> <seats> [--features f1 f2 ...]
# license_key = tenants.license_key (tenant_code del login, ej DEMO-0001)
# seats = max_devices, features default: inventory garage reports
# tiempo FIJO: issued=today() expires=inOneYear() (1 año, no hay flag --expires hoy)
```

Salida:

```
✓ Licencia emitida: LIC-2026-000001
  Archivo:    tools/out/LIC-2026-000001.lic
  Registry:   tools/registry.json  {customer, license_key, current_expires, current_seats, history:[{action:issued}]}
```

---

## 4) Renovar / ampliar / suspender

```bash
# renovar — requiere nueva fecha ISO (no regala tiempo, conserva lic_id)
LIC_PASS="..." node tools/renew-license.js LIC-2026-000001 2028-01-01T00:00:00Z
# equivalente 1 año desde hoy: date -u -v+1y +"%Y-%m-%dT%H:%M:%SZ" (macOS)

# ampliar asientos (no reinicia vigencia)
LIC_PASS="..." node tools/upgrade-seats.js LIC-2026-000001 5
# regla: new_seats > current_seats, si no → error. Rechaza downgrade si seats < active_sessions (fork 403 en upload)

# suspender (pone expires 1 dia en el pasado → modo degradado, datos intactos)
LIC_PASS="..." node tools/suspend-license.js LIC-2026-000001
# reactivar = renovar con fecha futura

# trial (familia aislada, no usar mipos_*): se genera server-side vía POST /license/trial, no con este script
```

Todos re-firman Ed25519 y sobreescriben `tools/out/{lic_id}.lic` + `registry.json:history`.

---

## 5) Instalar en servidor sucursal + wizard primera ejecución

### 5a) Instalación normal

```bash
# ruta por env o default ~/.pos/license.lic (linux/mac) / %USERPROFILE%\.pos\license.lic
# configurable: LICENSE_FILE_PATH en pos-server/.env
cp tools/out/LIC-2026-000001.lic ~/.pos/license.lic
# Windows: %ProgramData%\POS Server\data\pos.lic si fijas LICENSE_FILE_PATH
# reinicia pos-server → src/server.ts:50 validateLicenseAtStartup()
```

**Via upload admin (sin reinicio, requiere settings:manage — o bootstrap sin auth si falta licencia):**

```bash
LIC=$(cat tools/out/LIC-2026-000001.lic)
curl -X POST http://localhost:3000/license/upload \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d "{\"license_data\":\"$LIC\"}" | jq
# valida: firma Ed25519 (familia main O trial), license_key==tenant, schema<=1, seats>=COUNT(active_sessions is_valid=1) → 403 si downgrade
# bootstrap: si el server está en missing (sin licencia válida), POST /license/upload NO requiere Bearer — permite wizard inicial
# si expirada → aplica y desactiva tenants.is_active=0 (middleware bloqueara)
```

### 5b) Wizard primera ejecución (pos-desktop)

El desktop en Tauri muestra `src/screens/LicenseActivation.tsx` cuando `GET /license/status` responde `404 NO_LICENSE` (o `licenseState==='expired'`).

- **Drag & drop / file picker:** `@tauri-apps/plugin-dialog` (`open`) + `@tauri-apps/plugin-fs` (`readTextFile`) — zona dashed + botón "Seleccionar archivo .lic".
- **Paste:** textarea para `base64url(payload).base64url(firma)` → mismo `POST /license/upload` bootstrap.
- **Probar 1 día gratis:** `POST /license/trial` (sin auth en bootstrap, con auth después). Emite `TRIAL-YYYY-XXXXXX` de `TRIAL_LICENSE_DAYS=1` firmada server-side con `trial_private.pem` (familia aislada `trialPublicKey.ts`). Requiere `trial_private.pem` (o `.enc.pem` + `TRIAL_PASS`) en el servidor (`TRIAL_PRIVATE_KEY_PATH`, default `../tools/keys/trial_private.pem`). Throttle: no re-emite si ya hay trial con >12h restantes.
- **Detección:** `pos-desktop/src/navigation/AppRoutes.tsx:useBootstrapLicenseProbe()` → si `unknown` consulta `GET /license/status` (público, 404 `NO_LICENSE` si falta) y fija `licenseState='expired'` para mostrar el wizard. Tras activar, `LicenseActivation` pone `licenseState='active'` y el router navega a `ConnectionScreen → Login`.

Config prod: `LICENSE_STRICT=true`, `LICENSE_HMAC_SECRET` fijo, `PUBLIC_KEY_PEM` prod + `TRIAL_PUBLIC_KEY_PEM` trial (rotar trial no afecta productivas).

```bash
# trial manual (alternativa a la UI)
curl -X POST http://localhost:3000/license/trial | jq
# requiere trial_private en server; si el server está en bootstrap no requiere Bearer

# estado público (wizard lo usa sin token)
curl -s http://localhost:3000/license/status | jq
# 200 {status:"active"|"grace"|"expired", ...} | 404 {"error":{"code":"NO_LICENSE"}}
```

---

## 6) Verificar funcionamiento

```bash
# logs arranque
# active → Servidor operativo | missing → modo degradado ( LICENSE_STRICT=true → invalid bloquea )
# expired/grace_clock/grace_fingerprint → WARN/ERROR en src/server.ts:51

# estado canonico
curl -s http://localhost:3000/license/status -H "Authorization: Bearer $TOKEN" | jq
# {status:"active"|"grace"|"expired", expires_at, max_devices, lic_id, customer, features, warning_level:"none"|"warning"(30d)|"critical"(7d), grace_reason:"clock"|"fingerprint"|null, grace_expires_at}

# login revalida por request
curl -s http://localhost:3000/auth/login -H "Content-Type: application/json" \
  -d '{"tenant_code":"DEMO-0001","pin":"1234","device_id":"pc-01","device_name":"PC Caja","device_type":"PC"}' | jq .data.license

# heartbeat (mobile lo hace cada 30s pos-mobile/src/stores/auth.store.ts:35, admin exento is_heartbeat_exempt=1)
curl -X POST http://localhost:3000/auth/heartbeat -H "Authorization: Bearer $TOKEN"

# DB
psql -c "SELECT lic_id,seats,is_valid FROM license_state WHERE tenant_id='...'"
psql -c "SELECT counter,fingerprint_grace_until,clock_rollback_grace_until FROM license_anti_rollback"
psql -c "SELECT event_type,severity FROM license_audit ORDER BY created_at DESC LIMIT 5"
```

**Modo estricto prod:** `pos-server/.env` `LICENSE_STRICT=true` (default si `NODE_ENV=production`) + `LICENSE_HMAC_SECRET` fijo (si no, deriva de `JWT_SECRET`; rotar JWT sin fijar este invalida HMAC). `PUBLIC_KEY_PEM` de prueba `MCow...j9w=` loguea error en `src/modules/license/license.service.ts:584`.

---

## 7) Tests

```bash
npm --prefix pos-server run typecheck   # 0
npm --prefix pos-server test            # 20/20 (license 11: firma/mismatch/seats-downgrade/expired + products.image 9)
npx --prefix pos-mobile tsc --noEmit
```

---

## 8) Troubleshooting

| Sintoma | Causa | Fix |
|---|---|---|
| `Sin archivo .lic — modo degradado` | `LICENSE_FILE_PATH` inexistente | `cp *.lic` a ruta + reinicio, o `LICENSE_STRICT=false` en dev |
| `403 LICENSE_EXPIRED` en cada request | `tenants.is_active=0` o `expires<=now()` en `middleware/auth.ts:34` | renovar + `POST /license/upload` o reemplazar `.lic` |
| `403 Asientos insuficientes: N activos` | `payload.seats < COUNT active_sessions` `src/modules/license/license.service.ts:902` | `upgrade-seats` o desvincular dispositivos (`active_sessions is_valid=0` via TTL 90s) |
| `FINGERPRINT_MISMATCH gracia 15d` | `hw_fingerprint` no coincide | gracia 15d luego bloquea; reemitir con `hw_fingerprint=null` o correcto |
| `Clave publica de PRUEBA en modo estricto` | `tools/keys` de test embebida | `npm --prefix pos-server run build:keys` con clave prod |

---

*Payload firmado: `{schema, lic_id, license_key, customer, branch, seats, features, issued, expires, hw_fingerprint}` — ver `tools/lib/licenseLib.js:74 signLicense` y `pos-server/src/types/license.ts:28`.*
