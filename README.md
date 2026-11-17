[![NPM version](https://img.shields.io/npm/v/@hyperwatch/iptoasn)](https://www.npmjs.com/package/@hyperwatch/iptoasn) [![Build Status](https://github.com/hyperwatch/iptoasn/workflows/CI/badge.svg)](https://github.com/hyperwatch/iptoasn/actions?query=workflow%3ACI)

The autonomous system (AS) of IP addresses, IPv4 and IPv6, for Node.js: which network announces an address, e.g. `AS13335 CLOUDFLARENET - Cloudflare, Inc.`

The table comes with the package: [iptoasn.com](https://iptoasn.com/)'s `ip2asn-combined`, ready to use (3.7 MB, brotli). Nothing is downloaded at run time: update the package for a newer table.

It's what Hyperwatch's `asn` module uses.

## Install

```bash
npm install --save @hyperwatch/iptoasn
```

## Usage

```js
const iptoasn = require('@hyperwatch/iptoasn');

const table = await iptoasn.load(); // or iptoasn.loadSync()

table.lookup('1.1.1.1');
// { number: 13335, organization: 'CLOUDFLARENET - Cloudflare, Inc.', country: 'US' }

table.lookup('2a03:2880:f000::1');
// { number: 32934, organization: 'FACEBOOK - Facebook, Inc.', country: 'US' }

table.lookup('10.0.0.1'); // null: private, reserved and unrouted addresses have no AS

table.source; // what the table was made from: 'https://iptoasn.com/data/ip2asn-combined.tsv.gz 2026-11-01'
```

- `country` is the country the AS is registered in, not where the address is, and is left out when unknown.
- IPv4-mapped IPv6 addresses (`::ffff:1.1.1.1`) are looked up as IPv4.
- Load the table once and keep it: it takes about 70 ms and 14 MB, outside the JavaScript heap. Nothing is parsed: the file holds the lookup arrays as they are in memory, and names are decoded when a range is looked up.

To cache lookups, `find(address)` gives the index of the address's range (`-1` when none) and `range(index)` what is known of it: cache the first per address and the second per range, and every address of a range shares one value.

Speed: about 0.2 µs per IPv4 lookup and 3 µs per IPv6 lookup (mostly parsing the address).

Tables can also be built from an ip2asn TSV file (`parse(text)`), and written in or read from the format the package ships (`encode(text, source)` gives a `Buffer`, `decode(buffer)` a table on it). The format is described in `src/iptoasn.js`; it is little-endian, so it loads on little-endian platforms only (every platform Node.js runs on in practice).

## Data

[iptoasn.com](https://iptoasn.com/)'s `ip2asn-combined.tsv.gz`, from public BGP data, under the [Public Domain Dedication and License v1.0](https://opendatacommons.org/licenses/pddl/1.0/). Ranges are merged when contiguous and announced by the same AS, and each AS has one name and country.

## Versions

Versions are `MAJOR.MINOR.YYYYMMDD`: the patch is the day of the release (UTC), so `1.0.20261117` has the table of November 17, 2026 (`table.source` says which file of iptoasn.com it was built from). `MAJOR.MINOR` changes with the code, as semver: `^1.0.0` gets every new table of version 1.0 and later 1.x.

## Releases

The [Release workflow](.github/workflows/release.yml) runs every day: it builds the table from iptoasn.com's latest file and publishes a release when the table differs from the latest release's, or when `MAJOR.MINOR` in `package.json` changed. At most one release per day and `MAJOR.MINOR`. Each release is tagged on the code it was built from, with a GitHub release giving the table's source.

The new table is checked first: enough ranges, at most 10% more or fewer than in the latest release, and well-known addresses in their AS (Cloudflare, Google). Otherwise nothing is published and the run fails: look at the change before releasing it by hand.

- **A code change:** bump `MAJOR.MINOR` in `package.json` (`1.1.0`), merge, and run the workflow (or wait for the next day).
- **The table** isn't in git: `npm run update` builds it in `data/` (needed for the tests), from iptoasn.com, or from a file: `node scripts/update.js path/to/ip2asn-combined.tsv.gz`.

Publishing uses [npm's trusted publishing](https://docs.npmjs.com/trusted-publishers): no npm token in the repository. It's set up on npmjs.com, in the package's settings: GitHub Actions, `hyperwatch/iptoasn`, workflow `release.yml`.
