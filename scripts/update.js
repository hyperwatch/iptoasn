// Refreshes the table the package ships (data/iptoasn.bin.br) from
// iptoasn.com's ip2asn-combined table (public domain, PDDL 1.0):
//
//   npm run update
//   node scripts/update.js path/to/ip2asn-combined.tsv.gz
//
// The table is checked before it replaces the current file: enough ranges,
// not too far from the current table's, and known addresses in their AS.
// Otherwise the file is kept and the script exits with status 1.
//
// The table counts as changed when its ranges or AS names changed: not for
// a new date of the same data upstream (the header, with the source, is
// left out of the comparison).
//
// In GitHub Actions, it sets the step outputs `changed` (true or false),
// `source` (what the table was made from), `summary` (its ranges and ASes)
// and, when it changed, `before` (the same of the table it replaces), for
// the release notes.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const { DATA_FILE, decode, encode } = require('../src/iptoasn');

const SOURCE = 'https://iptoasn.com/data/ip2asn-combined.tsv.gz';
const FILE = DATA_FILE;

// Addresses whose AS isn't going to change
const CHECKS = {
  '1.1.1.1': 13335, // Cloudflare
  '8.8.8.8': 15169, // Google
  '2001:4860:4860::8888': 15169,
  '2606:4700:4700::1111': 13335,
};
const MIN_RANGES = 100000;
// At most this share of ranges gained or lost since the current table: more
// is more likely a broken source than the Internet changing in a day
const MAX_CHANGE = 0.1;

/**
 * Step outputs, in GitHub Actions
 * @param {Record<string, string>} outputs
 */
function setOutputs(outputs) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(outputs)
        .map(([key, value]) => `${key}=${value}\n`)
        .join('')
    );
  }
}

/**
 * A table without its header, the source and the padding after it (see
 * encode)
 * @param {Buffer} table
 */
const body = (table) =>
  table.subarray(Math.ceil((table.indexOf(10) + 1) / 8) * 8);

/**
 * Whether two encoded tables have the same ranges and names, whatever their
 * sources
 * @param {Buffer} a
 * @param {Buffer} b
 * @returns {boolean}
 */
const sameTable = (a, b) => body(a).equals(body(b));

/** @param {Buffer} buffer */
const gunzip = (buffer) =>
  buffer[0] === 0x1f && buffer[1] === 0x8b ? zlib.gunzipSync(buffer) : buffer;

/** @returns {Promise<{ text: string, source: string }>} */
async function download() {
  const local = process.argv[2];
  if (local) {
    return {
      text: gunzip(fs.readFileSync(local)).toString('utf8'),
      source: path.basename(local),
    };
  }
  const response = await fetch(SOURCE);
  if (!response.ok) {
    throw new Error(`${SOURCE}: ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const modified = response.headers.get('last-modified');
  const date = modified ? new Date(modified).toISOString().slice(0, 10) : '';
  return {
    text: gunzip(buffer).toString('utf8'),
    source: `${SOURCE} ${date}`.trim(),
  };
}

/** @param {number} n */
const count = (n) => n.toLocaleString('en-US');

/** @param {import('../src/iptoasn').AsnTable} table */
const summary = (table) =>
  `${count(table.size)} ranges (${count(table.v4Ends.length)} IPv4, ${count(
    table.size - table.v4Ends.length
  )} IPv6), ${count(new Set(table.numbers).size)} ASes`;

async function main() {
  const { text, source } = await download();
  const encoded = encode(text, source);
  const table = decode(encoded);

  const errors = [];
  if (table.size < MIN_RANGES) {
    errors.push(`only ${table.size} ranges`);
  }
  for (const [address, number] of Object.entries(CHECKS)) {
    const found = table.lookup(address);
    if (!found || found.number !== number) {
      errors.push(`${address} in AS ${found ? found.number : 'none'}`);
    }
  }
  /** @type {Buffer | null} */
  let current = null;
  // The table replaced, for the release notes
  let replaced = '';
  if (fs.existsSync(FILE)) {
    current = zlib.brotliDecompressSync(fs.readFileSync(FILE));
    if (!sameTable(current, encoded)) {
      const before = decode(current);
      replaced = `${summary(before)} (${before.source})`;
      const change = Math.abs(table.size - before.size) / before.size;
      if (change > MAX_CHANGE) {
        errors.push(
          `${table.size} ranges instead of ${before.size} (${Math.round(change * 100)}% change)`
        );
      }
      console.log(`Before: ${replaced}`);
    }
  }
  if (errors.length > 0) {
    console.error(`Not updated: ${errors.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  if (current !== null && sameTable(current, encoded)) {
    // The published table and its source stay
    const kept = decode(current).source;
    console.log(`Unchanged: ${summary(table)} (${kept}; now ${source})`);
    setOutputs({ changed: 'false', source: kept, summary: summary(table) });
    return;
  }

  const compressed = zlib.brotliCompressSync(encoded, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_LGWIN]: 24,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: encoded.length,
    },
  });
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, compressed);
  setOutputs({
    changed: 'true',
    source,
    summary: summary(table),
    ...(replaced ? { before: replaced } : {}),
  });
  console.log(
    `After: ${summary(table)}, ${(compressed.length / 1e6).toFixed(1)} MB (${source})`
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = { sameTable };
