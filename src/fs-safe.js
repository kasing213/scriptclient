'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

function isWSL() {
  const r = os.release().toLowerCase();
  return r.includes('microsoft') || r.includes('wsl');
}

// Expand '~' to HOME
function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

// Basic filename sanitizer: drops path separators and odd chars
function sanitizeFilename(name, replacement = '_') {
  return String(name)
    .replace(/[\r\n\t]/g, '')
    .replace(/[<>:"|?*]/g, replacement)
    .replace(/[\\/]/g, replacement)
    .slice(0, 255) || 'file';
}

// Map Windows-style absolute paths + UNC to WSL and normalize slashes
function normalizePath(p) {
  p = expandHome(p || '');
  // UNC like \\wsl$\, \\server\share
  if (/^\\\\/.test(p)) {
    // best effort: convert backslashes to slashes and drop double-leading
    p = p.replace(/\\/g, '/').replace(/^\/\//, '/');
  }
  if (/^[A-Za-z]:\\/.test(p)) {
    const drive = p[0].toLowerCase();
    const rest = p.slice(2).replace(/\\/g, '/');
    return `/mnt/${drive}${rest.startsWith('/') ? '' : '/'}${rest}`;
  }
  return path.resolve(p.replace(/\\/g, '/'));
}

// Prefer saving under Linux $HOME on WSL to avoid /mnt/c quirks
function preferLinuxHome(p) {
  if (!isWSL()) return p;
  if (p.startsWith('/mnt/')) return p;
  if (path.isAbsolute(p)) return p;
  const home = process.env.HOME || os.homedir() || '/tmp';
  return path.join(home, p);
}

async function ensureDir(dir, mode = 0o700) {
  await fsp.mkdir(dir, { recursive: true, mode });
}

/**
 * Build a safe absolute path for a file under a base directory.
 * Prevents directory traversal by verifying the final path is inside baseDir.
 */
function resolveTarget(baseDir, filename) {
  const cleanName = sanitizeFilename(filename);
  const target = normalizePath(path.join(baseDir, cleanName));
  const baseAbs = normalizePath(baseDir);
  if (!target.startsWith(baseAbs + path.sep) && target !== baseAbs) {
    throw new Error(`Refusing to write outside base directory: ${target}`);
  }
  return target;
}

/**
 * Atomic write: write to .part then rename into place.
 * Creates parent directory if needed.
 */
async function safeWriteFile(absFile, data, { mode = 0o600, flag = 'w' } = {}) {
  const dir = path.dirname(absFile);
  await ensureDir(dir);
  const tmp = absFile + '.part';
  await fsp.writeFile(tmp, data, { mode, flag });
  await fsp.rename(tmp, absFile);
  return absFile;
}

module.exports = {
  isWSL,
  normalizePath,
  preferLinuxHome,
  ensureDir,
  sanitizeFilename,
  resolveTarget,
  safeWriteFile,
};
