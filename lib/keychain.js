/**
 * lib/keychain.js — Guarda la passphrase en el almacén seguro del sistema.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Es OPCIONAL: la vía principal es teclear la passphrase en la terminal
 * (ver lib/passphrase.js). Guardarla en el keychain es una comodidad para
 * quien emite muchas licencias en el mismo equipo.
 *
 * - macOS  : `security` (Keychain) — nativo.
 * - Windows: DPAPI (CurrentUser) vía PowerShell — nativo.
 * - Linux  : `secret-tool` (libsecret / GNOME Keyring / KWallet).
 *
 * En todos los casos la passphrase se cifra con una clave del sistema:
 * solo el usuario que la guardó puede recuperarla en ese equipo.
 * ─────────────────────────────────────────────────────────────────────
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVICE = 'posky-license';
const ACCOUNT = 'passphrase';

function platform() {
  return os.platform(); // 'darwin' | 'win32' | 'linux' | ...
}

/** ¿El keychain está disponible en esta máquina? */
function isSupported() {
  if (platform() === 'darwin' || platform() === 'win32') return true;
  if (platform() === 'linux') return hasBinary('secret-tool');
  return false;
}

function hasBinary(bin) {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Human-readable del backend activo. */
function backendName() {
  if (platform() === 'darwin') return 'macOS Keychain';
  if (platform() === 'win32') return 'Windows DPAPI';
  if (platform() === 'linux' && hasBinary('secret-tool')) return 'libsecret (secret-tool)';
  return 'no disponible';
}

// ── Windows: DPAPI ────────────────────────────────────────────────────────
const PS_SCRIPT = `
param([string]$Mode, [string]$Secret, [string]$File)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
if ($Mode -eq 'save') {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Secret)
  $enc = [System.Security.Cryptography.ProtectedData]::Protect(
    $bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  [System.IO.File]::WriteAllText($File, [Convert]::ToBase64String($enc))
  Write-Output 'ok'
} elseif ($Mode -eq 'load') {
  if (-not (Test-Path $File)) { Write-Output ''; exit 0 }
  $b64 = [System.IO.File]::ReadAllText($File)
  if (-not $b64) { Write-Output ''; exit 0 }
  $enc = [Convert]::FromBase64String($b64)
  $bytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
    $enc, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  Write-Output ([System.Text.Encoding]::UTF8.GetString($bytes))
} elseif ($Mode -eq 'delete') {
  if (Test-Path $File) { Remove-Item $File -Force }
  Write-Output 'ok'
}
`;

function windowsFile() {
  const home = process.env.POSKY_HOME
    ? path.resolve(process.env.POSKY_HOME)
    : path.join(os.homedir(), '.pos-posky');
  return path.join(home, 'passphrase.dpapi');
}

function runPowerShell(mode, secret) {
  const scriptPath = path.join(os.tmpdir(), `posky-dpapi-${process.pid}.ps1`);
  fs.writeFileSync(scriptPath, PS_SCRIPT, 'utf8');
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
        '-Mode', mode, '-Secret', secret || '', '-File', windowsFile()],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return out.trim();
  } finally {
    try { fs.unlinkSync(scriptPath); } catch { /* noop */ }
  }
}

// ── API pública ───────────────────────────────────────────────────────────

/**
 * Guarda la passphrase en el keychain.
 * @returns {boolean} true si se guardó
 */
function save(passphrase) {
  if (!passphrase) throw new Error('Passphrase vacía.');

  if (platform() === 'darwin') {
    execFileSync('security', [
      'add-generic-password', '-U',
      '-s', SERVICE, '-a', ACCOUNT,
      '-w', passphrase,
    ], { stdio: 'ignore' });
    return true;
  }

  if (platform() === 'win32') {
    runPowerShell('save', passphrase);
    return true;
  }

  if (platform() === 'linux' && hasBinary('secret-tool')) {
    execFileSync('secret-tool', [
      'store', '--label=POSky passphrase',
      'service', SERVICE, 'username', ACCOUNT,
    ], { input: passphrase + '\n', stdio: ['pipe', 'ignore', 'ignore'] });
    return true;
  }

  throw new Error(`Keychain no disponible en esta plataforma (${platform()}).`);
}

/**
 * Recupera la passphrase del keychain. Devuelve null si no está guardada.
 * @returns {string|null}
 */
function load() {
  try {
    if (platform() === 'darwin') {
      const out = execFileSync('security', [
        'find-generic-password', '-w',
        '-s', SERVICE, '-a', ACCOUNT,
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return out.trim() || null;
    }

    if (platform() === 'win32') {
      const out = runPowerShell('load', '');
      return out || null;
    }

    if (platform() === 'linux' && hasBinary('secret-tool')) {
      const out = execFileSync('secret-tool', [
        'lookup', 'service', SERVICE, 'username', ACCOUNT,
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return out.trim() || null;
    }
  } catch {
    return null;
  }
  return null;
}

/** Borra la passphrase del keychain. */
function remove() {
  try {
    if (platform() === 'darwin') {
      execFileSync('security', [
        'delete-generic-password', '-s', SERVICE, '-a', ACCOUNT,
      ], { stdio: 'ignore' });
      return true;
    }
    if (platform() === 'win32') {
      runPowerShell('delete', '');
      return true;
    }
    if (platform() === 'linux' && hasBinary('secret-tool')) {
      execFileSync('secret-tool', [
        'clear', 'service', SERVICE, 'username', ACCOUNT,
      ], { stdio: 'ignore' });
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

module.exports = { SERVICE, ACCOUNT, isSupported, backendName, save, load, remove };
