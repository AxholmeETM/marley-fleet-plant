// Reads the cells of one sheet from an .xlsx file (a zip of XML files), with no library.
// Enough for exports such as SoTrack's Trip List: strings, numbers and dates (as Excel serial numbers).

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// The files inside the zip, by name, read on demand.
function unzip(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files = {};
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('bad zip directory');
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    files[name] = async () => {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = buf.subarray(start, start + size);
      const out = method === 0 ? data : method === 8 ? await inflate(data) : null;
      if (!out) throw new Error('unsupported zip compression');
      return dec.decode(out);
    };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#'
  ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
  : ENTITIES[e] ?? m));
const attr = (tag, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return m ? unescapeXml(m[1]) : null; };
const textOf = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join('');
const colIndex = (ref) => [...ref.replace(/\d+$/, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

// Rows of the sheet called `prefer` (or the first sheet): arrays of strings and numbers, blanks as null.
async function readSheet(buf, prefer) {
  const files = unzip(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
  if (!files['xl/workbook.xml']) throw new Error('not a workbook');
  const wb = await files['xl/workbook.xml']();
  const rels = files['xl/_rels/workbook.xml.rels'] ? await files['xl/_rels/workbook.xml.rels']() : '';
  const sheets = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({ name: attr(m[0], 'name'), rid: attr(m[0], 'r:id') }));
  const sheet = sheets.find((s) => prefer && s.name && s.name.toLowerCase() === prefer.toLowerCase()) || sheets[0];
  if (!sheet) throw new Error('no sheets');
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((t) => attr(t, 'Id') === sheet.rid);
  let target = rel ? attr(rel, 'Target') : 'worksheets/sheet1.xml';
  target = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
  if (!files[target]) throw new Error('sheet missing');
  const shared = files['xl/sharedStrings.xml']
    ? [...(await files['xl/sharedStrings.xml']()).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]))
    : [];
  const xml = await files[target]();
  const rows = [];
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = Number(attr(rm[0], 'r')) - 1;
    const row = [];
    for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const head = '<c' + cm[1] + '>';
      const ref = attr(head, 'r');
      const t = attr(head, 't');
      const body = cm[2] || '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body);
      let value = null;
      if (t === 's') value = v ? shared[Number(v[1])] ?? null : null;
      else if (t === 'inlineStr') value = textOf(body);
      else if (t === 'str' || t === 'e') value = v ? unescapeXml(v[1]) : null;
      else if (t === 'b') value = v ? v[1] === '1' : null;
      else if (v) value = Number(v[1]);
      row[ref ? colIndex(ref) : row.length] = value;
    }
    rows[Number.isFinite(r) && r >= 0 ? r : rows.length] = Array.from(row, (x) => (x === undefined ? null : x));
  }
  return { name: sheet.name, rows: Array.from(rows, (x) => x || []) };
}

// Excel serial date (days since 30/12/1899, no time zone) to 'YYYY-MM-DD HH:MM:SS'.
function serialToText(n) {
  const d = new Date(Math.round((n - 25569) * 86400) * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

module.exports = { readSheet, serialToText };
