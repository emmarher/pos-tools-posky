# Licencias POS v4 — Toolkit de licencias (POSky)

> **Edición firmada Ed25519.** Cada `.lic` es `base64url(payload_json).base64url(firma)` y se
> verifica en el arranque del servidor con la clave pública embebida en el build.
> Sin `.lic` válido el servidor entra en modo degradado (dev) o bloquea (prod).

Toolkit para **emitir, renovar, suspender y auditar** licencias del POS v4, con una TUI
interactiva y scripts de línea de comandos equivalentes.

> **Migración:** el toolkit vivía antes en `tools/` (dentro del workspace) y ahora es el
> repo independiente **`tools-posky/`**. Si tenés una copia vieja, actualizá las rutas:
> `tools/keys/` → `tools-posky/keys/`. El registry en claro `tools/registry.json` se migra
> solo con `posky doctor --migrar`.

---

## 1) Instalación

```bash
cd tools-posky
npm install          # única dependencia: @clack/prompts
npm link             # opcional: deja `posky` disponible en el PATH
```

Sin `npm link` se puede llamar directo: `node bin/posky.js <comando>`.

**Requisitos:** Node.js ≥ 18.19. Funciona igual en macOS (Terminal / iTerm) y en
Windows (Windows Terminal / PowerShell). `openssl` es opcional: si no está en el PATH
(el caso típico en Windows sin Git for Windows) el toolkit usa su propio cifrado
AES-256-GCM.

---

## 2) Uso rápido

```bash
posky                      # menú interactivo
posky issue                # emitir una licencia (pregunta todo)
posky list                 # ver las emitidas
posky show LIC-2026-000001 # detalle + historial
posky qa <archivo.lic>     # verificar un .lic
posky doctor               # diagnóstico
```

Ayuda completa: `posky --help`.

### Comandos

| Comando | Qué hace |
|---|---|
| `issue` | Emite una licencia nueva (`LIC-{año}-{6 dígitos}`) |
| `renew` | Extiende la vigencia. **No regala tiempo**: la fecha la definís vos |
| `suspend` | Suspende (modo degradado: ventas bloqueadas, datos intactos). `--reactivar` la revive |
| `seats` | Cambia los asientos (`max_devices`). No toca la expiración |
| `list` | Lista las emitidas (`--json` para exportar) |
| `show` | Detalle + historial de una licencia (`--lic` muestra el contenido del `.lic`) |
| `keys` | `list` · `verify` · `generate` · `passphrase --save` |
| `doctor` | Diagnóstico (`--full` chequea descifrado, `--migrar` migra el registry heredado) |
| `qa` | Verifica un `.lic` (firma, esquema, campos) y opcionalmente contra un server |

---

## 3) La passphrase

La passphrase que descifra la clave privada **se teclea en la terminal** (enmascarada).
Orden de resolución:

1. `LIC_PASS` / `POSKY_PASS` en el entorno → para automatización y CI.
2. **Keychain del sistema** (macOS Keychain / Windows DPAPI / libsecret) — opcional:
   `posky keys passphrase --save`.
3. Prompt enmascarado en la terminal → la vía principal.

En Windows la passphrase se guarda con DPAPI (`CurrentUser`): solo tu usuario y ese
equipo la pueden recuperar.

> La passphrase **nunca** se escribe en disco por el toolkit, salvo que la guardes
> explícitamente en el keychain.

---

## 4) Dónde vive cada cosa

```
tools-posky/                      (repo git — código; las claves están ignoradas)
├── keys/                         mipos_*  trial_*   ← NUNCA commitear
└── out/                          .lic emitidos        ← NUNCA commitear

$POSKY_HOME  (por defecto ~/.pos-posky)   ← datos locales y sensibles
├── registry.json.enc             registry CIFRADO (AES-256-GCM + PBKDF2)
└── out/                          .lic emitidos
```

El **registry** guarda por licencia: cliente, license_key, sucursal, asientos,
expiración, estado e historial. Antes vivía en claro dentro del repo
(`tools-posky/registry.json`); ahora está cifrado con la misma passphrase que
protege la clave privada. La migración es automática:

```bash
posky doctor --migrar
```

> Si el repo se publicó con el registry en claro, el archivo queda en el historial de
> git. Para un repo nuevo no hay nada que limpiar; para uno ya publicado hay que
> reescribir el historial (`git filter-repo`) — hacelo antes de emitir la primera
> licencia real.

### Variables de entorno

| Variable | Por defecto | Para qué |
|---|---|---|
| `POSKY_HOME` | `~/.pos-posky` | Raíz de los datos locales |
| `POSKY_KEYS_DIR` | `tools-posky/keys` | Carpeta de las claves Ed25519 |
| `POSKY_OUT_DIR` | `$POSKY_HOME/out` | Carpeta de `.lic` emitidos |
| `POSKY_REGISTRY_FILE` | `$POSKY_HOME/registry.json.enc` | Archivo del registry cifrado |
| `LIC_PASS` / `POSKY_PASS` | — | Passphrase por entorno (CI) |

---

## 5) Arquitectura

```
tools-posky/keys/ ──► pos-server/src/keys/publicKey.ts (prebuild)
   │
   ├─ mipos_public.pem (SPKI, sin cifrar) ──► embebida en el build
   └─ mipos_private.enc.pem (cifrada)       ──► firma de las licencias

payload .lic ──► license_key → tenants.license_key
              └─► seats       → max_devices
              └─► expires     → license_expires_at
```

**Familias de claves** (aisladas entre sí):

| Familia | Pública | Privada | Uso |
|---|---|---|---|
| Producción | `mipos_public.pem` | `mipos_private.enc.pem` (cifrada) | Licencias de clientes |
| Trial | `trial_public.pem` | `trial_private.pem` | `POST /license/trial` (1 día) |

Vigencia por defecto **1 año**. Gracia: reloj 7 días, fingerprint 15 días.

### Contrato del payload

```json
{
  "schema": 1,
  "lic_id": "LIC-2026-000001",
  "license_key": "DEMO-0001",
  "customer": "Abarrotes La Esquina",
  "branch": "sucursal-centro",
  "seats": 3,
  "features": ["inventory", "reports"],
  "issued": "2026-10-20",
  "expires": "2027-10-20T15:56:36.557Z",
  "hw_fingerprint": null
}
```

- `license_key` es el **tenant code con el que el cliente entra al login**.
  Tras activar el `.lic`, `pos-server` lo adopta (`UPDATE tenants SET license_key`).
- `seats` es el `max_devices` que el server aplica. El server rechaza (403) la
  licencia si hay más dispositivos con sesión activa que `seats`.
- `features` no lo consume el server todavía (queda para el futuro).

---

## 6) Generar las claves (una sola vez)

```bash
posky keys generate
# genera keys/mipos_public.pem + keys/mipos_private.enc.pem
# pide una passphrase de >= 16 caracteres (enmascarada) y borra la versión en claro

node generate-trial-keys.js        # familia trial (aislada)
```

**Reglas de oro:**

- `keys/` nunca se commitea (ya está en `.gitignore`).
- Backup de la clave cifrada **y** de la passphrase en dos lugares físicos:
  USB cifrado (VeraCrypt) + nube cifrada (Cryptomator / Bitwarden).
- Si perdés la privada: no podés emitir licencias para las versiones ya desplegadas
  (hay que relanzar el server con clave nueva y reemitir todo).
- Si te la roban: pueden fabricar licencias infinitas. Por eso está cifrada y vos
  solo la desbloqueás al emitir.

Embedding de la clave pública en el server:

```bash
cd pos-server && npm run build:keys   # → src/keys/publicKey.ts + trialPublicKey.ts
```

`posky doctor` verifica que la clave embebida en `pos-server` **coincida** con la
del toolkit (si no, el server rechaza todas las licencias).

---

## 7) QA: verificar una licencia

```bash
posky qa LIC-2026-000001.lic
posky qa LIC-2026-000001.lic --server http://localhost:3000
posky qa LIC-2026-000001.lic --server http://localhost:3000 --token <JWT admin>
```

Verifica: formato, firma Ed25519 (producción o trial), versión de esquema, campos
obligatorios, asientos y vigencia. Con `--server` además prueba los endpoints reales
(`GET /license/status` y `POST /license/upload`).

> `POST /license/upload` sin token solo funciona si el server está en **bootstrap**
> (sin licencia o con licencia inválida). En un server ya activado hace falta un JWT
> de un usuario con permiso `settings:manage`.

---

## 8) Scripts de línea de comandos (compatibles)

Los scripts originales siguen funcionando y ahora usan el registry cifrado:

```bash
LIC_PASS="..." node issue-license.js "Abarrotes La Esquina" sucursal-centro DEMO-0001 3 \
  --features inventory garage reports
LIC_PASS="..." node renew-license.js   LIC-2026-000123 2028-01-01T00:00:00Z
LIC_PASS="..." node suspend-license.js LIC-2026-000123
LIC_PASS="..." node upgrade-seats.js   LIC-2026-000123 8
```

---

## 9) Estructura del proyecto

```
tools-posky/
├── bin/posky.js           punto de entrada (dispatch + menú)
├── commands/              issue · renew · suspend · seats · list · show · keys · doctor · qa
├── lib/
│   ├── core.js            lógica de negocio (síncrona)
│   ├── licenseLib.js      cripto Ed25519 (firmar / verificar / leer)
│   ├── secure-store.js    AES-256-GCM + PBKDF2 (registry y clave privada)
│   ├── registry.js        registry cifrado + migración
│   ├── passphrase.js      resolución de la passphrase (env · keychain · prompt)
│   ├── keychain.js        macOS Keychain / Windows DPAPI / libsecret
│   ├── paths.js           POSKY_HOME y rutas
│   ├── args.js            parser de argumentos
│   ├── ui.js              TUI (@clack/prompts) con fallback no interactivo
│   └── http.js            cliente HTTP (para `qa --server`)
├── tests/                 23 tests (node:test)
├── generate-keys.js       generador del par de producción
└── generate-trial-keys.js generador del par de trial
```

### Tests

```bash
npm test
```

Cifrado del registry (round-trip, passphrase incorrecta, detección de manipulación),
emisión/renovación/suspensión/asientos (payload, historial, estado) y parser de
argumentos.

---

## 10) Seguridad

- La clave privada **nunca** sale del toolkit y solo se desbloquea al firmar.
- El registry está cifrado en reposo con AES-256-GCM (PBKDF2-SHA256, 310k iteraciones).
- Los `.lic` emitidos son públicos por diseño: lo que prueba la firma es que los emitió
  el proveedor, no que el contenido sea secreto.
- `hw_fingerprint` está en el payload pero el emisor siempre lo deja en `null`; la
  vinculación por hardware todavía no está implementada en el server.
- El toolkit no hace red, no manda telemetría y no busca actualizaciones.

---

## 11) Changelog

Ver [`CHANGELOG.md`](CHANGELOG.md). La versión actual es `0.1.0` (`posky --version`).
