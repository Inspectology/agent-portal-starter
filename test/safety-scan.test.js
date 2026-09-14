'use strict';

const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const scanner = path.join(__dirname, '..', 'scripts', 'public-safety-scan.js');

function git(repo, args) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function init(repo) {
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.name', 'Fixture']);
  git(repo, ['config', 'user.email', 'fixture@example.invalid']);
}

test('public safety scan inspects deleted files in Git history', () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'portal-scan-'));
  init(repo);
  writeFileSync(path.join(repo, 'README.md'), 'synthetic fixture\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-qm', 'clean']);
  const credential = `${['PORTAL', 'SIGNING', 'SECRET'].join('_')}=${['fixture', 'secret-that-must-not-publish'].join('-')}`;
  writeFileSync(path.join(repo, '.env.production'), `${credential}\n`);
  git(repo, ['add', '.env.production']);
  git(repo, ['commit', '-qm', 'unsafe']);
  git(repo, ['rm', '-q', '.env.production']);
  git(repo, ['commit', '-qm', 'delete']);

  const result = spawnSync(process.execPath, [scanner, '--repo', repo], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\.env\.production/);
  assert.match(result.stderr, /Git history/);
});

test('public safety scan rejects generic credentials in reachable commit metadata', () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'portal-scan-meta-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.name', 'Fixture Maintainer']);
  git(repo, ['config', 'user.email', 'maintainer@example.invalid']);
  writeFileSync(path.join(repo, 'README.md'), 'synthetic fixture\n');
  git(repo, ['add', '.']);
  const credential = `${['SERVICE', 'API', 'KEY'].join('_')}=${['fixture', 'credential-that-must-not-publish'].join('-')}`;
  git(repo, ['commit', '-qm', `release notes ${credential}`]);

  const result = spawnSync(process.execPath, [scanner, '--repo', repo], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /commit metadata/);
  assert.match(result.stderr, /credential assignment/);
});

test('public safety scan inspects bounded bytes in NUL-containing files', () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'portal-scan-binary-'));
  init(repo);
  const credential = `${['PORTAL', 'SIGNING', 'SECRET'].join('_')}=${['binary', 'fixture-secret-that-must-not-publish'].join('-')}`;
  writeFileSync(path.join(repo, 'fixture.bin'), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(credential)]));
  git(repo, ['add', '.']);
  git(repo, ['commit', '-qm', 'binary fixture']);

  const result = spawnSync(process.execPath, [scanner, '--repo', repo], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /fixture\.bin/);
  assert.match(result.stderr, /credential assignment/);
});

test('public safety scan rejects generic credentialed URLs such as DATABASE_URL', () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'portal-scan-url-'));
  init(repo);
  const variable = ['DATABASE', 'URL'].join('_');
  const credentialedUrl = ['postgres://fixture-user:', 'fixture-password@example.invalid:5432/app'].join('');
  writeFileSync(path.join(repo, 'config.txt'), `${variable}=${credentialedUrl}\n`);
  git(repo, ['add', '.']);
  git(repo, ['commit', '-qm', 'credential URL fixture']);

  const result = spawnSync(process.execPath, [scanner, '--repo', repo], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /config\.txt/);
  assert.match(result.stderr, /credentialed URL/);
});

test('public safety scan ignores unrelated local refs not reachable from HEAD', () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'portal-scan-refs-'));
  init(repo);
  writeFileSync(path.join(repo, 'README.md'), 'clean fixture\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-qm', 'clean']);
  git(repo, ['checkout', '-qb', 'unrelated']);
  writeFileSync(path.join(repo, '.env.private'), 'fixture\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-qm', 'unrelated unsafe ref']);
  git(repo, ['checkout', '-q', 'master']);

  const result = spawnSync(process.execPath, [scanner, '--repo', repo], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
