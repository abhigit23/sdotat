/**
 * Minimal zip writer (stored mode, no compression). Browsers have no native
 * zip API, and attachments are usually already compressed, so we only need the
 * container: local headers, a central directory and an end record. Zip64 is
 * not supported — paste totals are capped far below 4 GB.
 */

export type ZipEntry = { name: string; data: Uint8Array };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Makes names unique within an archive: a.txt, a (1).txt, a (2).txt. */
export function dedupeNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.map((name) => {
    let candidate = name;
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    for (let i = 1; seen.has(candidate.toLowerCase()); i++) {
      candidate = `${stem} (${i})${ext}`;
    }
    seen.add(candidate.toLowerCase());
    return candidate;
  });
}

export function createZip(entries: ZipEntry[], now = new Date()): Blob {
  const encoder = new TextEncoder();
  const dosTime =
    (now.getHours() << 11) |
    (now.getMinutes() << 5) |
    (now.getSeconds() >> 1);
  const dosDate =
    (Math.max(0, now.getFullYear() - 1980) << 9) |
    ((now.getMonth() + 1) << 5) |
    now.getDate();

  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 filename
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true); // version made by
    dir.setUint16(6, 20, true); // version needed
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, dosTime, true);
    dir.setUint16(14, dosDate, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, nameBytes.length, true);
    dir.setUint32(42, offset, true); // local header offset
    const dirEntry = new Uint8Array(46 + nameBytes.length);
    dirEntry.set(new Uint8Array(dir.buffer), 0);
    dirEntry.set(nameBytes, 46);
    central.push(dirEntry);

    parts.push(local.buffer, nameBytes as BlobPart, data as BlobPart);
    offset += 30 + nameBytes.length + data.length;
  }

  const centralSize = central.reduce((sum, c) => sum + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  parts.push(...(central as BlobPart[]), end.buffer);
  return new Blob(parts, { type: "application/zip" });
}
