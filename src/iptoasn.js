/**
 * The autonomous system (AS) of IP addresses, from iptoasn.com's ip2asn
 * table (https://iptoasn.com/, public domain), shipped with the package:
 * nothing is downloaded at run time.
 *
 *   const iptoasn = require('@hyperwatch/iptoasn');
 *   const table = await iptoasn.load();
 *   table.lookup('1.1.1.1');
 *   // { number: 13335, organization: 'CLOUDFLARENET - Cloudflare, Inc.', country: 'US' }
 *
 * Ranges are kept in typed arrays sorted by start and searched by bisection:
 * IPv4 as 32-bit numbers (a dotted address is parsed by hand, no BigInt),
 * IPv6 as two 64-bit halves. Ranges announced by no one (AS 0, "Not
 * routed") are left out, so their addresses get nothing.
 *
 * A lookup first finds the range of the address (`find`, a number), then
 * what is known of it (`range`): callers can cache the second per range, so
 * every address of a range shares one value.
 */
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const zlib = require('zlib');

const { Address4, Address6 } = require('ip-address');

/** The table shipped with the package (scripts/update.js refreshes it) */
const DATA_FILE = path.join(__dirname, '..', 'data', 'iptoasn.tsv.br');

/**
 * An address as an Address4 or Address6, IPv4-mapped IPv6 addresses as
 * IPv4. null when it isn't a valid address (or is a range).
 * @param {string} value
 * @returns {Address4 | Address6 | null}
 */
function parseAddress(value) {
  if (!value || value.includes('/')) {
    return null;
  }
  if (!value.includes(':')) {
    return Address4.isValid(value) ? new Address4(value) : null;
  }
  if (!Address6.isValid(value)) {
    return null;
  }
  const address = new Address6(value);
  return address.isMapped4() ? address.to4() : address;
}

const MASK64 = (1n << 64n) - 1n;

/**
 * What a table knows of an address. `country` is the country the AS is
 * registered in, not where the address is: geoip says that.
 * @typedef {object} AsnLookup
 * @property {number} number
 * @property {string} organization The AS description, e.g.
 *   `CLOUDFLARENET - Cloudflare, Inc.`
 * @property {string} [country] Two letters, when known
 */

/**
 * @typedef {object} Row
 * @property {bigint} start
 * @property {bigint} end
 * @property {number} number
 * @property {number} label Index of `country\torganization` in the labels
 */

/**
 * A dotted IPv4 address (also IPv4-mapped, `::ffff:192.0.2.1`) as a number,
 * -1 when it isn't one. Faster than ip-address, for the common case.
 * @param {string} value
 * @returns {number}
 */
function ipv4Number(value) {
  let i = 0;
  if (value.length > 7 && value.charCodeAt(0) === 58 /* colon */) {
    if (!/^::ffff:/i.test(value)) {
      return -1;
    }
    i = 7;
  }
  let result = 0;
  let parts = 0;
  let part = -1;
  let digits = 0;
  for (; i <= value.length; i++) {
    const c = i < value.length ? value.charCodeAt(i) : 46; /* end as a dot */
    if (c >= 48 && c <= 57) {
      // No leading zeros (010 is ambiguous), at most 3 digits
      if (digits === 1 && part === 0) {
        return -1;
      }
      part = (part === -1 ? 0 : part) * 10 + (c - 48);
      digits++;
      if (digits > 3 || part > 255) {
        return -1;
      }
    } else if (c === 46) {
      if (part === -1) {
        return -1;
      }
      result = result * 256 + part;
      parts++;
      part = -1;
      digits = 0;
    } else {
      return -1;
    }
  }
  return parts === 4 ? result : -1;
}

class AsnTable {
  /**
   * @param {Row[]} ipv4 Sorted by start, not overlapping
   * @param {Row[]} ipv6 Sorted by start, not overlapping
   * @param {string[]} labels `country\torganization`, deduplicated
   */
  constructor(ipv4, ipv6, labels) {
    this.v4Starts = new Uint32Array(ipv4.length);
    this.v4Ends = new Uint32Array(ipv4.length);
    // Halves of IPv6 starts and ends: high at 2i, low at 2i + 1
    this.v6Starts = new BigUint64Array(ipv6.length * 2);
    this.v6Ends = new BigUint64Array(ipv6.length * 2);
    // Ranges are numbered IPv4 first, then IPv6
    const count = ipv4.length + ipv6.length;
    this.numbers = new Uint32Array(count);
    this.labelIndexes = new Uint32Array(count);
    this.labels = labels;
    /** Number of ranges */
    this.size = count;
    /** What the table was made from (a URL and a date), when known */
    this.source = '';

    ipv4.forEach((row, i) => {
      this.v4Starts[i] = Number(row.start);
      this.v4Ends[i] = Number(row.end);
      this.numbers[i] = row.number;
      this.labelIndexes[i] = row.label;
    });
    ipv6.forEach((row, i) => {
      this.v6Starts[2 * i] = row.start >> 64n;
      this.v6Starts[2 * i + 1] = row.start & MASK64;
      this.v6Ends[2 * i] = row.end >> 64n;
      this.v6Ends[2 * i + 1] = row.end & MASK64;
      const j = ipv4.length + i;
      this.numbers[j] = row.number;
      this.labelIndexes[j] = row.label;
    });
  }

  /**
   * The range of an IPv4 address given as a number
   * @param {number} n
   * @returns {number} -1 when in no range
   */
  findIpv4(n) {
    const starts = this.v4Starts;
    let low = 0;
    let high = starts.length - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (starts[mid] <= n) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return found !== -1 && n <= this.v4Ends[found] ? found : -1;
  }

  /**
   * The range of an IPv6 address given as its two 64-bit halves
   * @param {bigint} high
   * @param {bigint} low
   * @returns {number} -1 when in no range
   */
  findIpv6(high, low) {
    const starts = this.v6Starts;
    let lo = 0;
    let hi = starts.length / 2 - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const h = starts[2 * mid];
      if (h < high || (h === high && starts[2 * mid + 1] <= low)) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (found === -1) {
      return -1;
    }
    const endHigh = this.v6Ends[2 * found];
    const inside =
      high < endHigh || (high === endHigh && low <= this.v6Ends[2 * found + 1]);
    return inside ? this.v4Ends.length + found : -1;
  }

  /**
   * The range of an address, -1 when it is in none or isn't an address
   * @param {unknown} address
   * @returns {number}
   */
  find(address) {
    if (typeof address !== 'string' || !address) {
      return -1;
    }
    const n = ipv4Number(address);
    if (n !== -1) {
      return this.findIpv4(n);
    }
    if (!address.includes(':')) {
      return -1;
    }
    const parsed = parseAddress(address);
    if (!parsed) {
      return -1;
    }
    const value = parsed.bigInt();
    if (!(parsed instanceof Address6)) {
      // IPv4-mapped, written in a form ipv4Number doesn't read
      return this.findIpv4(Number(value));
    }
    return this.findIpv6(value >> 64n, value & MASK64);
  }

  /**
   * What is known of a range found by find()
   * @param {number} index
   * @returns {AsnLookup}
   */
  range(index) {
    const [country, organization] =
      this.labels[this.labelIndexes[index]].split('\t');
    /** @type {AsnLookup} */
    const result = { number: this.numbers[index], organization };
    if (country) {
      result.country = country;
    }
    return result;
  }

  /**
   * The AS announcing an address, null when unknown or not an address
   * @param {unknown} address
   * @returns {AsnLookup | null}
   */
  lookup(address) {
    const index = this.find(address);
    return index === -1 ? null : this.range(index);
  }
}

/**
 * @param {string} value
 * @returns {{ ipv6: boolean, n: bigint } | null}
 */
function parseBound(value) {
  // Most rows are IPv4: no ip-address for them
  const n = ipv4Number(value);
  if (n !== -1 && !value.includes(':')) {
    return { ipv6: false, n: BigInt(n) };
  }
  const parsed = parseAddress(value);
  if (!parsed) {
    return null;
  }
  return { ipv6: parsed instanceof Address6, n: parsed.bigInt() };
}

/**
 * The ranges of an ip2asn TSV file (ip2asn-combined.tsv, ip2asn-v4.tsv or
 * ip2asn-v6.tsv), per family, sorted. Lines that don't parse are skipped,
 * and so is a range overlapping the one before it.
 * @param {string} text
 * @returns {{ ipv4: Row[], ipv6: Row[], labels: string[] }}
 */
function readRows(text) {
  /** @type {Row[]} */
  const ipv4 = [];
  /** @type {Row[]} */
  const ipv6 = [];
  /** @type {Map<string, number>} */
  const labelIndex = new Map();
  /** @type {string[]} */
  const labels = [];

  let position = 0;
  while (position < text.length) {
    let newline = text.indexOf('\n', position);
    if (newline === -1) {
      newline = text.length;
    }
    const line = text.slice(position, newline).replace(/\r$/, '');
    position = newline + 1;

    const fields = line.split('\t');
    if (fields.length < 5) {
      continue;
    }
    const number = Number(fields[2]);
    // AS 0: not routed
    if (!Number.isInteger(number) || number <= 0 || number > 0xffffffff) {
      continue;
    }
    const start = parseBound(fields[0]);
    const end = parseBound(fields[1]);
    if (!start || !end || start.ipv6 !== end.ipv6 || start.n > end.n) {
      continue;
    }
    const country = /^[A-Z]{2}$/.test(fields[3]) ? fields[3] : '';
    const organization = fields.slice(4).join(' ').replace(/\s+/g, ' ').trim();
    const label = `${country}\t${organization}`;
    let index = labelIndex.get(label);
    if (index === undefined) {
      index = labels.length;
      labels.push(label);
      labelIndex.set(label, index);
    }
    (start.ipv6 ? ipv6 : ipv4).push({
      start: start.n,
      end: end.n,
      number,
      label: index,
    });
  }

  // Bisection needs ranges sorted and apart
  /**
   * @param {Row[]} rows
   * @returns {Row[]}
   */
  const sorted = (rows) => {
    rows.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    /** @type {Row[]} */
    const kept = [];
    for (const row of rows) {
      if (!kept.length || row.start > kept[kept.length - 1].end) {
        kept.push(row);
      }
    }
    return kept;
  };
  return { ipv4: sorted(ipv4), ipv6: sorted(ipv6), labels };
}

/**
 * Builds a table from the text of an ip2asn TSV file
 * @param {string} text
 * @returns {AsnTable}
 */
function parse(text) {
  const { ipv4, ipv6, labels } = readRows(text);
  return new AsnTable(ipv4, ipv6, labels);
}

// The compact format of the table the package ships (data/iptoasn.tsv.br):
//
//   hyperwatch-iptoasn 1<TAB><what it was made from>
//   # asns
//   <AS number><TAB><country><TAB><organization>
//   # ipv4
//   <gap><TAB><size><TAB><AS number>
//   # ipv6
//   <gap><TAB><size><TAB><AS number>
//
// Numbers in base 36. A range starts `gap` addresses after the end of the
// one before it (the first one after address -1) and holds `size + 1`
// addresses. Contiguous ranges of the same AS are merged. Each AS has one
// country and organization: the first ones seen.
const FORMAT = 'hyperwatch-iptoasn 1';

/**
 * The compact format of an ip2asn TSV file
 * @param {string} text
 * @param {string} [source] What it was made from (a URL and a date)
 * @returns {string}
 */
function encode(text, source = '') {
  const { ipv4, ipv6, labels } = readRows(text);
  /** @type {Map<number, string>} */
  const names = new Map();
  for (const row of [...ipv4, ...ipv6]) {
    if (!names.has(row.number)) {
      names.set(row.number, labels[row.label]);
    }
  }
  const lines = [`${FORMAT}\t${source.replace(/\s+/g, ' ')}`, '# asns'];
  for (const number of [...names.keys()].sort((a, b) => a - b)) {
    lines.push(`${number.toString(36)}\t${names.get(number)}`);
  }
  for (const [name, rows] of /** @type {const} */ ([
    ['ipv4', ipv4],
    ['ipv6', ipv6],
  ])) {
    lines.push(`# ${name}`);
    /** @type {Row[]} */
    const merged = [];
    for (const row of rows) {
      const last = merged[merged.length - 1];
      if (last && last.number === row.number && row.start === last.end + 1n) {
        last.end = row.end;
      } else {
        merged.push({ ...row });
      }
    }
    let previous = -1n;
    for (const row of merged) {
      lines.push(
        [
          (row.start - previous - 1n).toString(36),
          (row.end - row.start).toString(36),
          row.number.toString(36),
        ].join('\t')
      );
      previous = row.end;
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * A table from its compact format (see encode)
 * @param {string} text
 * @returns {AsnTable}
 */
function decode(text) {
  const lines = text.split('\n');
  if (!lines[0].startsWith(FORMAT)) {
    throw new Error('not a hyperwatch-iptoasn table');
  }
  /** @type {Map<number, number>} AS number → label */
  const labelOf = new Map();
  /** @type {string[]} */
  const labels = [];
  /** @type {Record<string, Row[]>} */
  const rows = { ipv4: [], ipv6: [] };
  let section = '';
  let previous = -1n;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      continue;
    }
    if (line.startsWith('# ')) {
      section = line.slice(2);
      previous = -1n;
      continue;
    }
    const tab = line.indexOf('\t');
    if (section === 'asns') {
      labelOf.set(parseInt(line.slice(0, tab), 36), labels.length);
      labels.push(line.slice(tab + 1));
      continue;
    }
    const target = rows[section];
    if (!target) {
      continue;
    }
    const [gap, size, asn] = line.split('\t');
    const number = parseInt(asn, 36);
    const label = labelOf.get(number);
    if (label === undefined) {
      throw new Error(`AS ${number} has no name (line ${i + 1})`);
    }
    const start = previous + 1n + base36(gap);
    const end = start + base36(size);
    target.push({ start, end, number, label });
    previous = end;
  }
  const table = new AsnTable(rows.ipv4, rows.ipv6, labels);
  table.source = lines[0].slice(FORMAT.length).trim();
  return table;
}

/**
 * A base-36 number as a BigInt (IPv6 gaps don't fit in a Number)
 * @param {string} value
 * @returns {bigint}
 */
function base36(value) {
  // Numbers up to 10 digits are exact as Numbers (36^10 < 2^53)
  if (value.length <= 10) {
    return BigInt(parseInt(value, 36));
  }
  let result = 0n;
  for (const c of value) {
    result = result * 36n + BigInt(parseInt(c, 36));
  }
  return result;
}

const brotliDecompress = promisify(zlib.brotliDecompress);

/**
 * The table shipped with the package (about 0.4 s and 22 MB). Load it once
 * and keep it: every call builds a new one.
 * @returns {Promise<AsnTable>}
 */
async function load() {
  const compressed = await fs.promises.readFile(DATA_FILE);
  return decode((await brotliDecompress(compressed)).toString('utf8'));
}

/**
 * load(), synchronously
 * @returns {AsnTable}
 */
function loadSync() {
  return decode(
    zlib.brotliDecompressSync(fs.readFileSync(DATA_FILE)).toString('utf8')
  );
}

module.exports.AsnTable = AsnTable;
module.exports.DATA_FILE = DATA_FILE;
module.exports.load = load;
module.exports.loadSync = loadSync;
module.exports.ipv4Number = ipv4Number;
module.exports.decode = decode;
module.exports.encode = encode;
module.exports.parse = parse;
