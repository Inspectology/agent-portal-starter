#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoArg = process.argv.indexOf('--repo');
const ROOT = path.resolve(repoArg === -1 ? path.join(__dirname, '..') : process.argv[repoArg + 1]);
const findings = new Set();
const MAX_INSPECT_BYTES = 10 * 1024 * 1024;

const blockedNames = [
  { pattern: /(^|\/)\.env(?:\..+)?$/i, allow: /\.env\.example$/i, reason: 'environment file' },
  { pattern: /\.(?:pem|key|p12|pfx|jks|keystore)$/i, reason: 'key material file' },
  { pattern: /\.(?:sqlite3?|db|sql|dump|bak)$/i, reason: 'database or dump artifact' },
  { pattern: /\.(?:zip|7z|rar|tar|tgz|gz)$/i, reason: 'archive artifact' },
  { pattern: /(^|\/)(?:screen[-_ ]?shot|screenshot)[^/]*\.(?:png|jpe?g|webp)$/i, reason: 'screenshot artifact' }
];

const contentRules = [
  { pattern: new RegExp(['-----BEGIN ', '(?:RSA |EC |OPENSSH )?', 'PRIVATE KEY-----'].join(''), 'i'), reason: 'private key material' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/, reason: 'AWS access key pattern' },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, reason: 'GitHub token pattern' },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/, reason: 'Slack token pattern' },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+\/-]{24,}\b/i, reason: 'Bearer credential pattern' },
  { pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@[^\s]+/i, reason: 'credentialed URL' },
  { pattern: /(?:^|[^A-Za-z0-9_])(?:[A-Z0-9_]*(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)[A-Z0-9_]*)[ \t]*=[ \t]*[^\s#]{16,}/m, reason: 'credential assignment' },
  { pattern: /https?:\/\/[^\s]+\/(?:reports?|inspections?)\/[A-Za-z0-9_-]+/i, reason: 'sensitive record URL' }
];

function inspectName(name, source) {
  for (const rule of blockedNames) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(name) && !(rule.allow && rule.allow.test(name))) findings.add(`${source}: ${name} (${rule.reason})`);
  }
}

function inspectContent(name, bytes, source) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes));
  const representations = [buffer.toString('utf8'), buffer.toString('latin1')];
  for (const rule of contentRules) {
    if (representations.some(content => {
      rule.pattern.lastIndex = 0;
      return rule.pattern.test(content);
    })) findings.add(`${source}: ${name} (${rule.reason})`);
  }
}

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: options.encoding === undefined ? 'utf8' : options.encoding,
    maxBuffer: 100 * 1024 * 1024
  });
}

function inspectBounded(name, size, read, source) {
  if (size > MAX_INSPECT_BYTES) {
    findings.add(`${source}: ${name} (${size} bytes exceeds explicit ${MAX_INSPECT_BYTES}-byte inspection limit)`);
    return;
  }
  inspectContent(name, read(), source);
}

try {
  git(['rev-parse', '--verify', 'HEAD']);
  const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean);
  for (const name of tracked) {
    inspectName(name, 'tracked files');
    const fullPath = path.join(ROOT, name);
    let stat;
    try { stat = fs.lstatSync(fullPath); } catch { findings.add(`tracked files: ${name} (missing from working tree)`); continue; }
    if (!stat.isFile() || stat.isSymbolicLink()) { findings.add(`tracked files: ${name} (unsupported non-regular file)`); continue; }
    inspectBounded(name, stat.size, () => fs.readFileSync(fullPath), 'tracked files');
  }

  const metadata = git(['log', 'HEAD', '--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e']);
  for (const record of metadata.split('\x1e').filter(value => value.trim())) {
    const [hash, ...fields] = record.split('\x1f');
    inspectContent(hash.trim(), fields.join('\n'), 'commit metadata');
  }

  const objects = git(['rev-list', '--objects', 'HEAD']).split(/\r?\n/).filter(Boolean);
  const seenBlobs = new Set();
  for (const line of objects) {
    const separator = line.indexOf(' ');
    if (separator === -1) continue;
    const hash = line.slice(0, separator);
    const name = line.slice(separator + 1);
    let type;
    try { type = git(['cat-file', '-t', hash]).trim(); } catch { findings.add(`Git history: ${name} (unsupported unreadable object)`); continue; }
    if (type !== 'blob' || seenBlobs.has(hash)) continue;
    seenBlobs.add(hash);
    inspectName(name, 'Git history');
    const size = Number(git(['cat-file', '-s', hash]).trim());
    inspectBounded(name, size, () => git(['cat-file', 'blob', hash], { encoding: null }), 'Git history');
  }
} catch (error) {
  console.error(`Public safety scan could not complete: ${error.message}`);
  process.exit(2);
}

if (findings.size) {
  console.error('Public safety scan found patterns requiring review:');
  for (const finding of [...findings].sort()) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Public safety scan completed: no configured patterns matched tracked files, commit metadata, or history reachable from HEAD; every regular file/blob up to ${MAX_INSPECT_BYTES} bytes was inspected, including NUL-containing content.`);
console.log('Oversize and unsupported entries fail closed. This bounded heuristic scan is not proof that the repository contains no sensitive data.');
