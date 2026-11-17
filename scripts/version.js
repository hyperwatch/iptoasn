// The version of the next release, MAJOR.MINOR.YYYYMMDD: MAJOR.MINOR from
// package.json (bumped by hand for code changes), the patch the UTC date of
// the release. Prints nothing when that version is already published (one
// release per MAJOR.MINOR and day).
//
//   node scripts/version.js [published versions, JSON]
//
// Without an argument, the published versions come from `npm view`.
const { execFileSync } = require('child_process');

const { name, version } = require('../package.json');

/**
 * @param {string} base MAJOR.MINOR(.anything) from package.json
 * @param {Date} date
 * @returns {string}
 */
function nextVersion(base, date) {
  const [major, minor] = base.split('.');
  const day = date.toISOString().slice(0, 10).replace(/-/g, '');
  return `${Number(major)}.${Number(minor)}.${day}`;
}

/** @returns {string[]} */
function publishedVersions() {
  if (process.argv[2]) {
    return JSON.parse(process.argv[2]);
  }
  try {
    const output = execFileSync('npm', ['view', name, 'versions', '--json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
    const versions = JSON.parse(output);
    return Array.isArray(versions) ? versions : [versions];
  } catch (/** @type {any} */ err) {
    // Never published. Any other error (the registry or the network down)
    // is thrown: a version can't be chosen without the published ones
    if (/E404/.test(`${err.stdout || ''}${err.stderr || ''}`)) {
      return [];
    }
    throw err;
  }
}

if (require.main === module) {
  const next = nextVersion(version, new Date());
  if (!publishedVersions().includes(next)) {
    console.log(next);
  }
}

module.exports = { nextVersion };
