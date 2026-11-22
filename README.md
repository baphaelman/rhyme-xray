# Rhyme X-ray

Paste a rap verse or any lyric and see its rhymes coloured syllable by syllable, the way
"rap rhymes deconstructed" videos mark them up. It finds what spelling-based end-rhyme
checkers miss: multisyllabic rhymes, internal rhymes in the middle of a line, and slant
rhymes (same vowel, different consonants).

![Rhyme X-ray](docs/screenshot.png)

**Try it:** <https://baphaelman.github.io/rhyme-xray/>

The page opens on an MF DOOM bar ("A little grease always keeps the wheels a-spinnin' /
Like sitting on twenty threes to get the squealers grinnin'"). Its four-syllable rhyme
"wheels a-spinnin'" ↔ "squealers grinnin'" is exactly what spelling-based checkers miss.

## Run it

Open `index.html` in a browser. There is no build step.

The first load downloads the CMU Pronouncing Dictionary (about 4.7 MB) from jsDelivr
(`cmu-pronouncing-dictionary@3.0.0`), so you need a connection. If the download fails,
every word is guessed from its spelling instead and results get rougher.

## Use it

- **Find a song**: type a title and artist, pick a match, and the lyrics load and get
  X-rayed. Lyrics come from [LRCLIB](https://lrclib.net), a free community lyrics database.
  The page fetches them in your browser; nothing is stored in this repo.
- **Edit text** to paste your own verse, then **X-ray it** (or press Ctrl/⌘+Enter).
  Lines such as `[Chorus]` become section headings and are not analysed.
- Hover or tap a syllable. A card shows the word and syllable in IPA, its rhyme part, what
  it rhymes with (and on which line), the match type, and where the pronunciation came from.
- Click a rhyme group, a multisyllabic rhyme, an end-rhyme letter in the margin or the
  longest-rhyme reading to isolate it and scroll to it. Click again to step to the next
  occurrence. Press Esc to clear.
- **What counts as a rhyme** sets the loosest match allowed: Perfect, Near or Assonance.
- **A word rhymes with itself** decides whether repeating a word counts as a rhyme.
- **Reach** sets how many lines apart two syllables may be and still count as rhyming.
- **Examples → Rhyme types, one per line** gives one line per type. Each line explains its
  type, and the type word rhymes in exactly that type ("Near: the coda grew a beard").
  Every other stressed vowel appears only once, so no rhyme crosses lines.

Reading the colours:

| Mark | Meaning |
| --- | --- |
| Solid fill | perfect or near rhyme with another syllable of the same colour |
| Light fill | linked by vowel only (assonance) |
| Underline | a multisyllabic run; matching runs share the underline colour |
| Dotted underline | a word not in the dictionary; its sounds were guessed from the spelling |
| Letter in the margin | the end-rhyme scheme (A, B, …; `x` = the line ending does not rhyme) |

## How it decides

1. **Sounds, not spelling.** Each word is looked up in the CMU dictionary. Before falling
   back to a spelling guess, lyric spellings are normalised. "spinnin'" is read as
   "spinning" with the g dropped. "tha", "'em", "ya", "imma" and "tryna" are mapped.
   Plurals, -ed, -ing, -er, -ers, -y and -ly are built from their base words. Numbers
   become words.
2. **Syllables.** Phonemes are split into syllables. A syllable's *rhyme part* is its vowel
   plus every consonant up to the next vowel. A consonant between vowels counts for both
   syllables, which is how "squeal-ers" rhymes with "wheels".
3. **Tiers** (Pattison's taxonomy):
   - *Perfect*: same vowel and the same consonants (grease / peace).
   - *Near*: same vowel, and consonants from the same family (stops, fricatives, nasals,
     voicing ignored), or one extra consonant (wheels / squealers, grease / threes, time / line).
   - *Assonance*: same vowel only (sit / spin).
   - The cot/caught vowels are merged. Unstressed /ə/ and /ɪ/ count as one schwa.
4. **Who is compared on their own.** Stressed syllables of content words, the last
   syllable of every line, and full unstressed endings like the -y of "sweaty".
   Unstressed function words ("the", "a", "in") are only coloured inside a multi.
5. **Multisyllabic rhymes.** Two runs of syllables match in order, starting on a stressed
   syllable on both sides. Stressed positions must match at the chosen tier. Unstressed
   schwas may stand in for each other. One syllable without primary stress may break the
   pattern in the middle (shadow boxing / battle rocking). A run needs at least two
   positions that carry the rhyme. A run that only repeats the same words is ignored.
   Overlapping runs of one pattern on a line are drawn as a single chained underline.
6. **Groups and colours.** Every link (single or inside a multi) joins a group. Groups
   that sit within reach of each other get different colours from a 14-colour palette.
7. **Readings.** Share of syllables that rhyme, number of groups, the longest
   multisyllabic rhyme, and Raplyzer's rhyme density.

## Where the sources agree, and where they don't

I compared published ways of finding and colour-coding rap rhymes before setting the
rules. The tests in `test/engine.test.mjs` encode the points they agree on.

**They agree that:**

- **The stressed vowel carries the rhyme.** Malmi et al.'s Raplyzer / DopeLearning density
  uses *only* vowels. Wadsworth & Needle and the Vox / Martin Connor breakdowns treat
  assonance as rhyme. Hirjee & Brown and the WSJ *Hamilton* algorithm score vowels first.
- **Multisyllabic rhymes are matching vowel sequences across word boundaries** (Malmi's
  "longest matching vowel sequence"; Hirjee & Brown's phoneme alignment). They are shown
  as one unit: same colour per rhyme in Wadsworth & Needle, arcs in RapViz.
- **Stress matters** for deciding which syllables anchor a rhyme (WSJ, Hirjee & Brown).
  Unstressed syllables in the middle of a multi need not rhyme.

**They differ on:**

- **Consonants.** Raplyzer ignores them. Hirjee & Brown and the WSJ score the consonants
  after the vowel by similarity. Wadsworth & Needle's main rhyme class requires the
  final consonant. → exposed as the Perfect / Near / Assonance setting.
- **Identical words.** Wadsworth & Needle list "identical rhyme" as a rhyme type.
  Raplyzer's code returns 0 when the two words are the same (`lyrics.py`,
  `rhyme_length_fixed`). → exposed as the "A word rhymes with itself" switch (on by
  default, since repetition is often deliberate).
- **Distance.** Raplyzer looks back 10 words. Wadsworth & Needle allow rhymes more than a
  bar apart. → exposed as Reach (default 4 lines).

### Sources

- E. Malmi, P. Takala, H. Toivonen, T. Raiko, A. Gionis, "DopeLearning: A Computational
  Approach to Rap Lyrics Generation", KDD 2016, <https://arxiv.org/abs/1505.04771>, and the
  Raplyzer source, <https://github.com/ekQ/raplysaattori>. Rhyme density across 94 artists ranges
  from 0.870 to 1.187.
- H. Hirjee, D. G. Brown, "Using Automated Rhyme Detection to Characterize Rhyming Style in
  Rap Music", *Empirical Musicology Review* 5(4), 2010. Also "Automatic Detection of
  Internal and Imperfect Rhymes in Rap Lyrics", ISMIR 2009.
- D. G. Brown, R. Hutchinson, C. E. Lamb, "A systematic mapping review of algorithms for
  the detection of rhymes". It summarises the WSJ *Hamilton* work by Hinton & Eastwood.
- B. K. Wadsworth, S. Needle, "Rhyme, Metrical Tension, and Formal Ambiguity in Kendrick
  Lamar's Flow", *Intégral*, <https://theory.esm.rochester.edu/integral/?p=6643>.
- P. Pattison, *Writing Better Lyrics* (perfect, family, additive / subtractive and
  assonance rhymes).
- Vox Earworm with Martin Connor, syllable-by-syllable breakdowns of rap rhyme schemes.

## Known limits

- One pronunciation per word: the dictionary's first entry. Rappers bend vowels ("orange"
  / "door hinge") and the tool only catches it when the dictionary agrees.
- The letter-to-syllable mapping is a heuristic. Words with silent letters or syllabic
  consonants can split oddly ("diddly" → did·dl·y).
- With Assonance on, a dense verse can colour 70% or more of its syllables. That matches
  vowel-based breakdowns, but stray links between common vowels do appear. Switch to Near
  for a stricter view.
- Spelling guesses are crude: they only cover what the normalisation rules miss.
- Over a whole song, groups chain from window to window, so one vowel can form a large
  group. The group list shows each group's line range.
- Song search depends on LRCLIB's coverage and transcriptions.

## Develop

```sh
npm install   # fetches the dictionary for the tests
npm test
```

- `engine.js`: all analysis. Pure functions, no DOM. Loaded as a classic script by the
  page and with `require()` by the tests.
- `index.html`: the interface (inline CSS and UI script).
- `test/engine.test.mjs`: unit tests, consensus tests and the identical-rhyme switch.
