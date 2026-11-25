/*
 * Rhyme X-ray engine.
 *
 * Pure functions, no DOM. Loaded as a classic <script> by index.html (so the page
 * also works from file://) and with require() by the tests.
 *
 * Pipeline: lyric text -> words -> CMU phonemes (with lyric-spelling fallbacks)
 * -> syllables -> pairwise syllable matches -> multisyllabic runs -> rhyme groups
 * -> colours, end-rhyme scheme and statistics.
 *
 * The rules are documented with their sources in README.md.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- dictionary
  let DICT = null;
  const has = Object.prototype.hasOwnProperty;
  const pronCache = new Map();
  function setDictionary(d) { DICT = d; pronCache.clear(); }
  function lookup(w) { return DICT && has.call(DICT, w) ? DICT[w] : null; }

  // ---------------------------------------------------------------- phonemes
  const VOWELS = new Set(['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW']);
  // Vowels that collapse towards schwa when unstressed.
  const REDUCED = new Set(['AH', 'IH', 'ER', 'UH']);
  // cot–caught merger: most rap is performed in accents where these are one vowel, and the
  // dictionary is half-merged itself ("caught", "cost" /ɑ/ but "taught", "lost" /ɔ/).
  // Not before r: "door" /dɔɹ/ and "car" /kɑɹ/ stay apart in every accent.
  const VNORM = { AO: 'AA' };
  // Before r the dictionary writes one vowel two ways: "here" /hiɹ/ but "year" /jɪɹ/, "beer"
  // /bɪɹ/ but "beer's" /biɹz/, "poor" /puɹ/ but "tour" /tʊɹ/. Each pair is one sound. So are
  // "marry" /æɹ/ and "merry" /ɛɹ/ in most American accents: MCFlow's annotator marks 84% of
  // such pairs as rhymes, as often as pairs with one vowel.
  const BEFORE_R = { IY: 'IH', UW: 'UH', AE: 'EH' };
  const normVowel = s => (s.rhymeCons[0] === 'R' ? BEFORE_R[s.vowel] || s.vowel : VNORM[s.vowel] || s.vowel);
  // Consonants that sit at the edge of a syllable and do not carry rhyme.
  const GLIDES = new Set(['W', 'Y', 'HH']);
  // Manner families (Pattison's "family rhymes"); voicing is ignored inside a family.
  const MANNER = {
    P: 'stop', T: 'stop', K: 'stop', B: 'stop', D: 'stop', G: 'stop',
    F: 'fric', TH: 'fric', S: 'fric', SH: 'fric', CH: 'fric',
    V: 'fric', DH: 'fric', Z: 'fric', ZH: 'fric', JH: 'fric',
    M: 'nasal', N: 'nasal', NG: 'nasal', L: 'L', R: 'R'
  };

  const IPA_V = {
    AA: 'ɑ', AE: 'æ', AH: 'ʌ', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ', EH: 'ɛ', ER: 'ɝ', EY: 'eɪ',
    IH: 'ɪ', IY: 'i', OW: 'oʊ', OY: 'ɔɪ', UH: 'ʊ', UW: 'u'
  };
  const IPA_C = {
    B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f', G: 'ɡ', HH: 'h', JH: 'dʒ', K: 'k', L: 'l', M: 'm',
    N: 'n', NG: 'ŋ', P: 'p', R: 'ɹ', S: 's', SH: 'ʃ', T: 't', TH: 'θ', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ'
  };
  function ipaVowel(p, stress) {
    if (stress === 0 && p === 'AH') return 'ə';
    if (stress === 0 && p === 'ER') return 'ɚ';
    return IPA_V[p] || p;
  }
  function ipaPhone(tok) {
    const m = /^([A-Z]+)([012])?$/.exec(tok);
    if (!m) return tok;
    return VOWELS.has(m[1]) ? ipaVowel(m[1], m[2] === undefined ? 1 : +m[2]) : (IPA_C[m[1]] || m[1].toLowerCase());
  }
  /** ARPAbet string ("S P IH1 N") -> IPA ("spɪn"). */
  function toIPA(arpabet) { return arpabet.trim().split(/\s+/).map(ipaPhone).join(''); }

  function parsePhones(s) {
    return s.trim().split(/\s+/).filter(Boolean).map(t => {
      const m = /^([A-Z]+)([012])?$/.exec(t);
      return m ? { p: m[1], s: m[2] === undefined ? -1 : +m[2] } : null;
    }).filter(Boolean);
  }

  // ---------------------------------------------------------------- lyric spellings
  const STOP = new Set(('a an the to of and in on at is it its i im i\'m my me you your we he she they them ' +
    'but or for with that this as be was are so if do by from up our us his her him not no').split(' '));

  // Lyric spellings the dictionary lacks or gets wrong for rap delivery.
  const OVERRIDES = {
    "em": ['AH0 M', 'them'], "'em": ['AH0 M', 'them'], "tha": ['DH AH0', 'the'], "da": ['DH AH0', 'the'],
    "ya": ['Y AH0', 'you'], "cuz": ['K AH0 Z', 'because'], "coz": ['K AH0 Z', 'because'],
    "'cause": ['K AH0 Z', 'because'], "dat": ['DH AE1 T', 'that'], "dis": ['DH IH1 S', 'this'],
    "dem": ['DH EH1 M', 'them'], "dey": ['DH EY1', 'they'], "lil": ['L IH1 L', 'little'],
    "ima": ['AY1 M AH0', "I'm a"], "imma": ['AY1 M AH0', "I'm a"], "finna": ['F IH1 N AH0', 'fixing to'],
    "tryna": ['T R AY1 N AH0', 'trying to'], "y'all": ['Y AO1 L', 'you all'], "nah": ['N AA1', 'no'],
    "gon": ['G AA1 N', 'going'], "ol'": ['OW1 L', 'old'], "o'": ['AH0', 'of'], "'n'": ['AH0 N', 'and'],
    "n'": ['AH0 N', 'and'], "thru": ['TH R UW1', 'through'], "wit": ['W IH1 TH', 'with'],
    "yo": ['Y OW1', null], "assonance": ['AE1 S AH0 N AH0 N S', null], "assonant": ['AE1 S AH0 N AH0 N T', null], "ain't": ['EY1 N T', null], "nothin": ['N AH1 TH IH0 N', 'nothing']
  };
  // Object pronouns are unstressed in speech, even at the end of a phrase, and lean on the word
  // before them: "half-cock it" sounds like "pocket". The dictionary's first reading is the
  // stressed citation form; these are its weak forms (it lists none for "us", so that one is
  // written out). They rhyme like the last syllable of a word, not like a function word, and a
  // rapper can still lean on one: it keeps its full vowel as a second chance to rhyme ("you quit"
  // / "I did it", "her" / "fur").
  const WEAK_FORMS = { it: 'it(2)', him: 'him(2)', her: 'her(2)', them: 'them(2)', us: 'AH0 S' };

  function normalise(w) {
    let m, d;
    if ((m = /^(.*[a-z])in'?$/.exec(w))) {
      if ((d = lookup(m[1] + 'ing'))) return [d.replace(/ NG$/, ' N'), m[1] + 'ing'];
      const base = m[1], undoubled = /([b-df-hj-np-tv-z])\1$/.test(base) ? base.slice(0, -1) : null;
      for (const c of [base, base + 'e', undoubled].filter(Boolean)) {
        if ((d = lookup(c))) return [d + ' IH0 N', base + 'ing'];
      }
    }
    if ((m = /^(.*)a$/.exec(w)) && (d = lookup(m[1] + 'er'))) return [d.replace(/ER0$/, 'AH0'), m[1] + 'er'];
    if ((m = /^(.*)az$/.exec(w)) && (d = lookup(m[1] + 'ers'))) return [d.replace(/ER0 Z$/, 'AH0 Z'), m[1] + 'ers'];
    if ((m = /^(.*)z$/.exec(w)) && (d = lookup(m[1] + 's'))) return [d, m[1] + 's'];
    if ((m = /^(.*)n't$/.exec(w)) && (d = lookup(m[1]))) return [d + ' AH0 N T', null];
    if ((m = /^(.*)'(s|ll|d|re|ve|m)$/.exec(w))) {
      const base = lookup(m[1]) || (normalise(m[1]) || [])[0];
      if (base) return [base + ' ' + { s: 'Z', ll: 'L', d: 'D', re: 'ER0', ve: 'V', m: 'M' }[m[2]], null];
    }
    if ((m = /^(.*)ers$/.exec(w)) && (d = lookup(m[1]) || lookup(m[1] + 'e'))) return [d + ' ER0 Z', null];
    if ((m = /^(.*)er$/.exec(w)) && (d = lookup(m[1]) || lookup(m[1] + 'e'))) return [d + ' ER0', null];
    if ((m = /^(.*?)e?s$/.exec(w)) && (d = lookup(m[1]) || lookup(m[1] + 'e'))) return [d + ' Z', null];
    if ((m = /^(.*)ed$/.exec(w)) && (d = lookup(m[1]) || lookup(m[1] + 'e'))) return [d + ' D', null];
    if ((m = /^(.*)ing$/.exec(w)) && (d = lookup(m[1]) || lookup(m[1] + 'e') || lookup(m[1].slice(0, -1)))) return [d + ' IH0 NG', null];
    if ((m = /^(.*)ly$/.exec(w)) && (d = lookup(m[1]))) return [d + ' L IY0', null];
    if ((m = /^(.*)y$/.exec(w)) && (d = lookup(m[1]) || lookup(m[1] + 'e') || lookup(m[1].slice(0, -1)))) return [d + ' IY0', null];
    if ((m = /^(.*)a$/.exec(w)) && (d = lookup(m[1]))) return [d + ' AH0', null];
    return null;
  }

  // Rough spelling-to-sound rules, used only when everything else fails.
  const G2P = [
    [/^tch/, 'CH'], [/^dge/, 'JH'], [/^igh/, 'AY'], [/^ough/, 'AO'], [/^augh/, 'AO'], [/^eigh/, 'EY'],
    [/^ch/, 'CH'], [/^sh/, 'SH'], [/^th/, 'TH'], [/^ph/, 'F'], [/^wh/, 'W'], [/^ck/, 'K'], [/^ng/, 'NG'],
    [/^qu/, 'K W'], [/^gh/, ''], [/^x/, 'K S'], [/^c(?=[eiy])/, 'S'], [/^c/, 'K'],
    [/^(ee|ea)/, 'IY'], [/^oo/, 'UW'], [/^(ou|ow)/, 'AW'], [/^(oi|oy)/, 'OY'], [/^(ai|ay|ey)/, 'EY'],
    [/^(au|aw)/, 'AO'], [/^ie/, 'IY'], [/^oa/, 'OW'], [/^(ue|ew)/, 'UW'],
    [/^ar/, 'AA R'], [/^(er|ir|ur|yr)/, 'ER'], [/^or/, 'AO R'],
    [/^a(?=[bcdfgklmnpstvz]e$)/, 'EY'], [/^i(?=[bcdfgklmnpstvz]e$)/, 'AY'],
    [/^o(?=[bcdfgklmnpstvz]e$)/, 'OW'], [/^u(?=[bcdfgklmnpstvz]e$)/, 'UW'],
    [/^y(?=[aeiou])/, 'Y'], [/^a(?=s?$)/, 'AH'], [/^o$/, 'OW'],
    [/^a/, 'AE'], [/^e/, 'EH'], [/^i/, 'IH'], [/^o/, 'AA'], [/^u/, 'AH']
  ];
  const G2C = { b: 'B', d: 'D', f: 'F', g: 'G', h: 'HH', j: 'JH', k: 'K', l: 'L', m: 'M', n: 'N', p: 'P', r: 'R', s: 'S', t: 'T', v: 'V', w: 'W', z: 'Z' };

  function guessPhones(word) {
    let w = word.replace(/[^a-z]/g, '');
    if (/^(kn|wr)/.test(w)) w = w.slice(1);
    const out = [];
    const hasV = () => out.some(p => VOWELS.has(p));
    let i = 0;
    while (i < w.length) {
      const rest = w.slice(i);
      if (rest === 'e' && hasV()) { i++; continue; }
      if (rest === 'y') { out.push(hasV() ? 'IY' : 'AY'); i++; continue; }
      if (rest[0] === 'y' && i > 0) { out.push('IH'); i++; continue; }
      let hit = false;
      for (const [re, ph] of G2P) {
        const m = re.exec(rest);
        if (m) { if (ph) out.push(...ph.split(' ')); i += m[0].length; hit = true; break; }
      }
      if (hit) continue;
      const c = rest[0];
      if (G2C[c] && !(i > 0 && w[i - 1] === c)) out.push(G2C[c]);
      i++;
    }
    // Vowel-less interjections ("skrrt", "hmm", "brr") get a syllabic consonant nucleus.
    if (!out.some(p => VOWELS.has(p)) && out.length) {
      const k = out.findIndex(p => p === 'R' || p === 'M' || p === 'N' || p === 'L');
      if (k >= 0 && out[k] === 'R') out[k] = 'ER';
      else out.splice(k >= 0 ? k : 0, 0, 'AH');
    }
    let first = true;
    return out.map(p => VOWELS.has(p) ? p + (first ? (first = false, '1') : '0') : p).join(' ');
  }

  const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
    'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  function numberWords(n) {
    if (n < 20) return [ONES[n]];
    if (n < 100) return [TENS[Math.floor(n / 10)]].concat(n % 10 ? [ONES[n % 10]] : []);
    if (n < 1000) return [ONES[Math.floor(n / 100)], 'hundred'].concat(n % 100 ? numberWords(n % 100) : []);
    if (n >= 1900 && n < 2000 || n >= 2010 && n < 2100) return numberWords(Math.floor(n / 100)).concat(n % 100 ? numberWords(n % 100) : ['hundred']);
    return numberWords(Math.floor(n / 1000)).concat(['thousand']).concat(n % 1000 ? numberWords(n % 1000) : []);
  }

  /**
   * Pronounce one lyric token.
   * Returns { ph: ARPAbet string, src: 'dict' | 'norm' | 'guess', as: spelling it was read as | null } or null.
   */
  function pronounce(tok) {
    const w = tok.toLowerCase().replace(/[’‘`]/g, "'");
    if (pronCache.has(w)) return pronCache.get(w);
    const r = pronounceUncached(w);
    pronCache.set(w, r);
    return r;
  }
  /** Other dictionary readings of a word: "record(2)", "record(3)"… */
  function alternatives(w, first) {
    const out = [];
    for (let k = 2; k <= 4; k++) {
      const d = lookup(w + '(' + k + ')');
      if (d && d !== first && !out.includes(d)) out.push(d);
    }
    return out;
  }

  // ---------------------------------------------------------------- choosing a reading
  // Words that change with grammar. Stress-shift pairs (REcord / reCORD, PERfect / perFECT)
  // are found automatically; these change a vowel or a final consonant instead.
  const POS_FORMS = {
    live: { verb: /IH1/, other: /AY1/ }, lead: { verb: /IY1/, other: /EH1/ },
    wind: { verb: /AY1/, other: /IH1/ }, close: { verb: /Z$/, other: /S$/ },
    use: { verb: /Z$/, other: /S$/ }, excuse: { verb: /Z$/, other: /S$/ },
    abuse: { verb: /Z$/, other: /S$/ }, house: { verb: /Z$/, other: /S$/ }
  };
  const VERB_BEFORE = new Set(("to will would can could should must might may shall i you we they " +
    "don't didn't doesn't won't can't cannot never gonna wanna tryna let's i'll you'll we'll they'll " +
    "he'll she'll i'd you'd we'd they'd please").split(' '));
  const NOUN_BEFORE = new Set(("a an the my your his her its our their this these those every no some any " +
    "of in on at for from by so very too more most is was are be been it's that's he's she's").split(' '));
  // Words whose readings differ in meaning or tense, so rhyme may choose between them.
  // Other alternates in the dictionary are accents (get / "git", want / "wont") and stay put.
  const HETERONYMS = new Set(('read again against either neither tear wound bass dove bow row sow minute ' +
    'wind live lead close use excuse abuse house been route envelope').split(' '));
  const OBJECT_AFTER = new Set('the a an my your his her our their it me him them us'.split(' '));

  /** "verb" | "noun" | null, from the words either side (not across punctuation). */
  function grammarCue(prev, next, gapPrev, gapNext) {
    if (prev && !/[,.;:!?]/.test(gapPrev)) {
      if (VERB_BEFORE.has(prev.key)) return { cue: 'verb', word: prev.text, side: 'after' };
      if (NOUN_BEFORE.has(prev.key)) return { cue: 'noun', word: prev.text, side: 'after' };
    }
    if (next && !/[,.;:!?]/.test(gapNext) && OBJECT_AFTER.has(next.key)) return { cue: 'verb', word: next.text, side: 'before' };
    return null;
  }

  function pronounceUncached(w) {
    const bare = w.replace(/^'+|'+$/g, '');
    if (/^\d+$/.test(bare) && bare.length <= 4) {
      const words = numberWords(+bare);
      const ps = words.map(x => lookup(x));
      if (ps.every(Boolean)) return { ph: ps.join(' '), src: 'norm', as: words.join(' ') };
      return null;
    }
    if (!/[a-z]/.test(bare) || /\d/.test(bare)) return null;
    for (const c of [w, bare]) if (has.call(OVERRIDES, c)) return { ph: OVERRIDES[c][0], src: 'norm', as: OVERRIDES[c][1] };
    if (has.call(WEAK_FORMS, bare) && lookup(bare)) {
      const d = lookup(WEAK_FORMS[bare]);
      return { ph: d || WEAK_FORMS[bare], src: d ? 'dict' : 'norm', as: null, full: lookup(bare) };
    }
    for (const c of [w, bare]) {
      const d = lookup(c);
      if (d) return { ph: d, src: 'dict', as: null, alts: STOP.has(bare) ? [] : alternatives(c, d) };
    }
    const n = normalise(bare);
    if (n) return { ph: n[0], src: 'norm', as: n[1] };
    const parts = bare.split("'").filter(Boolean);
    if (parts.length > 1) {
      const ps = parts.map(p => lookup(p) || (normalise(p) || [])[0]);
      if (ps.every(Boolean)) return { ph: ps.join(' '), src: 'norm', as: null };
    }
    const g = guessPhones(bare);
    return g ? { ph: g, src: 'guess', as: null } : null;
  }

  // ---------------------------------------------------------------- syllables
  const ONSET2 = new Set(['P R', 'P L', 'B R', 'B L', 'T R', 'D R', 'K R', 'K L', 'G R', 'G L', 'F R', 'F L', 'TH R', 'SH R',
    'S P', 'S T', 'S K', 'S M', 'S N', 'S L', 'S W', 'T W', 'K W', 'D W', 'P Y', 'B Y', 'K Y', 'F Y', 'M Y', 'HH Y', 'V Y', 'G Y', 'TH W']);
  const ONSET3 = new Set(['S T R', 'S P R', 'S K R', 'S P L', 'S K W']);

  /**
   * Split a phoneme list into syllables (maximal legal onset).
   * Each syllable keeps `rhymeCons`: every consonant after its vowel up to the next vowel
   * of the word, because an intervocalic consonant belongs to both syllables for rhyme
   * purposes ("squeal-ers" rhymes with "wheels").
   */
  function syllabify(ph) {
    const vi = [];
    ph.forEach((x, i) => { if (VOWELS.has(x.p)) vi.push(i); });
    if (!vi.length) return [];
    const starts = [0];
    for (let k = 1; k < vi.length; k++) {
      const a = vi[k - 1] + 1, b = vi[k];
      const cl = ph.slice(a, b).map(x => x.p);
      let take = 0;
      if (cl.length) {
        take = 1;
        if (cl.length >= 3 && ONSET3.has(cl.slice(-3).join(' '))) take = 3;
        else if (cl.length >= 2 && ONSET2.has(cl.slice(-2).join(' '))) take = 2;
      }
      starts.push(b - take);
    }
    return vi.map((v, k) => {
      const from = starts[k], to = k + 1 < vi.length ? starts[k + 1] : ph.length;
      const rhymeCons = (k + 1 < vi.length ? ph.slice(v + 1, vi[k + 1]) : ph.slice(v + 1))
        .map(x => x.p).filter(p => !GLIDES.has(p));
      return {
        vowel: ph[v].p,
        stress: ph[v].s < 0 ? 1 : ph[v].s,
        arpabet: ph.slice(from, to).map(x => x.p + (x.s >= 0 ? x.s : '')).join(' '),
        onset: ph.slice(from, v).map(x => x.p).join(' '),
        rhymeCons
      };
    });
  }

  /** Map n syllables onto letter ranges of the written token. Approximate by design. */
  function segmentLetters(t, n) {
    const len = t.length;
    if (n <= 1) return [[0, len]];
    if (/^\d+$/.test(t)) return Array.from({ length: n }, (_, k) => [Math.floor(k * len / n), Math.floor((k + 1) * len / n)]);
    const isV = i => {
      const c = t[i];
      if ('aeiou'.includes(c)) return !(c === 'u' && t[i - 1] === 'q');
      if (c === 'y') return i > 0 && !'aeiou'.includes(t[i + 1] || '#');
      return false;
    };
    const g = [];
    for (let i = 0; i < len; i++) {
      if (!isV(i)) continue;
      if (g.length && g[g.length - 1].e === i) g[g.length - 1].e++;
      else g.push({ s: i, e: i + 1 });
    }
    const core = t.replace(/'+$/, '');
    while (g.length > n) {
      const last = g[g.length - 1];
      if (g.length > 1 && last.e - last.s === 1 && /^e[sd]?$/.test(core.slice(last.s))) { g.pop(); continue; }
      let best = 0, bd = 1e9;
      for (let k = 0; k < g.length - 1; k++) { const d = g[k + 1].s - g[k].e; if (d < bd) { bd = d; best = k; } }
      g.splice(best, 2, { s: g[best].s, e: g[best + 1].e });
    }
    while (g.length < n) {
      // syllabic l / m with no written vowel: "diddly", "rhythm"
      const k0 = g.findIndex((x, k) => k + 1 < g.length && /[^aeiouy'][lm]/.test(t.slice(x.e + 1, g[k + 1].s)));
      if (k0 >= 0) {
        const rel = t.slice(g[k0].e + 1, g[k0 + 1].s).search(/[^aeiouy'][lm]/);
        const at = g[k0].e + 1 + rel + 1;
        g.splice(k0 + 1, 0, { s: at, e: at + 1 });
        continue;
      }
      if (g.length && /[^aeiouy'][lm]$/.test(core) && core.length - 1 > g[g.length - 1].e) {
        g.push({ s: core.length - 1, e: core.length });
        continue;
      }
      const k = g.findIndex(x => x.e - x.s >= 2);
      if (k < 0) break;
      const x = g[k];
      g.splice(k, 1, { s: x.s, e: x.s + 1 }, { s: x.s + 1, e: x.e });
    }
    if (g.length !== n) return Array.from({ length: n }, (_, k) => [Math.round(k * len / n), Math.round((k + 1) * len / n)]);
    const b = [0];
    for (let k = 1; k < n; k++) {
      const a = g[k - 1].e, c = g[k].s, cons = t.slice(a, c);
      let cut;
      if (!cons.length) cut = c;
      else if (cons.length === 1 || /^(th|sh|ch|ph|wh)$/.test(cons)) cut = a;
      else if (/^ck/.test(cons)) cut = a + 2;
      else cut = a + 1;
      b.push(cut);
    }
    b.push(len);
    return b.slice(0, -1).map((s, k) => [s, b[k + 1]]);
  }

  // ---------------------------------------------------------------- matching
  // Match tiers, best first. Settings choose the loosest tier that may link syllables.
  const PERFECT = 0, NEAR = 1, ASSONANCE = 2, WEAK = 3, NONE = 9;
  const TIER_NAMES = ['perfect', 'near', 'assonance', 'weak'];

  const fold = c => (c === 'NG' ? 'N' : c);
  function codaTier(a, b) {
    const x = a.map(fold), y = b.map(fold);
    if (x.join() === y.join()) return PERFECT;
    const mx = x.map(c => MANNER[c] || c), my = y.map(c => MANNER[c] || c);
    if (mx.join() === my.join()) return NEAR; // family rhyme: same manner, e.g. time/line, cat/cap
    // additive / subtractive: one coda is the other plus 1–2 trailing consonants (free/freeze, mine/mind)
    const [s, l] = mx.length < my.length ? [mx, my] : [my, mx];
    const extra = l.length - s.length;
    if ((extra === 1 || (extra === 2 && s.length > 0)) && s.every((c, i) => c === l[i])) return NEAR;
    return ASSONANCE;
  }

  /** How well two syllables rhyme, as a tier. */
  function matchTier(a, b) {
    if (a.vclass === b.vclass || (a.full && a.full === b.vclass) || (b.full && b.full === a.vclass)) return codaTier(a.rhymeCons, b.rhymeCons);
    if (a.reduced && b.reduced) return WEAK; // two schwas: rhyme only inside a longer chain
    return NONE;
  }

  /** Key used to name a group, as IPA: vowel + coda. */
  function rhymeKey(s, withCoda) {
    const v = ipaVowel(normVowel(s), s.stress === 0 && s.reduced ? 0 : 1);
    return withCoda ? v + s.rhymeCons.map(c => IPA_C[fold(c)] || '').join('') : v;
  }

  class UF {
    constructor(n) { this.p = Array.from({ length: n }, (_, i) => i); }
    find(x) { while (this.p[x] !== x) { this.p[x] = this.p[this.p[x]]; x = this.p[x]; } return x; }
    union(a, b) { a = this.find(a); b = this.find(b); if (a !== b) this.p[Math.max(a, b)] = Math.min(a, b); }
  }

  // Palette order that keeps consecutive picks far apart in hue.
  const COLOR_ORDER = [0, 6, 3, 9, 1, 7, 4, 10, 2, 8, 5, 11, 12, 13];

  const DEFAULTS = { tier: ASSONANCE, identical: true, reach: 4, paletteSize: 14, maxLanes: 3 };

  // ---------------------------------------------------------------- ad-libs
  // Sounds dropped around a bar rather than part of it. Hesitations ("uh", "skrrt") are ad-libs
  // wherever they sit. Interjections ("yeah", "oh") are ad-libs only at the start or end of a
  // line and set off by punctuation, so "for years, yeah" drops its "yeah" but "I said yeah"
  // keeps it. Words in parentheses are backing vocals or ad-libs.
  const HESITATION = /^(u+h+|u+m+|h+u+h+|h+m+|m+h?m+|u+g+h+|sk+r+t*|b+r+|g+r+|a+y{2,})$/;
  const INTERJECTION = /^(y+e+a+h*|y+e+h+|y+a+h+|y+u+h+|a+y+e*|a+y+o+|y+o+|h+e+y+|o+h+|a+h+|a+w+|w+h?o+a+h*|w+o+o+|h+a+(h+a+)*h?|s+h+e+e+s+h+)$/;
  const SET_OFF = /[,;:!?.…—–()-]/;

  /** Mark each word's `adlib`: 'parentheses', 'filler' or null. */
  function markAdlibs(L) {
    const ws = L.words;
    let depth = 0, at = 0;
    ws.forEach(W => {
      for (; at < W.s; at++) depth = Math.max(0, depth + (L.raw[at] === '(' ? 1 : L.raw[at] === ')' ? -1 : 0));
      W.adlib = depth > 0 ? 'parentheses' : HESITATION.test(W.text.toLowerCase().replace(/['’‘`]/g, '')) ? 'filler' : null;
    });
    const inter = ws.map(W => INTERJECTION.test(W.text.toLowerCase().replace(/['’‘`]/g, '')));
    const loose = i => !!ws[i].adlib || inter[i];
    // punctuation between word i - 1 and word i
    const setOff = i => SET_OFF.test(L.raw.slice(i > 0 ? ws[i - 1].e : 0, i < ws.length ? ws[i].s : L.raw.length));
    // a run at the end: "…for years, uh, yeah"
    let a = ws.length;
    while (a > 0 && loose(a - 1)) a--;
    for (let i = a; i < ws.length; i++) if (!ws[i].adlib && (i === 0 || setOff(i) || ws[i - 1].adlib)) ws[i].adlib = 'filler';
    // a run at the start: "Uh, yeah, I'm back"
    let b = 0;
    while (b < ws.length && loose(b)) b++;
    for (let i = b - 1; i >= 0; i--) if (!ws[i].adlib && (setOff(i + 1) || (i + 1 < ws.length && ws[i + 1].adlib))) ws[i].adlib = 'filler';
  }

  // ---------------------------------------------------------------- analysis
  function tokenize(text) {
    const lines = [];
    let n = 0, section = 0, open = false;
    const wordRe = /['’]?[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*['’]?/g;
    text.replace(/\r\n?/g, '\n').split('\n').forEach((raw, index) => {
      // Section labels such as "[Chorus]" or "(Verse 2)" are headings, not lyrics.
      const heading = /^\s*[\[(][^\])]*[\])]\s*$/.test(raw);
      const lyric = !heading && !!raw.trim();
      // A blank line or a heading ends a section; rhymes never link across sections.
      if (!lyric && open) { section++; open = false; }
      if (lyric) open = true;
      const L = { raw, index, heading, section, n: lyric ? n++ : -1, words: [], syls: [] };
      if (heading) { lines.push(L); return; }
      let m;
      wordRe.lastIndex = 0;
      while ((m = wordRe.exec(raw))) L.words.push({ s: m.index, e: m.index + m[0].length, text: m[0] });
      markAdlibs(L);
      lines.push(L);
    });
    return lines;
  }

  /** Matching fields every syllable needs: reduced vowel, vowel class. */
  function prep(s) {
    // The dictionary puts secondary stress on some weak vowels ("per-ˌfect"); in speech
    // they are unstressed.
    if (s.stress === 2 && REDUCED.has(s.vowel)) {
      s.stress = 0;
      s.arpabet = s.arpabet.replace(new RegExp('\\b' + s.vowel + '2\\b'), s.vowel + '0');
    }
    s.reduced = s.stress === 0 && REDUCED.has(s.vowel);
    // Unstressed AH/IH/UH are all heard as schwa; unstressed ER keeps its r-colour.
    s.vclass = s.reduced ? (s.vowel === 'ER' ? '@R' : '@') : normVowel(s);
    return s;
  }
  function wordIPA(syls) {
    return syls.map(s => (s.stress === 1 && syls.length > 1 ? 'ˈ' : s.stress === 2 ? 'ˌ' : '') + toIPA(s.arpabet)).join('.');
  }

  /**
   * Pick a reading for every word that has several (8,444 CMU words do).
   * 1. Grammar: stress-shift pairs take the verb reading after "to", "I", "will"…
   *    or before an object ("record it"), and the noun/adjective reading after "a",
   *    "the", "so", "is"… With no cue, the noun/adjective reading, which is more common.
   *    POS_FORMS covers pairs that change a vowel or final consonant (live, lead, close).
   * 2. Rhyme: if another reading makes a perfect or near rhyme within reach that the
   *    grammatical one does not, use it. Rappers bend words this way, and it is the only
   *    way to tell present "read" from past "read".
   */
  function chooseReadings(lines, opt) {
    const words = [];
    for (const L of lines) {
      L.words.forEach((W, i) => {
        W.syls = [];
        W.cands = null;
        // Ad-libs get no syllables: they never rhyme and never end the bar.
        if (W.adlib) return;
        const pr = pronounce(W.text);
        if (!pr) return;
        W.src = pr.src; W.as = pr.as; W.full = pr.full || null;
        W.key = W.text.toLowerCase().replace(/[’‘`]/g, "'").replace(/^'+|'+$/g, '');
        W.line = L.n;
        W.section = L.section;
        W.cands = [pr.ph].concat(pr.alts || []);
        W.candSyls = W.cands.map(ph => syllabify(parsePhones(ph)).map(prep));
        W.choice = 0;
        W.reading = null;
        W.cued = false;
        W.ambiguous = false;
        if (W.cands.length > 1) {
          const prev = L.words[i - 1], next = L.words[i + 1];
          const cue = grammarCue(prev && prev.key ? prev : prev && { key: prev.text.toLowerCase(), text: prev.text },
            next && { key: next.text.toLowerCase().replace(/[’‘`]/g, "'"), text: next.text },
            prev ? L.raw.slice(prev.e, W.s) : '', next ? L.raw.slice(W.e, next.s) : '');
          const stressAt = W.candSyls.map(sy => sy.findIndex(x => x.stress === 1));
          const forms = POS_FORMS[W.key];
          const stressShift = new Set(stressAt.filter(x => x >= 0)).size > 1;
          W.ambiguous = !!forms || stressShift || HETERONYMS.has(W.key);
          if (forms && cue) {
            const re = cue.cue === 'verb' ? forms.verb : forms.other;
            const k = W.cands.findIndex(ph => re.test(ph));
            if (k >= 0) { W.choice = k; W.cued = true; W.reading = `${cue.cue === 'verb' ? 'verb' : 'noun/adjective'} reading, ${cue.side} “${cue.word}”`; }
          } else if (stressShift) {
            const order = stressAt.map((x, k) => [x, k]).filter(([x]) => x >= 0);
            const fore = order.reduce((m, c) => (c[0] < m[0] ? c : m))[1];
            const back = order.reduce((m, c) => (c[0] > m[0] ? c : m))[1];
            if (cue) W.cued = true;
            if (cue && cue.cue === 'verb') { W.choice = back; W.reading = `verb stress, ${cue.side} “${cue.word}”`; }
            else if (cue) { W.choice = fore; W.reading = `noun/adjective stress, ${cue.side} “${cue.word}”`; }
            else { W.choice = fore; W.reading = 'the usual noun/adjective stress'; }
          }
        }
        words.push(W);
      });
      const withSound = L.words.filter(w => w.cands && w.candSyls[0].length);
      if (withSound.length) withSound[withSound.length - 1].lineEnd = true;
    }

    // Rhyme evidence, measured against the other words' current readings.
    const span = opt.reach - 1;
    const byLine = new Map();
    words.forEach(W => {
      if (W.line < 0) return;
      const sy = W.candSyls[W.choice];
      const stop = sy.length === 1 && STOP.has(W.key);
      sy.forEach((s, k) => {
        const end = W.lineEnd && k === sy.length - 1;
        if (stop || !(s.stress > 0 || end)) return;
        if (!byLine.has(W.line)) byLine.set(W.line, []);
        byLine.get(W.line).push({ W, s, end });
      });
    });
    words.forEach(W => {
      if (!W.ambiguous || W.line < 0) return;
      const scored = W.candSyls.map(sy => {
        let total = 0, best = null;
        sy.forEach((s, k) => {
          const end = W.lineEnd && k === sy.length - 1;
          if (!(s.stress > 0 || end)) return;
          let top = 0, who = null;
          for (let l = W.line - span; l <= W.line + span; l++) {
            for (const p of byLine.get(l) || []) {
              if (p.W === W || p.W.key === W.key || p.W.section !== W.section) continue;
              const t = matchTier(s, p.s);
              let v = t === PERFECT ? 3 : t === NEAR ? 2 : 0;
              if (!v) continue;
              if (end && p.end) v *= 1.5; // end rhymes are deliberate
              if (v > top) { top = v; who = p; }
            }
          }
          total += top;
          if (who && (!best || top > best.v)) best = { v: top, p: who };
        });
        return { total, best };
      });
      // Rhyme must beat the grammatical reading by a near rhyme, or by a perfect or end rhyme
      // when the grammar was explicit ("I live my life" stays /lɪv/ despite "life").
      const margin = W.cued ? 3 : 2;
      let pick = W.choice;
      scored.forEach((x, k) => { if (x.total >= scored[W.choice].total + margin && x.total > scored[pick].total) pick = k; });
      if (pick !== W.choice) {
        W.choice = pick;
        W.reading = `rhymes with “${scored[pick].best.p.W.text.replace(/[,.;:!?]+$/, '')}”`;
      } else if (!W.reading) {
        W.reading = "the dictionary's first reading";
      }
    });
  }

  function analyse(text, options) {
    const opt = Object.assign({}, DEFAULTS, options || {});
    const lines = tokenize(text);
    const all = [];

    // 0. pronunciations, choosing between dictionary readings where a word has several
    chooseReadings(lines, opt);

    // 1. syllables
    for (const L of lines) {
      for (const W of L.words) {
        if (!W.cands) continue;
        W.syls = [];
        W.arpabet = W.cands[W.choice];
        const sy = W.candSyls[W.choice];
        if (!sy.length) continue;
        const seg = segmentLetters(W.text.toLowerCase(), sy.length);
        const bare = W.text.toLowerCase().replace(/[’‘`]/g, "'").replace(/^'+|'+$/g, '');
        W.key = bare;
        sy.forEach((s, k) => {
          Object.assign(s, {
            id: all.length, line: L.n, lineIndex: L.index, section: L.section, pos: L.syls.length, word: W, wi: k, nSyl: sy.length,
            cs: W.s + seg[k][0], ce: W.s + seg[k][1]
          });
          s.stop = sy.length === 1 && STOP.has(bare) && !W.full;
          if (W.full) s.full = normVowel(prep(syllabify(parsePhones(W.full))[0]));
          s.ipa = toIPA(s.arpabet);
          s.rhyme = rhymeKey(s, true);
          all.push(s); L.syls.push(s); W.syls.push(s);
        });
        W.ipa = wordIPA(W.syls);
        W.altIPA = W.ambiguous ? W.candSyls.filter((_, i) => i !== W.choice).map(wordIPA) : [];
      }
    }
    const body = lines.filter(L => L.n >= 0 && L.syls.length);
    body.forEach(L => {
      let stressed = null;
      L.syls.forEach((s, i) => {
        s.lineFinal = i === L.syls.length - 1;
        const fullFinal = s.stress === 0 && !s.reduced && s.wi === s.nSyl - 1 && s.nSyl > 1;
        s.eligible = s.lineFinal || (s.stress > 0 && !s.stop) || fullFinal;
        s.lead = stressed; // the nearest stressed syllable before it on the line
        if (s.stress > 0) stressed = s;
      });
    });

    const sameWord = (a, b) => a.word.key === b.word.key && a.wi === b.wi;
    const tierOf = (a, b) => (!opt.identical && sameWord(a, b)) ? NONE : matchTier(a, b);
    const links = [];
    const link = (a, b, t) => links.push({ a, b, t });
    const span = opt.reach - 1; // max line distance

    // 2. single-syllable rhymes inside the reach window (and inside one section)
    const elig = all.filter(s => s.eligible);
    for (let i = 0; i < elig.length; i++) {
      for (let j = i + 1; j < elig.length; j++) {
        const a = elig[i], b = elig[j];
        if (b.line - a.line > span || b.section !== a.section) break;
        if (a.word === b.word) continue;
        const t = tierOf(a, b);
        if (t > opt.tier || t === WEAK) continue;
        // Two unstressed syllables rhyme only as part of something larger: the stressed syllables
        // before them share a vowel ("pock-et" / "cock it"), or they are the same syllable, onset
        // and all ("lov-er" / "o-ver"). "Taking" / "riding" don't rhyme (Condit-Schultz 2016), nor
        // do the schwas of "it" and "bot-tle".
        if (a.stress === 0 && b.stress === 0 && a.onset !== b.onset) {
          const u = a.lead && b.lead ? tierOf(a.lead, b.lead) : NONE;
          if (u > ASSONANCE) continue;
        }
        link(a, b, t);
      }
    }

    // 3. multisyllabic runs: aligned syllable sequences whose vowels match in order.
    //    Stressed positions must match at the chosen tier; two unstressed syllables may
    //    match weakly; one unstressed interior position may not match at all.
    const posOK = (a, b) => {
      const t = tierOf(a, b);
      if (a.stress > 0 || b.stress > 0) return t <= opt.tier ? t : NONE;
      return t <= opt.tier || t === WEAK ? t : NONE;
    };
    // Any syllable without primary stress may be the one skipped ("shad-ow" / "bat-tle").
    const isGap = (a, b) => a.stress !== 1 && b.stress !== 1;
    const runs = [];
    for (let x = 0; x < body.length; x++) {
      for (let y = x; y < body.length && body[y].n - body[x].n <= span && body[y].section === body[x].section; y++) {
        const SA = body[x].syls, SB = body[y].syls;
        for (let i = 0; i < SA.length; i++) {
          for (let j = x === y ? i + 1 : 0; j < SB.length; j++) {
            if (posOK(SA[i], SB[j]) === NONE) continue;
            if (i > 0 && j > 0 && posOK(SA[i - 1], SB[j - 1]) !== NONE && (x !== y || i - 1 + 1 < j)) continue;
            const tiers = [];
            let gaps = 0;
            for (let k = 0; i + k < SA.length && j + k < SB.length && (x !== y || i + k < j); k++) {
              const t = posOK(SA[i + k], SB[j + k]);
              if (t !== NONE) { tiers.push(t); continue; }
              if (gaps === 0 && k > 0 && isGap(SA[i + k], SB[j + k]) && tiers[k - 1] !== null) { tiers.push(null); gaps++; continue; }
              break;
            }
            while (tiers.length && tiers[tiers.length - 1] === null) tiers.pop();
            let s0 = 0;
            const head = k => {
              const p = SA[i + k], q = SB[j + k];
              return tiers[k] !== null && tiers[k] <= opt.tier && p.stress > 0 && q.stress > 0 && !p.stop && !q.stop;
            };
            while (s0 < tiers.length && !head(s0)) s0++;
            const T = tiers.slice(s0);
            if (T.length < 2) continue;
            const A = SA.slice(i + s0, i + s0 + T.length), B = SB.slice(j + s0, j + s0 + T.length);
            // A position carries the rhyme if a stressed vowel matches, or an unstressed
            // content syllable matches closely ("spin-nin'" / "grin-nin'"). Two schwas in
            // function words ("the" / "a") do not.
            const real = T.filter((t, k) => t !== null && t <= ASSONANCE &&
              (A[k].stress > 0 || B[k].stress > 0 || (t <= NEAR && !A[k].stop && !B[k].stop))).length;
            if (real < 2) continue;
            if (A.every((s, k) => sameWord(s, B[k]))) continue; // a repeated phrase is not a multi
            if (A[0].word === B[0].word) continue;
            runs.push({ a: A, b: B, tiers: T, len: T.length });
          }
        }
      }
    }
    // Aligned syllables of a run join the same group, except unstressed function-word
    // pairs ("in" / "and"): they stay inside the run's underline but are not coloured.
    const colourable = (a, b) => !(a.stress === 0 && b.stress === 0 && (a.stop || b.stop));
    runs.forEach(r => r.a.forEach((s, k) => {
      if (r.tiers[k] !== null && colourable(s, r.b[k])) link(s, r.b[k], r.tiers[k]);
    }));

    // 4. groups. Links are applied closest tier first. A link may attach a syllable to a group,
    //    or join syllables with nothing closer, but never merges two groups that are each held
    //    together by a closer tier: near rhymes don't fuse two sets of perfect rhymes (peace /
    //    lease and keep / deep stay two colours), assonance doesn't fuse near ones. Merging on
    //    every link let one vowel chain from window to window and swallow a whole verse.
    const uf = new UF(all.length);
    const core = new Array(all.length).fill(Infinity); // by root: the closest tier linking the group
    const gap = l => Math.abs(l.a.line - l.b.line);
    links.sort((p, q) => p.t - q.t || gap(p) - gap(q) || p.a.id - q.a.id || p.b.id - q.b.id);
    links.forEach(({ a, b, t }) => {
      const ra = uf.find(a.id), rb = uf.find(b.id);
      if (ra === rb) return;
      if (core[ra] < t && core[rb] < t) return;
      const c = Math.min(core[ra], core[rb], t);
      uf.union(ra, rb);
      core[uf.find(ra)] = c;
    });
    // A syllable's tier and partner come from its best link inside its own group.
    const best = new Array(all.length).fill(NONE);
    const partner = new Array(all.length).fill(null);
    const score = new Array(all.length).fill(Infinity);
    links.forEach(({ a, b, t }) => {
      if (uf.find(a.id) !== uf.find(b.id)) return;
      const sa = t * 10 + (b.stress > 0 ? 0 : 3) + (b.word === a.word ? 5 : 0);
      const sb = t * 10 + (a.stress > 0 ? 0 : 3) + (a.word === b.word ? 5 : 0);
      if (t < best[a.id]) best[a.id] = t;
      if (t < best[b.id]) best[b.id] = t;
      if (sa < score[a.id]) { score[a.id] = sa; partner[a.id] = b.id; }
      if (sb < score[b.id]) { score[b.id] = sb; partner[b.id] = a.id; }
    });
    const comps = new Map();
    all.forEach(s => {
      if (best[s.id] === NONE) return;
      const r = uf.find(s.id);
      if (!comps.has(r)) comps.set(r, []);
      comps.get(r).push(s);
    });
    const groups = [];
    const groupOf = new Map();
    [...comps.values()].filter(m => m.length >= 2).sort((p, q) => p[0].id - q[0].id).forEach(members => {
      const g = { id: groups.length, members, color: 0 };
      const full = new Map(), vow = new Map();
      members.forEach(s => {
        const k = rhymeKey(s, true), v = rhymeKey(s, false);
        full.set(k, (full.get(k) || 0) + 1);
        vow.set(v, (vow.get(v) || 0) + 1);
      });
      const top = [...full.entries()].sort((p, q) => q[1] - p[1])[0];
      // Named by the rhyme part most members share; with no majority, by the vowel alone.
      g.key = top[1] > 0.5 * members.length ? top[0] : [...vow.entries()].sort((p, q) => q[1] - p[1])[0][0];
      // Stress mark by what most members are (ˈ stressed, ˌ secondary, none unstressed), so the
      // stressed spin / grin (/ˈɪn/) and the unstressed -nin' / -nin' (/ɪn/) read differently.
      const lv = [0, 0, 0];
      members.forEach(s => { lv[s.stress] = (lv[s.stress] || 0) + 1; });
      const stress = lv[1] >= lv[2] && lv[1] >= lv[0] ? 1 : lv[2] >= lv[0] ? 2 : 0;
      g.key = ['', 'ˈ', 'ˌ'][stress] + g.key;
      g.tier = Math.min(...members.map(s => best[s.id]));
      g.firstLine = Math.min(...members.map(s => s.line));
      g.lastLine = Math.max(...members.map(s => s.line));
      g.words = [...new Set(members.map(s => s.word.text.toLowerCase().replace(/[,.!?;:]+$/, '')))];
      members.forEach(s => {
        groupOf.set(s.id, g);
        s.group = g.id;
        s.tier = best[s.id];
        s.soft = best[s.id] >= ASSONANCE;
        s.partner = partner[s.id];
      });
      groups.push(g);
    });

    // colours: avoid the colours of groups that share lines within the reach window
    groups.forEach(g => {
      const near = groups.filter(o => o.id < g.id && o.lastLine >= g.firstLine - span && o.firstLine <= g.lastLine + span);
      const used = new Map();
      near.forEach(o => used.set(o.color, (used.get(o.color) || 0) + 1));
      const order = COLOR_ORDER.filter(c => c < opt.paletteSize);
      g.color = order.find(c => !used.has(c));
      if (g.color === undefined) g.color = order.slice().sort((p, q) => (used.get(p) || 0) - (used.get(q) || 0))[0];
    });

    // 5. multis -> spans (one per distinct syllable range), families and underline lanes
    const spanMap = new Map();
    const spanOf = syls => {
      const k = syls[0].id + ':' + syls.length;
      if (!spanMap.has(k)) spanMap.set(k, { syls, first: syls[0].id, last: syls[syls.length - 1].id, line: syls[0].line, len: syls.length });
      return spanMap.get(k);
    };
    runs.forEach(r => { r.sa = spanOf(r.a); r.sb = spanOf(r.b); });
    const spansAll = [...spanMap.values()].sort((p, q) => q.len - p.len || p.first - q.first);
    const kept = [];
    spansAll.forEach(sp => {
      const host = kept.find(k => k.first <= sp.first && k.last >= sp.last);
      sp.host = host || sp;
      if (!host) kept.push(sp);
    });
    kept.forEach((k, i) => { k.idx = i; });
    const fuf = new UF(kept.length);
    runs.forEach(r => fuf.union(r.sa.host.idx, r.sb.host.idx));
    kept.sort((p, q) => p.first - q.first);
    // A pattern repeated back to back ("cold steel, gold wheels, roll deals") produces
    // overlapping spans of one family; draw them as a single chain.
    for (let i = 0; i < kept.length; i++) {
      for (let j = i + 1; j < kept.length; j++) {
        const a = kept[i], b = kept[j];
        if (!a || !b || a.line !== b.line || fuf.find(a.idx) !== fuf.find(b.idx) || b.first > a.last + 1) continue;
        const L = lines.find(l => l.n === a.line);
        const last = Math.max(a.last, b.last);
        a.syls = L.syls.filter(s => s.id >= a.first && s.id <= last);
        a.last = last; a.len = a.syls.length;
        kept.splice(j, 1); j = i;
      }
    }
    const famColor = new Map();
    kept.forEach(k => {
      k.family = fuf.find(k.idx);
      if (!famColor.has(k.family)) {
        const anchor = k.syls.find(s => s.stress > 0 && groupOf.has(s.id)) || k.syls.find(s => groupOf.has(s.id));
        famColor.set(k.family, anchor ? groupOf.get(anchor.id).color : 0);
      }
      k.color = famColor.get(k.family);
      k.text = textOf(lines, k.syls);
      k.words = wordsOf(lines, k.syls);
    });
    const byLine = new Map();
    kept.forEach(k => {
      const arr = byLine.get(k.line) || [];
      let lane = 0;
      while (arr.some(o => o.lane === lane && !(o.last < k.first || o.first > k.last))) lane++;
      k.lane = lane;
      k.hidden = lane >= opt.maxLanes;
      arr.push(k); byLine.set(k.line, arr);
    });
    const families = new Map();
    kept.forEach(k => { if (!families.has(k.family)) families.set(k.family, []); families.get(k.family).push(k); });
    const runLen = new Map();
    runs.forEach(r => { const f = fuf.find(r.sa.host.idx); runLen.set(f, Math.max(runLen.get(f) || 0, r.len)); });
    const multis = [...families.values()].map((spans, i) => ({
      id: i, spans, color: spans[0].color, len: runLen.get(spans[0].family) || Math.max(...spans.map(s => s.len)),
      family: spans[0].family
    })).sort((p, q) => q.len - p.len || p.spans[0].first - q.spans[0].first);

    // 6. end-rhyme scheme letters
    // Letters restart at A in each section, since no rhyme crosses one.
    let letters = new Map(), sec = null;
    body.forEach(L => {
      if (L.section !== sec) { sec = L.section; letters = new Map(); }
      const last = L.syls[L.syls.length - 1];
      const g = groupOf.get(last.id);
      if (!g) { L.scheme = 'x'; return; }
      if (!letters.has(g.id)) letters.set(g.id, String.fromCharCode(65 + (letters.size % 26)));
      L.scheme = letters.get(g.id);
      L.schemeColor = g.color;
    });

    // 7. statistics
    const rhyming = all.filter(s => groupOf.has(s.id)).length;
    const longest = runs.reduce((m, r) => (!m || r.len > m.len ? r : m), null);
    return {
      lines, syllables: all, groups, multis, spans: kept, runs, longestRun: longest,
      options: opt,
      stats: {
        syllables: all.length,
        rhyming,
        share: all.length ? rhyming / all.length : 0,
        groups: groups.length,
        longest: longest ? { len: longest.len, a: wordsOf(lines, longest.a), b: wordsOf(lines, longest.b), aId: longest.a[0].id, bId: longest.b[0].id } : null,
        guessed: lines.reduce((n, L) => n + L.words.filter(w => w.src === 'guess').length, 0)
      }
    };
  }

  /** The whole words a run touches, for listing it in readable form. */
  function wordsOf(lines, syls) {
    const a = syls[0], b = syls[syls.length - 1];
    return lines[a.lineIndex].raw.slice(a.word.s, b.word.e);
  }

  function textOf(lines, syls) {
    const a = syls[0], b = syls[syls.length - 1];
    return lines[a.lineIndex].raw.slice(a.cs, b.ce);
  }

  const api = {
    setDictionary, pronounce, toIPA, syllabify, parsePhones, segmentLetters, matchTier, codaTier,
    analyse, guessPhones, rhymeKey,
    TIERS: { PERFECT, NEAR, ASSONANCE, WEAK, NONE }, TIER_NAMES, DEFAULTS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RhymeEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
