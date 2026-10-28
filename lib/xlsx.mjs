// Minimal dependency-free .xlsx reader: returns each sheet's cell text as rows of strings.
// Covers what Excel and Google Sheets write (shared/inline strings, numbers, formulas with cached values). Formatting is ignored.
import { inflateRawSync } from 'node:zlib';

function unzip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('Not an .xlsx file (zip directory missing)');
  const files = new Map(); let p = buf.readUInt32LE(eocd + 16);
  for (let i = buf.readUInt16LE(eocd + 10); i > 0; i--) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28), data = buf.subarray(start, start + size);
    files.set(name, () => (method === 8 ? inflateRawSync(data) : data).toString('utf8'));
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return files;
}
const decode = s => s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e.toLowerCase()] ?? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))));
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map(m => [m[1], decode(m[2])]));
const texts = xml => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => decode(m[1])).join('');
const column = ref => [...ref.replace(/\d+$/, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

export function readXlsx(buf) {
  const files = unzip(buf), read = name => files.get(name)?.() ?? '';
  const shared = [...read('xl/sharedStrings.xml').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m => texts(m[1]));
  const targets = Object.fromEntries([...read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map(m => attrs(m[0])).map(r => [r.Id, r.Target]));
  const sheets = new Map();
  for (const [tag] of read('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const a = attrs(tag), target = targets[a['r:id']].replace(/^\//, ''), path = target.startsWith('xl/') ? target : `xl/${target}`;
    const rows = [];
    for (const [, row] of read(path).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const [, cellAttrs, inner = ''] of row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const c = attrs(cellAttrs), v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        cells[column(c.r)] = c.t === 's' ? shared[Number(v)] : c.t === 'inlineStr' ? texts(inner) : v === undefined ? '' : decode(v);
      }
      if (cells.some(x => x)) rows.push(Array.from(cells, x => x ?? ''));
    }
    sheets.set(a.name, rows);
  }
  return sheets;
}
