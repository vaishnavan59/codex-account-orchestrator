const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  loadAccountStatuses,
  updateAccountStatus,
  deleteAccountStatus
} = require('../dist/account_status_store.js');
const { ACCOUNT_STATUS_FILE_NAME } = require('../dist/constants.js');

function withTempDir(run) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cao-status-'));

  try {
    run(baseDir);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
}

test('updateAccountStatus persists sanitized fields', () => {
  withTempDir((baseDir) => {
    const now = Date.now();

    updateAccountStatus(baseDir, 'accountA', () => ({
      lastAttemptAtMs: now + 0.9,
      lastSuccessAtMs: now + 1500.5,
      lastQuotaAtMs: -10,
      cooldownUntilMs: Number.POSITIVE_INFINITY,
      consecutiveFailures: 2.8,
      lastError: ' usage_limit_reached '
    }));

    const statuses = loadAccountStatuses(baseDir);
    const status = statuses.accountA;

    assert.ok(status, 'status should exist for accountA');
    assert.equal(status.lastAttemptAtMs, Math.floor(now));
    assert.equal(status.lastSuccessAtMs, Math.floor(now + 1500.5));
    assert.equal(status.lastQuotaAtMs, undefined);
    assert.equal(status.cooldownUntilMs, undefined);
    assert.equal(status.consecutiveFailures, 2);
    assert.equal(status.lastError, 'usage_limit_reached');
  });
});

test('deleteAccountStatus removes persisted state', () => {
  withTempDir((baseDir) => {
    updateAccountStatus(baseDir, 'accountB', () => ({
      lastAttemptAtMs: Date.now(),
      consecutiveFailures: 1
    }));

    deleteAccountStatus(baseDir, 'accountB');

    const statuses = loadAccountStatuses(baseDir);
    assert.equal(statuses.accountB, undefined);
  });
});

test('invalid status file is safely backed up and ignored', () => {
  withTempDir((baseDir) => {
    const statusPath = path.join(baseDir, ACCOUNT_STATUS_FILE_NAME);
    fs.writeFileSync(statusPath, '{ this is invalid json', 'utf8');

    const originalStderrWrite = process.stderr.write;
    process.stderr.write = () => true;

    let statuses;
    try {
      statuses = loadAccountStatuses(baseDir);
    } finally {
      process.stderr.write = originalStderrWrite;
    }

    assert.deepEqual(statuses, {});

    const backups = fs
      .readdirSync(baseDir)
      .filter((name) => name.startsWith(`${ACCOUNT_STATUS_FILE_NAME}.corrupt-`));

    assert.equal(backups.length, 1);
  });
});
