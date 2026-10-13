// Compiles the EJS templates in views/ into plain JavaScript functions (src/views.generated.js).
// Cloudflare Workers can't compile templates at run time (no eval), so the app always renders
// these pre-built functions, on Workers and in Node alike. Runs before `npm start`, `npm test`
// and every Cloudflare build.
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const VIEWS = path.join(__dirname, '..', 'views');
const OUT = path.join(__dirname, '..', 'src', 'views.generated.js');

const KEYWORDS = new Set(`break case catch class const continue debugger default delete do else export extends false finally for
  function if import in instanceof let new null of return super switch this throw true try typeof var void while with yield
  async await static get set undefined NaN Infinity arguments eval`.split(/\s+/));
const EJS_NAMES = new Set(['locals', 'escapeFn', 'include', 'rethrow', '__output', '__append', '__locals', '__line', '__lines', '__filename']);

// Splits JavaScript into identifier/punctuation tokens, skipping strings, comments and regexes,
// but looking inside ${...} in template literals.
function tokens(src) {
  const out = [];
  let i = 0;
  const regexCanStart = () => {
    const prev = out[out.length - 1];
    return !prev || /^[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) || prev === 'return' || prev === 'typeof';
  };
  function skipString(q) {
    for (i++; i < src.length && src[i] !== q; i++) if (src[i] === '\\') i++;
    i++;
  }
  function template() {
    for (i++; i < src.length; i++) {
      if (src[i] === '\\') { i++; continue; }
      if (src[i] === '`') { i++; return; }
      if (src[i] === '$' && src[i + 1] === '{') { i += 2; scan('}'); i--; }
    }
  }
  function scan(until) {
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      if (until && c === until && depth === 0) { i++; return; }
      if (c === '{') depth++;
      if (c === '}') depth--;
      if (c === '"' || c === "'") { skipString(c); out.push('"'); continue; }
      if (c === '`') { template(); out.push('"'); continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 2; continue; }
      if (c === '/' && regexCanStart()) {
        let inClass = false;
        for (i++; i < src.length; i++) {
          if (src[i] === '\\') { i++; continue; }
          if (src[i] === '[') inClass = true;
          else if (src[i] === ']') inClass = false;
          else if (src[i] === '/' && !inClass) break;
        }
        i++;
        while (/[a-z]/.test(src[i])) i++;
        out.push('"');
        continue;
      }
      const id = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 100));
      if (id) { out.push(id[0]); i += id[0].length; continue; }
      if (c === '=' && src[i + 1] === '>') { out.push('=>'); i += 2; continue; }
      if (c === '.' && src[i + 1] === '.' && src[i + 2] === '.') { out.push('...'); i += 3; continue; }
      if (c === '?' && src[i + 1] === '.') { out.push('.'); i += 2; continue; }
      if (!/\s/.test(c)) out.push(c);
      i++;
    }
  }
  scan(null);
  return out;
}

const isIdent = (t) => /^[A-Za-z_$][\w$]*$/.test(t) && !KEYWORDS.has(t);

// Names a template reads from its locals: identifiers that aren't property names, declared in the
// template, JavaScript globals or EJS internals.
function freeNames(src) {
  const t = tokens(src);
  const declared = new Set();
  for (let k = 0; k < t.length; k++) {
    if (['const', 'let', 'var', 'function'].includes(t[k])) {
      // const x = / const { a, b: c } = / const [k, v] of
      if (isIdent(t[k + 1])) declared.add(t[k + 1]);
      if (t[k + 1] === '{' || t[k + 1] === '[') {
        let depth = 0;
        for (let j = k + 1; j < t.length; j++) {
          if (t[j] === '{' || t[j] === '[') depth++;
          if (t[j] === '}' || t[j] === ']') depth--;
          if (isIdent(t[j]) && t[j + 1] !== ':') declared.add(t[j]);
          if (depth === 0) break;
        }
      }
    }
    if (t[k] === '=>') {
      if (isIdent(t[k - 1])) declared.add(t[k - 1]);
      if (t[k - 1] === ')') {
        let depth = 0;
        for (let j = k - 1; j >= 0; j--) {
          if (t[j] === ')') depth++;
          if (t[j] === '(') depth--;
          if (isIdent(t[j])) declared.add(t[j]);
          if (depth === 0) break;
        }
      }
    }
  }
  const names = new Set();
  t.forEach((tok, k) => {
    if (!isIdent(tok) || t[k - 1] === '.' || declared.has(tok) || EJS_NAMES.has(tok) || tok in globalThis) return;
    names.add(tok);
  });
  return [...names].sort();
}

function compile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const opts = { strict: true, compileDebug: false, filename: file };
  const first = new ejs.Template(text, opts);
  first.compile();
  const names = freeNames(first.source);
  const tpl = new ejs.Template(text, { ...opts, destructuredLocals: names });
  tpl.compile(); // throws here if the generated code doesn't parse
  return `function (locals, escapeFn, include, rethrow) {\n"use strict";\n${tpl.source}}`;
}

function list(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
    ? list(path.join(dir, e.name), `${prefix}${e.name}/`)
    : e.name.endsWith('.ejs') ? [`${prefix}${e.name.slice(0, -4)}`] : []));
}

const names = list(VIEWS).sort();
const body = names.map((n) => `  ${JSON.stringify(n)}: ${compile(path.join(VIEWS, `${n}.ejs`))}`).join(',\n');
const generated = `// Generated by scripts/build-views.js from views/*.ejs. Do not edit.\n/* eslint-disable */\nmodule.exports = {\n${body}\n};\n`;
// Leave the file alone when nothing changed, so `npm run dev` doesn't restart in a loop.
if (!fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== generated) fs.writeFileSync(OUT, generated);
if (require.main === module) console.log(`Built ${names.length} views into ${path.relative(process.cwd(), OUT)}`);
