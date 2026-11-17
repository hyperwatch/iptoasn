const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');

const { nextVersion } = require('../scripts/version');

const script = path.join(__dirname, '..', 'scripts', 'version.js');

describe('version', () => {
  it('is MAJOR.MINOR of package.json and the UTC date', () => {
    const date = new Date('2026-11-17T23:30:00Z');
    assert.strictEqual(nextVersion('1.0.0', date), '1.0.20261117');
    assert.strictEqual(nextVersion('1.2.20261101', date), '1.2.20261117');
    assert.strictEqual(nextVersion('2.0.0', date), '2.0.20261117');
  });

  it('sorts later days and code releases higher', () => {
    const versions = ['1.0.20261117', '1.0.20261118', '1.1.20261118'];
    const parts = versions.map((v) => v.split('.').map(Number));
    for (let i = 1; i < parts.length; i++) {
      const [a, b] = [parts[i - 1], parts[i]];
      assert.ok(
        b[0] > a[0] ||
          (b[0] === a[0] && (b[1] > a[1] || (b[1] === a[1] && b[2] > a[2])))
      );
    }
  });

  it('prints nothing when already published today', () => {
    const today = nextVersion(require('../package.json').version, new Date());
    const run = (published) =>
      execFileSync('node', [script, JSON.stringify(published)])
        .toString()
        .trim();
    assert.strictEqual(run([]), today);
    assert.strictEqual(run(['1.0.20200101']), today);
    assert.strictEqual(run([today]), '');
  });
});
