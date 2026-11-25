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

  test('object pronouns take their weak form', () => {
    assert.equal(E.pronounce('it').ph, 'IH0 T');
    assert.equal(E.toIPA(E.pronounce('them').ph), 'ðəm');
    assert.equal(E.toIPA(E.pronounce('us').ph), 'əs');
    assert.equal(E.pronounce('the').ph, 'DH AH0'); // other function words are untouched
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

describe('choosing between dictionary readings', () => {
  const reading = (text, word, nth = 0) => {
    const ws = E.analyse(text).lines.flatMap(l => l.words).filter(w => w.key === word);
    return ws[nth].ipa;
  };
  test('stress-shift words follow grammar', () => {
    assert.equal(reading('I want to record a record', 'record', 0), 'ɹə.ˈkɔɹd');
    assert.equal(reading('I want to record a record', 'record', 1), 'ˈɹɛ.kɚd');
    assert.equal(reading("it's perfect, I will perfect it", 'perfect', 0), 'ˈpɝ.fɪkt');
    assert.equal(reading("it's perfect, I will perfect it", 'perfect', 1), 'pɚ.ˈfɛkt');
    assert.equal(reading('the desert sand, I desert the band', 'desert', 1), 'dɪ.ˈzɝt');
  });
  test('with no cue, the noun/adjective stress is used', () => {
    assert.equal(reading('Perfect: a tail shared by surf and turf', 'perfect'), 'ˈpɝ.fɪkt');
  });
  test('vowel-change pairs follow grammar', () => {
    assert.equal(reading('I live my life on a live show', 'live', 0), 'lɪv');
    assert.equal(reading('I live my life on a live show', 'live', 1), 'laɪv');
    assert.equal(reading('the lead singer will lead us', 'lead', 0), 'lɛd');
    assert.equal(reading('the lead singer will lead us', 'lead', 1), 'lid');
  });
  test('rhyme decides what grammar cannot', () => {
    assert.equal(reading('I read it every week\nthe answers that I seek', 'read'), 'ɹid');
    assert.equal(reading('I read it in my bed', 'read'), 'ɹɛd');
    assert.equal(reading('I do it again\nand feel the pain', 'again'), 'ə.ˈɡeɪn');
  });
  test('accent variants never flip, even when they would rhyme', () => {
    assert.equal(reading("A little grease always keeps the wheels a-spinnin'\nLike sitting on twenty threes to get the squealers grinnin'", 'get'), 'ɡɛt');
  });
  test('function words keep their usual reading', () => {
    assert.equal(reading('a day in the sun', 'a'), 'ə');
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
  test('cot and caught merge, but not before r (door / car)', () => {
    assert.ok(sameGroup(E.analyse('I got taught\nit was hot', { tier: PERFECT }), 'taught', 'hot')); // /ɔ/ and /ɑ/ in the dictionary
    assert.ok(!sameGroup(E.analyse('I knocked on the door\nI drove the car', { tier: ASSONANCE }), 'door', 'car'));
    assert.ok(sameGroup(E.analyse('I knocked on the door\nI need some more', { tier: PERFECT }), 'door', 'more'));
  });
  test('marry and merry rhyme, as in most American accents', () => {
    assert.ok(sameGroup(E.analyse('it was hard to carry\nand the night was scary', { tier: PERFECT }), 'carry', 'scary'));
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

describe('the end of the bar', () => {
  const words = (A, n) => A.lines[n].words.map(w => (w.adlib ? `[${w.text}]` : w.text)).join(' ');
  test('a trailing ad-lib is not the end of the bar', () => {
    const A = E.analyse("Rap snitches, telling all their business\nSit in the court and be their own star witness\nDo you see the perpetrator? Yeah, I'm right here\nFuck around, get the whole label sent up for years, uh");
    assert.equal(A.lines.map(l => l.scheme).join(''), 'AABB');
    assert.ok(sameGroup(A, 'here', 'years'));
    const uh = A.lines[3].words.find(w => w.text === 'uh');
    assert.equal(uh.adlib, 'filler');
    assert.equal(uh.syls.length, 0);
    assert.ok(!A.lines[2].words.find(w => w.text === 'Yeah').adlib); // mid-line, part of the bar
  });
  test('interjections are ad-libs only when set off at a line edge', () => {
    const A = E.analyse("Uh, yeah, I'm back\nI said yeah\nOh my god\nYeah yeah, oh my god, for real, yeah\nI'm the man, uh, for real");
    assert.equal(words(A, 0), "[Uh] [yeah] I'm back");
    assert.equal(words(A, 1), 'I said yeah');
    assert.equal(words(A, 2), 'Oh my god');
    assert.equal(words(A, 3), '[Yeah] [yeah] oh my god for real [yeah]');
    assert.equal(words(A, 4), "I'm the man [uh] for real"); // hesitations anywhere
  });
  test('words in parentheses are backing vocals, not the bar', () => {
    const A = E.analyse("Started from the bottom now we're here (now we're here)\nI keep it near (skrrt)", { tier: PERFECT });
    assert.equal(words(A, 0), "Started from the bottom now we're here [now] [we're] [here]");
    assert.equal(A.lines[1].syls.at(-1).word.text, 'near');
    assert.equal(A.lines.map(l => l.scheme).join(''), 'AA');
  });
  test('the dictionary\'s two spellings of the vowel before r rhyme perfectly', () => {
    assert.ok(sameGroup(E.analyse("I'm right here\nthe end is near", { tier: PERFECT }), 'here', 'near'));
    assert.ok(sameGroup(E.analyse('I am poor\nI went on tour', { tier: PERFECT }), 'poor', 'tour'));
  });
});

// Byron's Don Juan (1819–24, public domain) is in ottava rima, ABABABCC, so the form says which
// line endings rhyme. Byron is famous for rhyming a word with a word plus an unstressed pronoun
// ("a poet" / "to show it"), the way rappers do. Stanzas are cited by canto and number.
describe('trusted source: rhymes the ottava rima of Don Juan requires', () => {
  const stanza = lines => E.analyse(lines.join('\n'), { tier: NEAR, reach: 5 });
  const endsRhyme = (A, i, j) => {
    const a = A.lines[i].syls.at(-1), b = A.lines[j].syls.at(-1);
    return a.group != null && a.group === b.group;
  };
  const MOSAIC = {
    'III.78': ['And now they were diverted by their suite,', 'Dwarfs, dancing girls, black eunuchs, and a poet,',
      'Which made their new establishment complete;', 'The last was of great fame, and liked to show it:',
      'His verses rarely wanted their due feet;', 'And for his theme—he seldom sung below it,',
      'He being paid to satirize or flatter,', 'As the psalm says, ‘inditing a good matter.’'],
    'III.13': ['Yet they were happy,—happy in the illicit', 'Indulgence of their innocent desires;',
      'But more imprudent grown with every visit,', 'Haidee forgot the island was her sire’s;',
      'When we have what we like, ’tis hard to miss it,', 'At least in the beginning, ere one tires;',
      'Thus she came often, not a moment losing,', 'Whilst her piratical papa was cruising.'],
    'V.41': ['Here their conductor tapping at the wicket', 'Of a small iron door, ’twas open’d, and',
      'He led them onward, first through a low thicket', 'Flank’d by large groves, which tower’d on either hand:',
      'They almost lost their way, and had to pick it—', 'For night was closing ere they came to land.',
      'The eunuch made a sign to those on board,', 'Who row’d off, leaving them without a word.'],
    'I.98': ['This may seem strange, but yet ’tis very common;', 'For instance—gentlemen, whose ladies take',
      'Leave to o’erstep the written rights of woman,', 'And break the—Which commandment is ’t they break?',
      '(I have forgot the number, and think no man', 'Should rashly quote, for fear of a mistake.)',
      'I say, when these same gentlemen are jealous,', 'They make some blunder, which their ladies tell us.'],
    'V.79': ['One difficulty still remain’d—his hair', 'Was hardly long enough; but Baba found',
      'So many false long tresses all to spare,', 'That soon his head was most completely crown’d,',
      'After the manner then in fashion there;', 'And this addition with such gems was bound',
      'As suited the ensemble of his toilet,', 'While Baba made him comb his head and oil it.']
  };
  test('an unstressed pronoun rhymes as the end of the word before it', () => {
    const want = { 'III.78': [[1, 3], [3, 5]], 'III.13': [[0, 2], [2, 4]], 'V.41': [[0, 2], [2, 4]], 'I.98': [[6, 7]], 'V.79': [[6, 7]] };
    for (const [id, pairs] of Object.entries(want)) {
      const A = stanza(MOSAIC[id]);
      for (const [i, j] of pairs) assert.ok(endsRhyme(A, i, j), `${id}: lines ${i + 1} and ${j + 1}`);
    }
  });
  test('and the pair is one multisyllabic rhyme: toilet / oil it', () => {
    const A = stanza(MOSAIC['V.79']);
    assert.ok(A.spans.some(s => s.text === 'oil it'), A.spans.map(s => s.text).join(', '));
  });
  test('two unstressed endings rhyme as a whole: same syllable, or stressed vowels that match', () => {
    // I.100: "lov-er" / "o-ver" share the whole unstressed syllable, though not the stressed vowel
    const A = stanza(['Thus parents also are at times short-sighted;', 'Though watchful as the lynx, they ne’er discover,',
      'The while the wicked world beholds delighted,', 'Young Hopeful’s mistress, or Miss Fanny’s lover,',
      'Till some confounded escapade has blighted', 'The plan of twenty years, and all is over;']);
    assert.ok(endsRhyme(A, 1, 3) && endsRhyme(A, 3, 5));
    // a schwa and nothing else in common is no rhyme
    const B = E.analyse('I held up the bottle\nyou never could get it', { tier: ASSONANCE });
    assert.equal(B.lines.map(l => l.scheme).join(''), 'xx');
  });
  // Condit-Schultz (MCFlow's author), dissertation p. 55: "rhymes do not occur between (isolated)
  // unstressed syllables. For example, the words /taking : riding/ don't rhyme".
  test('taking / riding do not rhyme', () => {
    assert.equal(E.analyse('I was taking\nI was riding', { tier: PERFECT }).lines.map(l => l.scheme).join(''), 'xx');
  });
  test('a pronoun keeps its full vowel for a stressed rhyme', () => {
    const swim = ['As for the other two, they could not swim,', 'So nobody arrived on shore but him.'];   // II.106
    const gem = ['Two villainous Cossacques pursued the child', 'With flashing eyes and weapons: match’d with them,',
      'The rudest brute that roams Siberia’s wild', 'Has feelings pure and polish’d as a gem,—',
      'The bear is civilised, the wolf is mild;', 'And whom for this at last must we condemn?'];             // VIII.92, lines 1–6
    assert.ok(endsRhyme(stanza(swim), 0, 1));
    assert.ok(endsRhyme(stanza(gem), 1, 3) && endsRhyme(stanza(gem), 3, 5));
    const A = E.analyse('She could not from the spot, and the loud roar\nGrew, and each wave rose roughly, threatening her;\nAnd o’er her upper lip they seem’d to pour,\nUntil she sobb’d for breath, and soon they were', { tier: PERFECT }); // IV.31, lines 3–6
    assert.ok(endsRhyme(A, 1, 3), 'her / were');
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
  test('section labels are headings, not lyrics', () => {
    const A = E.analyse('[Verse 1]\nI keep the peace\nI hold the lease', { tier: PERFECT, reach: 2 });
    assert.ok(A.lines[0].heading);
    assert.equal(A.lines[0].words.length, 0);
    assert.ok(sameGroup(A, 'peace', 'lease'));
  });
  test('a heading or blank line starts a new section: no rhyme crosses it, letters restart', () => {
    for (const sep of ['[Chorus]', '', '\n']) {
      const A = E.analyse(`I keep the peace\nI hold the lease\n${sep}\nI found my niece\nthe wool of fleece`, { tier: PERFECT });
      assert.ok(sameGroup(A, 'peace', 'lease'));
      assert.ok(!sameGroup(A, 'lease', 'niece'), JSON.stringify(sep));
      assert.equal(A.lines.filter(l => l.scheme).map(l => l.scheme).join(''), 'AAAA');
    }
  });
  test('a looser link never merges two groups that rhyme more closely on their own', () => {
    // sit / knit and spin / win are two perfect pairs sharing only a vowel.
    const A = E.analyse('I sit and knit\nI spin to win', { tier: ASSONANCE });
    assert.ok(sameGroup(A, 'sit', 'knit') && sameGroup(A, 'spin', 'win'));
    assert.ok(!sameGroup(A, 'sit', 'spin'));
    // peace / lease and keep / deep are perfect pairs, near to each other: still two groups.
    const B = E.analyse('I keep the peace\nI hold the lease\nI dig it deep', { tier: NEAR });
    assert.ok(!sameGroup(B, 'peace', 'keep'));
    // A syllable with only a vowel in common still joins one group, drawn lighter.
    const C = E.analyse('I sit and knit with a fish', { tier: ASSONANCE });
    assert.ok(sameGroup(C, 'sit', 'fish'));
    assert.ok(syl(C, 'fish').soft);
  });
  test('a group with no majority rhyme part is named by its vowel', () => {
    const A = E.analyse('I took my time\nI walked the line', { tier: NEAR });
    assert.ok(sameGroup(A, 'time', 'line'));
    assert.equal(A.groups[syl(A, 'time').group].key, 'ˈaɪ');
  });
  test('a group label marks stress, so stressed and unstressed /ɪn/ differ', () => {
    const A = E.analyse(SAMPLE);
    assert.equal(A.groups[syl(A, "spinnin'").group].key, 'ˈɪn');
    assert.equal(A.groups[syl(A, "spinnin'", 1).group].key, 'ɪn');
  });
  test('the rhyme-types example keeps every rhyme on its own line', () => {
    const text = 'Perfect: a tail shared by surf and turf\nNear: the coda grew a beard\nAssonance: vowels, not consonants: a pal in a cab\nMulti: it lines up in full with sultry';
    const A = E.analyse(text);
    A.groups.forEach(g => assert.equal(g.firstLine, g.lastLine, `group /${g.key}/ spans lines`));
    assert.equal(A.lines.map(l => l.scheme).join(''), 'ABCD');
    assert.equal(syl(A, 'turf').tier, PERFECT);
    assert.ok(sameGroup(A, 'perfect', 'surf')); // PER-fect, the adjective
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
