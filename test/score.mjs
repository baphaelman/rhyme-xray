// Score the engine against rhymes that trusted sources mark, rather than against our own judgment:
//   1. Byron's Don Juan (public domain) is in ottava rima, ABABABCC: the form says which line endings
//      rhyme. Text from Project Gutenberg (#21700).
//   2. MCFlow (Condit-Schultz 2016, Empirical Musicology Review) transcribes 124 rap songs with every
//      rhyme marked by hand: syllables that share a letter in its **rhyme spine rhyme. It holds lyrics
//      and has no license, so it is downloaded here and never committed.
// Both are downloaded once into .cache/ (gitignored). Recall is the share of the source's rhyme pairs
// within reach that the engine puts in one group.
//   npm run score                         this engine
//   npm run score -- ../other/engine.js   this engine and another, side by side
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dictionary } from 'cmu-pronouncing-dictionary';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(root, '.cache');
const engines = [['this', path.join(root, 'engine.js')], ...process.argv.slice(2).map(p => [path.basename(path.dirname(path.resolve(p))), path.resolve(p)])]
  .map(([name, file]) => { const E = require(file); E.setDictionary(dictionary); return { name, E }; });
const PRONOUN = /^(it|him|her|them|us)$/;

async function download() {
  fs.mkdirSync(CACHE, { recursive: true });
  const dj = path.join(CACHE, 'don-juan.txt');
  if (!fs.existsSync(dj)) {
    // gutenberg.org itself refuses scripts at times; its mirror serves the same file
    for (const url of ['https://gutenberg.pglaf.org/2/1/7/0/21700/21700-0.txt', 'https://www.gutenberg.org/cache/epub/21700/pg21700.txt']) {
      const r = await fetch(url).catch(() => null);
      const t = r && r.ok ? await r.text() : '';
      if (t.includes('CANTO THE FIRST')) { fs.writeFileSync(dj, t); break; }
    }
    if (!fs.existsSync(dj)) throw new Error('could not download Don Juan from Project Gutenberg');
  }
  const mc = path.join(CACHE, 'MCFlow');
  if (!fs.existsSync(mc)) execFileSync('git', ['clone', '-q', '--depth', '1', 'https://github.com/Computational-Cognitive-Musicology-Lab/MCFlow.git', mc]);
  return { dj, mcflow: path.join(mc, 'Humdrum') };
}

const W = Math.max(8, ...engines.map(e => e.name.length + 2));
const pct = (a, n) => (n ? (100 * a / n).toFixed(1) + '%' : '–').padStart(W);
const names = () => engines.map(e => e.name.padStart(W)).join('');
const sameGroup = (a, b) => a && b && a.group != null && a.group === b.group;

// ------------------------------------------------------------------ Don Juan
function donJuan(file, tier) {
  const raw = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
  const first = raw.indexOf('CANTO THE FIRST');
  const body = raw.slice(raw.indexOf('CANTO THE FIRST', first + 1), raw.indexOf('*** END'));
  const stanzas = body.split(/\n\s*\n/).map(b => b.split('\n').map(l => l.trim()).filter(Boolean))
    .filter(ls => ls.length === 8 && ls.every(l => /[a-z]/i.test(l) && l.length < 75));
  const PAIRS = [[0, 2], [2, 4], [0, 4], [1, 3], [3, 5], [1, 5], [6, 7]];
  const n = { all: 0, pronoun: 0 }, hit = engines.map(() => ({ all: 0, pronoun: 0 }));
  for (const st of stanzas) {
    const As = engines.map(({ E }) => E.analyse(st.join('\n'), { tier, reach: 5 }));
    for (const [i, j] of PAIRS) {
      const last = k => (st[k].match(/[A-Za-z’']+(?=[^A-Za-z]*$)/) || [''])[0].toLowerCase();
      const kinds = ['all'].concat(PRONOUN.test(last(i)) || PRONOUN.test(last(j)) ? ['pronoun'] : []);
      kinds.forEach(k => n[k]++);
      As.forEach((A, e) => { if (sameGroup(A.lines[i].syls.at(-1), A.lines[j].syls.at(-1))) kinds.forEach(k => hit[e][k]++); });
    }
  }
  console.log(`\nDon Juan: ${stanzas.length} stanzas, ottava rima, tier ${tier}`);
  console.log('  line-end pairs the form rhymes'.padEnd(44) + names());
  [['all', 'all'], ['pronoun', 'with a pronoun at one end']].forEach(([k, label]) =>
    console.log(`  ${label} (${n[k]})`.padEnd(44) + hit.map(h => pct(h[k], n[k])).join('')));
}

// ------------------------------------------------------------------ MCFlow
// A row is a syllable: "op-" "-por-" "-tu-" make one word. A **break of 3 or more starts a main
// prosodic phrase, which is taken as a line; *>Verse1 and the like start a section.
function parseRap(file) {
  let head = null, sec = 0;
  const syls = [];
  for (const r of fs.readFileSync(file, 'utf8').split('\n')) {
    if (r.startsWith('!')) continue;
    const c = r.split('\t');
    if (r.startsWith('**')) { head = Object.fromEntries(c.map((h, i) => [h.slice(2), i])); continue; }
    if (!head) continue;
    if (r.startsWith('*>')) { sec++; continue; }
    if (r.startsWith('*') || r.startsWith('=') || !c[head.lyrics] || c[head.lyrics] === '.') continue;
    syls.push({ lyr: c[head.lyrics], sec, brk: +c[head.break] || 0, rhyme: c[head.rhyme] });
  }
  const words = [];
  syls.forEach(s => { if (s.lyr.startsWith('-') && words.length) words.at(-1).syls.push(s); else words.push({ syls: [s] }); });
  words.forEach(w => { w.text = w.syls.map(s => s.lyr.replace(/^-|-$/g, '')).join(''); });
  const lines = [];
  words.forEach(w => {
    const s = w.syls[0];
    if (!lines.length || s.brk >= 3 || s.sec !== lines.at(-1).sec) lines.push({ sec: s.sec, words: [] });
    lines.at(-1).words.push(w);
  });
  return lines;
}
// Letters MCFlow links a syllable by; "~" (repetition) and "?" (weak) are left out, as its author suggests.
const letters = s => s.rhyme.split(' ').filter(t => t !== '.' && !/[~?]/.test(t)).map(t => t.replace(/[()[\]_]/g, '')).filter(t => /^[A-Za-z]+$/.test(t));

function mcflow(dir, tier) {
  const reach = 4, KINDS = ['all', 'line ends', 'with a pronoun', 'line ends, with a pronoun'];
  const n = {}, hit = engines.map(() => ({})), prec = engines.map(() => ({ n: 0, hit: 0 })), all = engines.map(() => ({ n: 0, hit: 0 }));
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.rap'))) {
    const lines = parseRap(path.join(dir, f));
    let text = '';
    lines.forEach((L, i) => { if (i && L.sec !== lines[i - 1].sec) text += '\n'; text += L.words.map(w => w.text).join(' ') + '\n'; });
    // each engine's syllable for each MCFlow syllable, where line, word and syllable counts agree
    const maps = engines.map(({ E }) => {
      const m = new Map(), body = E.analyse(text, { tier, reach }).lines.filter(L => L.n >= 0 && L.words.length);
      if (body.length !== lines.length) return m;
      body.forEach((EL, li) => {
        if (EL.words.length !== lines[li].words.length) return;
        EL.words.forEach((W, wi) => {
          const ms = lines[li].words[wi].syls;
          if (W.syls && W.syls.length === ms.length) W.syls.forEach((s, si) => m.set(ms[si], s));
        });
      });
      return m;
    });
    const at = new Map();
    lines.forEach((L, li) => L.words.forEach((w, wi) => w.syls.forEach((s, si) => at.set(s, {
      li, w, end: wi === L.words.length - 1 && si === w.syls.length - 1
    }))));
    const mapped = s => maps.every(m => m.has(s));
    const byLetter = new Map();
    for (const [s, p] of at) letters(s).forEach(l => {
      const k = p.w.syls[0].sec + ':' + l;
      if (!byLetter.has(k)) byLetter.set(k, []);
      byLetter.get(k).push(s);
    });
    for (const ms of byLetter.values()) for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) {
      const a = ms[i], b = ms[j], pa = at.get(a), pb = at.get(b);
      if (Math.abs(pa.li - pb.li) >= reach || !mapped(a) || !mapped(b)) continue;
      const pron = [pa, pb].some(p => p.w.syls.length === 1 && PRONOUN.test(p.w.text.toLowerCase().replace(/[^a-z]/g, '')));
      const kinds = ['all'].concat(pa.end && pb.end ? ['line ends'] : [], pron ? ['with a pronoun'] : [], pa.end && pb.end && pron ? ['line ends, with a pronoun'] : []);
      kinds.forEach(k => bump(n, k));
      maps.forEach((m, e) => { if (sameGroup(m.get(a), m.get(b))) kinds.forEach(k => bump(hit[e], k)); });
    }
    // precision: of the stressed syllable pairs an engine puts in one group (within reach), how
    // many MCFlow links too
    const stressed = [...at.keys()].filter(s => mapped(s));
    for (let i = 0; i < stressed.length; i++) for (let j = i + 1; j < stressed.length; j++) {
      const a = stressed[i], b = stressed[j], pa = at.get(a), pb = at.get(b);
      if (pb.li - pa.li >= reach || a.sec !== b.sec) continue;
      const la = new Set(letters(a)), both = letters(b).some(l => la.has(l));
      maps.forEach((m, e) => {
        const x = m.get(a), y = m.get(b);
        if (x.stress > 0 && y.stress > 0 && x.word !== y.word && sameGroup(x, y)) { all[e].n++; if (both) all[e].hit++; }
      });
    }
    // precision at line ends: of the line-end pairs an engine links, how many MCFlow links too
    const ends = lines.map(L => L.words.at(-1).syls.at(-1));
    for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length && j - i < reach; j++) {
      const a = ends[i], b = ends[j];
      if (a.sec !== b.sec || !mapped(a) || !mapped(b)) continue;
      const la = new Set(letters(a)), both = letters(b).some(l => la.has(l));
      maps.forEach((m, e) => { if (sameGroup(m.get(a), m.get(b))) { prec[e].n++; if (both) prec[e].hit++; } });
    }
  }
  console.log(`\nMCFlow: hand-marked rhymes in 124 rap songs, tier ${tier}, reach ${reach}`);
  console.log('  rhyme pairs MCFlow marks, found'.padEnd(44) + names());
  KINDS.forEach(k => console.log(`  ${k} (${n[k]})`.padEnd(44) + hit.map(h => pct(h[k] || 0, n[k])).join('')));
  console.log('  stressed pairs linked that MCFlow marks'.padEnd(44) + all.map(p => pct(p.hit, p.n)).join(''));
  console.log('  line-end pairs linked that MCFlow marks'.padEnd(44) + prec.map(p => pct(p.hit, p.n)).join(''));
}

const src = await download();
const { PERFECT, NEAR, ASSONANCE } = engines[0].E.TIERS;
donJuan(src.dj, NEAR);
for (const tier of [ASSONANCE, NEAR, PERFECT]) mcflow(src.mcflow, tier);
