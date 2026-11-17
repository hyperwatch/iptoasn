const assert = require('assert');

const { sameTable } = require('../scripts/update');
const { encode } = require('../src/iptoasn');

const ROWS = [
  '1.0.0.0\t1.0.0.255\t13335\tUS\tCLOUDFLARENET - Cloudflare, Inc.',
  '8.8.8.0\t8.8.8.255\t15169\tUS\tGOOGLE - Google LLC',
].join('\n');

describe('update', () => {
  it('ignores the source when comparing tables', () => {
    assert.ok(
      sameTable(
        encode(ROWS, 'iptoasn 2026-11-01'),
        encode(ROWS, 'iptoasn 2026-11-17')
      )
    );
  });

  it('sees a changed range', () => {
    const changed = ROWS.replace('8.8.8.255', '8.8.9.255');
    assert.ok(!sameTable(encode(ROWS, 'a'), encode(changed, 'a')));
  });

  it('sees a changed name', () => {
    const changed = ROWS.replace('Google LLC', 'Google Inc.');
    assert.ok(!sameTable(encode(ROWS, 'a'), encode(changed, 'a')));
  });
});
