// Tests for the rhyme engine. Run with `npm test`.
//
// The "consensus" tests encode what published rhyme-coding methods agree on
// (see README.md, "Where the sources agree"). The "disagreement" test pins the
// one point they split on, which the UI exposes as a switch.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dictionary } from 'cmu-pronouncing-dictionary';

const require = createRequire(import.meta.url);
const E = require('../engine.js');
const { PERFECT, NEAR, ASSONANCE } = E.TIERS;

before(() => E.setDictionary(dictionary));

const SAMPLE = "A little grease always keeps the wheels a-spinnin'\nLike sitting on twenty threes to get the squealers grinnin'";

// helpers ---------------------------------------------------------------
const syl = (A, word, wi = 0) => {
  const s = A.syllables.find(x => x.word.text.toLowerCase().replace(/[^a-z']/g, '') === word && x.wi === wi);
  assert.ok(s, `syllable ${wi} of "${word}" not found`);
  return s;
};
const sameGroup = (A, w1, w2, i1 = 0, i2 = 0) => {
  const a = syl(A, w1, i1), b = syl(A, w2, i2);
  return a.group != null && a.group === b.group;
};
const coloured = (A, w, i = 0) => syl(A, w, i).group != null;
const codaOf = arpabet => {
  const s = E.syllabify(E.parsePhones(arpabet));
  return s[s.length - 1].rhymeCons;
};

describe('pronunciation', () => {
  test('ARPAbet converts to IPA', () => {
    assert.equal(E.toIPA('S P IH1 N'), 'spɪn');
    assert.equal(E.toIPA('DH AH0'), 'ðə');
    assert.equal(E.toIPA('W IY1 L Z'), 'wilz');
    assert.equal(E.toIPA('S K W IY1 L ER0 Z'), 'skwilɚz');
    assert.equal(E.toIPA('JH AH1 NG K SH AH0 N'), 'dʒʌŋkʃən');
  });

  test('dropped g reads as -ing with the g dropped', () => {
    const p = E.pronounce("spinnin'");
    assert.equal(p.src, 'norm');
    assert.equal(p.as, 'spinning');
    assert.equal(E.toIPA(p.ph), 'spɪnɪn');
    assert.equal(E.pronounce("finessin'").as, 'finessing');
  });

  test('common lyric spellings are normalised', () => {
    assert.equal(E.toIPA(E.pronounce("'em").ph), 'əm');
    assert.equal(E.toIPA(E.pronounce('tha').ph), 'ðə');
    assert.equal(E.pronounce('squealers').src, 'norm');
    assert.equal(E.pronounce('2020').as, 'twenty twenty');
  });

  test('unknown words fall back to a spelling guess', () => {
    const p = E.pronounce('glizzy');
    assert.equal(p.src, 'guess');
    assert.match(E.toIPA(p.ph), /^ɡlɪzi$/);
    assert.equal(E.toIPA(E.pronounce('skrrt').ph), 'skɝt');
  });

  test('syllables map back onto the right letters', () => {
    const cut = (w, n) => E.segmentLetters(w, n).map(([a, b]) => w.slice(a, b));
    assert.deepEqual(cut("spinnin'", 2), ['spin', "nin'"]);
    assert.deepEqual(cut('squealers', 2), ['squea', 'lers']);
    assert.deepEqual(cut('grease', 1), ['grease']);
    assert.deepEqual(cut('twenty', 2), ['twen', 'ty']);
    assert.deepEqual(cut('diddly', 3), ['did', 'dl', 'y']);
  });
});

describe('match tiers (Pattison taxonomy)', () => {
  test('same vowel and consonants is perfect', () => {
    assert.equal(E.codaTier(codaOf('G R IY1 S'), codaOf('P IY1 S')), PERFECT);
    assert.equal(E.codaTier(codaOf('S P IH1 N IH0 NG'), codaOf('G R IH1 N IH0 N')), PERFECT); // g-dropping
  });
  test('voicing, manner family and one added consonant are near', () => {
    assert.equal(E.codaTier(codaOf('G R IY1 S'), codaOf('TH R IY1 Z')), NEAR);     // s / z
    assert.equal(E.codaTier(codaOf('T AY1 M'), codaOf('L AY1 N')), NEAR);          // nasal family
    assert.equal(E.codaTier(codaOf('W IY1 L Z'), codaOf('S K W IY1 L')), NEAR);    // additive
  });
  test('unrelated consonants leave only assonance', () => {
    assert.equal(E.codaTier(codaOf('S IH1 T'), codaOf('S P IH1 N')), ASSONANCE);
    assert.equal(E.codaTier([], codaOf('W IY1 L Z')), ASSONANCE); // open vowel vs two consonants
  });
});

describe('consensus: what every method agrees on', () => {
  // Every source (Hirjee & Brown, WSJ, Wadsworth & Needle, Pattison) accepts a matching
  // stressed vowel with matching following consonants as a rhyme.
  test('perfect end rhymes group at every strictness', () => {
    for (const tier of [PERFECT, NEAR, ASSONANCE]) {
      const A = E.analyse('I keep the peace\nI hold the lease', { tier });
      assert.ok(sameGroup(A, 'peace', 'lease'), `tier ${tier}`);
    }
  });

  // Malmi et al. measure rhyme on vowels alone; Connor/Vox and Wadsworth & Needle treat
  // assonance as rhyme. Pattison classes it as the loosest rhyme type.
  test('assonance counts once the vowel-only tier is on', () => {
    const text = 'I sit in the corner\nI spin on the floor';
    assert.ok(!sameGroup(E.analyse(text, { tier: PERFECT }), 'sit', 'spin'));
    assert.ok(sameGroup(E.analyse(text, { tier: ASSONANCE }), 'sit', 'spin'));
  });

  // WSJ and Hirjee & Brown weigh stress; coders colour stressed syllables, not "the".
  test('unstressed function words are not coloured on their own', () => {
    const A = E.analyse('the cat is on the mat\nthe bat is in the hat', { tier: ASSONANCE });
    assert.ok(!coloured(A, 'the'));
    assert.ok(sameGroup(A, 'cat', 'hat'));
  });

  // Multisyllabic rhyme = matching vowel sequence (Malmi), shown as a unit (Vox, RapViz).
  test('multisyllabic rhyme spans words: wheels a-spinnin\' / squealers grinnin\'', () => {
    const A = E.analyse(SAMPLE, { tier: NEAR });
    assert.equal(A.stats.longest.len, 4);
    assert.equal(A.stats.longest.a, "wheels a-spinnin'");
    assert.equal(A.stats.longest.b, "squealers grinnin'");
    assert.ok(sameGroup(A, 'wheels', 'squealers'));
    assert.ok(sameGroup(A, "spinnin'", "grinnin'"));
    assert.ok(sameGroup(A, "spinnin'", "grinnin'", 1, 1));
  });

  test('perfect tier keeps only the exact part of that multi', () => {
    const A = E.analyse(SAMPLE, { tier: PERFECT });
    assert.equal(A.stats.longest.len, 2);
    assert.ok(!sameGroup(A, 'wheels', 'squealers'));
  });

  // "Unstressed syllables that aren't at the end don't need to rhyme."
  test('one unstressed interior syllable may break a multi', () => {
    const A = E.analyse('shadow boxing\nbattle rocking', { tier: ASSONANCE });
    assert.equal(A.stats.longest.len, 4);
    assert.ok(!sameGroup(A, 'shadow', 'battle', 1, 1)); // the gap is not coloured
  });

  test('rhymes beyond the reach window do not link', () => {
    const text = 'I keep the peace\none\ntwo\nthree\nfour\nI hold the lease';
    assert.ok(!sameGroup(E.analyse(text, { tier: PERFECT, reach: 4 }), 'peace', 'lease'));
    assert.ok(sameGroup(E.analyse(text, { tier: PERFECT, reach: 6 }), 'peace', 'lease'));
  });

  test('end-rhyme scheme letters follow line endings', () => {
    const A = E.analyse('I keep the peace\nI hold the lease\nI hit the time\nI paid the fine', { tier: NEAR });
    assert.equal(A.lines.map(l => l.scheme).join(''), 'AABB');
  });
});

describe('disagreement: does a word rhyme with itself?', () => {
  // Wadsworth & Needle count "identical rhyme"; Raplyzer scores identical words as 0.
  const refrain = 'I got the keys, I got the keys\nI got the keys, I got the keys';
  test('on: repetition is coloured as identical rhyme', () => {
    assert.ok(sameGroup(E.analyse(refrain, { identical: true }), 'keys', 'keys'));
  });
  test('off: repeated words never link', () => {
    assert.equal(E.analyse(refrain, { identical: false }).stats.groups, 0);
  });
});

describe('rhyme density (Raplyzer definition)', () => {
  test('identical words and one-vowel matches score zero', () => {
    assert.equal(E.analyse('keys keys keys keys').stats.density, 0);
    assert.equal(E.analyse('cat dog hat').stats.density, 0);
  });
  test('two-vowel matches raise density', () => {
    assert.ok(E.analyse('golden ticket, olden thicket').stats.density > 0.5);
  });
});

describe('presentation', () => {
  test('groups that share lines get different colours', () => {
    const A = E.analyse(SAMPLE);
    const near = A.groups.filter(g => g.firstLine <= 1);
    assert.equal(new Set(near.map(g => g.color)).size, near.length);
  });
  test('a repeated pattern on one line becomes one chained underline', () => {
    const A = E.analyse('Cold steel, gold wheels, roll deals in the low field\nOld feels, slow heals, I don\'t kneel and I won\'t yield');
    const line0 = A.spans.filter(s => s.line === 0 && s.syls.some(x => x.word.text === 'Cold'));
    assert.equal(line0.length, 1);
    assert.ok(line0[0].words.startsWith('Cold steel, gold wheels, roll deals'));
  });
  test('section labels are headings, not lyrics, and do not count toward reach', () => {
    const A = E.analyse('[Verse 1]\nI keep the peace\n[Chorus]\nI hold the lease', { tier: PERFECT, reach: 2 });
    assert.ok(A.lines[0].heading && A.lines[2].heading);
    assert.equal(A.lines[0].words.length, 0);
    assert.ok(sameGroup(A, 'peace', 'lease'));
  });
  test('the rhyme-types example keeps every rhyme on its own line', () => {
    const text = 'Perfect: the tail is correct\nNear: the coda grew a beard\nAssonance: vowels, not consonants: a pal in a cab\nMulti: words that line up, sultry';
    const A = E.analyse(text);
    A.groups.forEach(g => assert.equal(g.firstLine, g.lastLine, `group /${g.key}/ spans lines`));
    assert.equal(A.lines.map(l => l.scheme).join(''), 'ABCD');
    assert.equal(syl(A, 'correct', 1).tier, PERFECT);
    assert.equal(syl(A, 'beard').tier, NEAR);
    assert.equal(syl(A, 'pal').tier, ASSONANCE);
    assert.equal(A.stats.longest.a, 'Multi');
    assert.equal(A.stats.longest.b, 'sultry');
  });
  test('analysis is pure: same input, same output', () => {
    const a = E.analyse(SAMPLE), b = E.analyse(SAMPLE);
    assert.deepEqual(a.stats, b.stats);
  });
});
