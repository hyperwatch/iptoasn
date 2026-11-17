import iptoasn = require('@hyperwatch/iptoasn');

async function main(): Promise<void> {
  const table: iptoasn.AsnTable = await iptoasn.load();
  const sync: iptoasn.AsnTable = iptoasn.loadSync();
  const found = table.lookup('1.1.1.1');
  if (found) {
    const number: number = found.number;
    const organization: string = found.organization;
    const country: string | undefined = found.country;
    console.log(number, organization, country);
  }
  const index: number = sync.find('2606:4700:4700::1111');
  if (index !== -1) {
    console.log(sync.range(index).number);
  }
  const size: number = table.size;
  const source: string = table.source;
  const parsed: iptoasn.AsnTable = iptoasn.parse(
    '1.0.0.0\t1.0.0.255\t13335\tUS\tExample'
  );
  const encoded: string = iptoasn.encode(
    '1.0.0.0\t1.0.0.255\t13335\tUS\tExample',
    'test'
  );
  console.log(
    size,
    source,
    parsed.size,
    iptoasn.decode(encoded).size,
    iptoasn.ipv4Number('1.2.3.4'),
    iptoasn.DATA_FILE
  );
  // @ts-expect-error lookup takes one address
  table.lookup();
}

void main();
