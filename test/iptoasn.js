const assert = require('assert');

const {
  decode,
  encode,
  ipv4Number,
  load,
  loadSync,
  parse,
} = require('../src/iptoasn');

const TABLE = [
  '1.0.0.0\t1.0.0.255\t13335\tUS\tCLOUDFLARENET - Cloudflare, Inc.',
  '1.0.1.0\t1.0.3.255\t0\tNone\tNot routed',
  '8.8.8.0\t8.8.8.255\t15169\tUS\tGOOGLE - Google LLC',
  '203.0.113.0\t203.0.113.127\t64500\tNone\tNo country',
  // Overlaps the range before it: skipped
  '203.0.113.64\t203.0.113.255\t64501\tZZ\tOverlap',
  '2001:4860::\t2001:4860:ffff:ffff:ffff:ffff:ffff:ffff\t15169\tUS\tGOOGLE - Google LLC',
  '2a03:2880::\t2a03:2880:f0ff:ffff:ffff:ffff:ffff:ffff\t32934\tUS\tFACEBOOK - Facebook, Inc.',
  'not\ta\trow',
  '',
].join('\n');

describe('iptoasn', () => {
  describe('ipv4Number', () => {
    it('reads dotted and IPv4-mapped addresses', () => {
      assert.strictEqual(ipv4Number('0.0.0.0'), 0);
      assert.strictEqual(ipv4Number('1.2.3.4'), 0x01020304);
      assert.strictEqual(ipv4Number('255.255.255.255'), 0xffffffff);
      assert.strictEqual(ipv4Number('::ffff:1.2.3.4'), 0x01020304);
      assert.strictEqual(ipv4Number('::FFFF:1.2.3.4'), 0x01020304);
    });

    it('rejects anything else', () => {
      for (const value of [
        '',
        '1.2.3',
        '1.2.3.4.5',
        '256.1.1.1',
        '01.2.3.4',
        '1..3.4',
        '1.2.3.4 ',
        '::1',
        '::1:1.2.3.4',
        '1.2.3.4/24',
      ]) {
        assert.strictEqual(ipv4Number(value), -1, value);
      }
    });
  });

  describe('parse and lookup', () => {
    const table = parse(TABLE);

    it('keeps routed, valid, non-overlapping ranges', () => {
      assert.strictEqual(table.size, 5);
    });

    it('finds IPv4 addresses, at the bounds too', () => {
      assert.deepStrictEqual(table.lookup('1.0.0.0'), {
        number: 13335,
        organization: 'CLOUDFLARENET - Cloudflare, Inc.',
        country: 'US',
      });
      assert.strictEqual(table.lookup('1.0.0.255').number, 13335);
      assert.strictEqual(table.lookup('8.8.8.8').number, 15169);
      assert.strictEqual(table.lookup('::ffff:8.8.8.8').number, 15169);
      assert.strictEqual(table.lookup('::ffff:808:808').number, 15169);
    });

    it('finds IPv6 addresses', () => {
      assert.strictEqual(table.lookup('2001:4860:4860::8888').number, 15169);
      assert.strictEqual(table.lookup('2a03:2880:f0ff::1').number, 32934);
      assert.strictEqual(table.lookup('2a03:2880:f100::1'), null);
    });

    it('leaves out the country when there is none', () => {
      assert.deepStrictEqual(table.lookup('203.0.113.100'), {
        number: 64500,
        organization: 'No country',
      });
      assert.strictEqual(table.lookup('203.0.113.200'), null);
    });

    it('returns null outside the ranges and for non-addresses', () => {
      for (const value of [
        '0.0.0.1',
        '1.0.1.1',
        '1.0.4.0',
        '255.255.255.255',
        '::',
        '::1',
        'ffff::',
        'not an address',
        '',
        undefined,
        42,
      ]) {
        assert.strictEqual(table.lookup(value), null, String(value));
      }
    });

    it('shares the range of every address in it', () => {
      assert.strictEqual(table.find('8.8.8.1'), table.find('8.8.8.200'));
      assert.notStrictEqual(table.find('8.8.8.1'), table.find('1.0.0.1'));
      assert.strictEqual(table.find('8.8.9.1'), -1);
    });

    it('reads an empty table', () => {
      const empty = parse('');
      assert.strictEqual(empty.size, 0);
      assert.strictEqual(empty.lookup('8.8.8.8'), null);
      assert.strictEqual(empty.lookup('2001:4860::1'), null);
    });
  });

  describe('encode and decode', () => {
    const encoded = encode(TABLE, 'test 2026-11-17');

    it('says what the table was made from', () => {
      assert.strictEqual(
        encoded.split('\n')[0],
        'hyperwatch-iptoasn 1\ttest 2026-11-17'
      );
    });

    it('gives the same lookups as the source', () => {
      const source = parse(TABLE);
      const table = decode(encoded);
      for (const address of [
        '1.0.0.0',
        '1.0.0.255',
        '1.0.1.1',
        '8.8.8.8',
        '8.8.9.0',
        '203.0.113.100',
        '203.0.113.200',
        '2001:4860::',
        '2001:4860:ffff:ffff:ffff:ffff:ffff:ffff',
        '2001:4861::',
        '2a03:2880:f0ff::1',
        '::1',
      ]) {
        assert.deepStrictEqual(
          table.lookup(address),
          source.lookup(address),
          address
        );
      }
    });

    it('merges contiguous ranges of the same AS', () => {
      const table = decode(
        encode(
          [
            '10.0.0.0\t10.0.0.255\t64500\tUS\tExample',
            '10.0.1.0\t10.0.1.255\t64500\tUS\tExample',
            '10.0.3.0\t10.0.3.255\t64500\tUS\tExample',
          ].join('\n')
        )
      );
      assert.strictEqual(table.size, 2);
      assert.strictEqual(table.find('10.0.0.1'), table.find('10.0.1.200'));
      assert.strictEqual(table.lookup('10.0.2.1'), null);
      assert.strictEqual(table.lookup('10.0.3.1').number, 64500);
    });

    it('rejects anything else', () => {
      assert.throws(() => decode('1.0.0.0\t1.0.0.255\t13335'), /not a/);
    });

    it('keeps what the table was made from', () => {
      assert.strictEqual(decode(encoded).source, 'test 2026-11-17');
    });
  });

  describe('the shipped table', () => {
    it('loads', async () => {
      const table = await load();
      assert.ok(table.size > 100000);
      assert.match(
        table.source,
        /^https:\/\/iptoasn\.com\/.* \d{4}-\d{2}-\d{2}$/
      );
      assert.strictEqual(table.lookup('1.1.1.1').number, 13335);
      assert.strictEqual(table.lookup('8.8.8.8').number, 15169);
      assert.strictEqual(table.lookup('2001:4860:4860::8888').number, 15169);
      assert.strictEqual(table.lookup('2606:4700:4700::1111').number, 13335);
      assert.strictEqual(table.lookup('10.0.0.1'), null);
    });

    it('loads synchronously', () => {
      assert.strictEqual(loadSync().lookup('1.1.1.1').number, 13335);
    });
  });
});
