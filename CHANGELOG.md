# Changelog — POSky (toolkit de licencias del POS v4)

Todas las fechas son `YYYY-MM-DD`. Formato inspirado en
[Keep a Changelog](https://keepachangelog.com/es/1.0.0/).
El toolkit es un repositorio independiente (`tools-posky/`), no forma parte del
monorepo de `pos-server`.

## [0.1.0] — 2026-10-20 — TUI de licencias y blindaje del toolkit

Primera versión del toolkit como **paquete instalable** (antes eran scripts sueltos sin
`package.json`). Incluye TUI interactiva, registry cifrado y la passphrase ingresada
manualmente en la terminal.

### Añadido

- **TUI interactiva** (`posky` sin argumentos → menú de 9 opciones) con `@clack/prompts`:
  emite, renueva, suspende/reactiva, cambia asientos, lista, muestra el detalle, hace QA,
  gestiona claves y corre el diagnóstico. Funciona igual en macOS (Terminal/iTerm) y en
  Windows (Windows Terminal/PowerShell).
- **Comandos**: `issue` · `renew` · `suspend` (`--reactivar`) · `seats` · `list` (`--json`) ·
  `show` (`--lic`) · `keys` (`list`/`verify`/`generate`/`passphrase --save|--remove`) ·
  `doctor` (`--full`/`--migrar`) · `qa` (`--server`/`--token`).
- **Paquete npm** con `bin: { posky }`, `engines: node >= 18.19`, `files` y script `npm test`.
  Se puede consumir con `npm link` o directamente con `node bin/posky.js`.
- **La passphrase se teclea en la terminal (enmascarada)**: orden de resolución
  `LIC_PASS`/`POSKY_PASS` (entorno) → **keychain del sistema** (macOS Keychain /
  Windows DPAPI / libsecret, opt-in con `posky keys passphrase --save`) → **prompt
  enmascarado propio** (síncrono, `setRawMode`), que es la vía principal.
  El prompt no usa el de `@clack/prompts` a propósito: es el camino más crítico y tiene
  que funcionar sí o sí.
- **Registry cifrado**: `~/.pos-posky/registry.json.enc` con AES-256-GCM +
  PBKDF2-SHA256 (310k iteraciones, salt 16 B, iv 12 B) y permisos `0600`.
  Antes vivía **en claro** dentro del repo (`tools-posky/registry.json`).
- **Migración automática** del registry heredado en claro (`posky doctor --migrar`).
- **Cifrado nativo de Node (AES-256-GCM)** como alternativa a `openssl`: en Windows sin
  Git for Windows ya no hace falta instalar nada. `generate-keys.js` pide la passphrase
  de forma enmascarada y borra la versión en claro.
- **Comando `qa`**: verifica un `.lic` (formato, firma Ed25519 de producción o trial,
  versión de esquema, campos obligatorios, asientos y vigencia) y, con `--server`, lo
  prueba contra los endpoints reales de un `pos-server` en marcha.
- **Rutas sobreescribibles por entorno** para poder empaquetar el toolkit más adelante sin
  tocar el código: `POSKY_HOME`, `POSKY_KEYS_DIR`, `POSKY_OUT_DIR`, `POSKY_REGISTRY_FILE`.
- **23 tests** (`node:test`, sin dependencias): cifrado del registry (round-trip,
  passphrase incorrecta, detección de manipulación), emisión/renovación/suspensión/asientos
  y parser de argumentos.

### Corregido

- **Las claves se leían de la ruta equivocada**: `lib/licenseLib.js` resolví
  `__dirname/../../keys` → `POS/keys` (no existe). Ahora usan `paths.keysDir()` →
  `tools-posky/keys` (o `POSKY_KEYS_DIR`, o `$POSKY_HOME/keys`).
- **`registry.json` estaba versionado en el repo** (público en GitHub): cada licencia
  emitida filtraba cliente, `license_key` e historial. Ahora está desindexado
  (`git rm --cached`), ignorado y cifrado en reposo.
  > Sigue en el historial del commit inicial (vacío, sin datos reales). Para un repo ya
  > publicado hay que reescribir la historia (`git filter-repo`) **antes** de emitir la
  > primera licencia real.
- `keys/.gitignore` tenía una línea `!` huérfana (patrón de negación vacío).
- Los scripts heredados (`issue-license.js`, `renew-license.js`, `suspend-license.js`,
  `upgrade-seats.js`) se reescribieron como wrappers de `lib/core.js`: **misma interfaz
  de línea de comandos**, pero con el registry cifrado.
- El README usaba rutas `tools/...` obsoletas (el repo se movió a `tools-posky/`).

### Verificado

- E2E en entorno aislado: generar claves → `issue` → `list` → `show` → `renew` → `seats` →
  `suspend` → `--reactivar` → `qa`. Registry cifrado en disco, sin texto en claro.
- Prompt enmascarado y menú interactivo probados bajo **pty real**.
- **Hueco histórico cerrado**: por primera vez se validó **en vivo** una licencia de la
  familia **MAIN** contra un `pos-server` real → `POST /license/upload` → `200`; BD con
  `max_devices`, `license_state` y anti-rollback correctos; `POST /auth/login` → `200`.
  Hasta ahora solo se había probado la familia *trial*.

### Merge

- Se integró el commit remoto `dbea003` ("licenseLib lee las claves desde `../keys`").
  Los dos conflictos se resolvieron **a favor de la versión local**:
  - `lib/licenseLib.js`: la ruta de claves ya no es fija → `paths.keysDir()`
    (`POSKY_KEYS_DIR` → `$POSKY_HOME/keys` → `tools-posky/keys`), un superconjunto del fix
    remoto, que además acepta el sobre JSON de Node.
  - `registry.json`: se mantiene el **borrado** (el registry vive cifrado en
    `$POSKY_HOME/registry.json.enc`). El registro que traía el remoto se conserva en el
    registry cifrado: se restaura el archivo plano y `posky doctor --migrar` lo migra.
