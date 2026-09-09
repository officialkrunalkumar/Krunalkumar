/* ==========================================================================
   lab-exams.js — the question bank for the five learning-path exams
   --------------------------------------------------------------------------
     node scripts/lab-exams.js            write assets/data/lab-exams.json
     node scripts/lab-exams.js --check    report what would change, write nothing

   WHY THE QUESTIONS ARE NOT WRITTEN HERE.

   A path exam needs questions about the labs in that path, and there were
   three ways to get them. Hand-writing a bank means ~60 questions that
   restate what the labs say, kept in a file nobody opens again, drifting the
   first time a lab changes its mind about something — the hand-kept changelog
   problem, with the added risk that a stale question marks a correct answer
   wrong. Generating plausible-looking questions from the glossary produces
   the kind of multiple choice that tests nothing. So neither.

   Every lab already carries its own FAQPage JSON-LD: 5 pairs each, written
   for readers, in the author's words, and already the thing the deploy checks
   for validity. Those ARE the comprehension questions — "Does this open or
   visit the link?", "Is https enough to trust a link?" — so the bank is
   harvested from them. A lab that changes its FAQ changes its exam question
   in the same commit, and nothing can drift.

   The extraction itself is borrowed from mayuri-index.js rather than
   reimplemented, so both files agree on what an answer says.

   WHY THE DISTRACTORS COME FROM OTHER LABS IN THE SAME PATH.

   Three wrong options per question have to come from somewhere. Same-lab
   answers would be the hardest, and were tried on paper first: two FAQs on
   one lab often circle the same fact, so a same-lab distractor can be
   arguably correct for the question above it. An exam that fails somebody for
   picking a true statement is worse than an easy one, and this is a keepsake,
   not an entrance test — so fairness wins. Answers from OTHER labs in the
   same path are on-topic enough to need reading, and never ambiguous, because
   they are about a different subject.

   The sampling is deliberately NOT done here. This file ships the whole pool
   per path; lab-paths.js draws the twelve questions and shuffles the options
   on every attempt, so a retry is a different paper and there is no fixed
   answer order to memorise.

   WHAT THIS FILE DOES NOT PRETEND TO BE. The bank ships to the browser, so
   the answers are readable by anyone who opens the network tab. That is not
   fixable on a static site with no backend, and the certificate says as much
   on its face. The exam is a check for the person taking it.
   ========================================================================== */

const fs = require('fs');
const path = require('path');
const { faqFrom, plainText } = require('./mayuri-index.js');

const ROOT = path.join(__dirname, '..');
const HUB = path.join(ROOT, 'labs', 'index.html');
const OUT = path.join(ROOT, 'assets', 'data', 'lab-exams.json');

/* Kept here and read by lab-paths.js from the file, so the two cannot
   disagree about what passing means. */
const ASK = 12;
const PASS = 10;

/* Answers run 78 to 525 characters, median 303. Four of those per question is
   most of a screen, and twelve questions of it is a reading test rather than
   an exam, so options are trimmed for display.

   160, and cut on a word boundary. Shorter was tried and is worse: a great
   many of these answers open with a bare "No." or "No, never." — the claim
   that distinguishes them is in the clause after it, so trimming to the first
   sentence produced four options that all read "No." and discriminated
   nothing. 160 reliably keeps that clause.

   The full answer is deliberately NOT shipped alongside the trimmed one. It
   would double the file for text nothing renders, and the grader only ever
   compares the option the visitor picked against the option marked correct. */
const OPTION_CHARS = 160;

function trim(s) {
  if (s.length <= OPTION_CHARS) return s;
  const cut = s.slice(0, OPTION_CHARS);
  const sp = cut.lastIndexOf(' ');
  return (sp > OPTION_CHARS * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:.\s]+$/, '') + '…';
}

/* The paths are defined by the hub markup, not by a list in this file: the
   <details data-path> blocks and their data-step links already are the
   definition, and a second copy here would be the thing that goes stale. */
function readPaths(html) {
  const out = [];
  const block = /<details class="lab-path" data-path="([a-z0-9-]+)">([\s\S]*?)<\/details>/g;
  let m;
  while ((m = block.exec(html))) {
    const key = m[1];
    const body = m[2];
    const name = (body.match(/class="lab-path-name">([^<]*)</) || [])[1];
    const steps = [...body.matchAll(/href="\/labs\/([a-z0-9-]+)"[^>]*\bdata-step\b/g)].map((s) => s[1]);
    out.push({ key: key, name: plainText(name || key), steps: steps });
  }
  return out;
}

function titleOf(html, slug) {
  const t = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || slug;
  /* Lab titles are "Thing — blurb | Krunalkumar Shah"; the exam only needs
     the thing, and it is shown to somebody being told which lab to revisit. */
  return plainText(t).split('|')[0].split('—')[0].replace(/\s*[-–]\s*$/, '').trim();
}

function buildExams(opts) {
  const options = opts || {};
  const check = !!options.check;
  const log = options.log || console.log;

  const hub = fs.readFileSync(HUB, 'utf8');
  const paths = readPaths(hub);
  if (!paths.length) throw new Error('lab-exams.js: no <details class="lab-path"> blocks in labs/index.html');

  const bank = { ask: ASK, pass: PASS, paths: {} };
  const thin = [];

  for (const p of paths) {
    const pool = [];
    const seen = new Set();
    for (const slug of p.steps) {
      const file = path.join(ROOT, 'labs', slug + '.html');
      if (!fs.existsSync(file)) throw new Error('lab-exams.js: path "' + p.key + '" lists /labs/' + slug + ', which does not exist');
      const html = fs.readFileSync(file, 'utf8');
      const title = titleOf(html, slug);
      for (const pair of faqFrom(html, '/labs/' + slug, title)) {
        /* One question per distinct question text. A duplicated question would
           let the same paper ask it twice. */
        const dedupe = pair.q.toLowerCase();
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        pool.push({ q: pair.q, a: trim(pair.a), lab: slug, title: title });
      }
    }

    /* Twelve questions need twelve distinct-lab answers to draw wrong options
       from, and a path whose pool is thin would hand the same distractor to
       several questions. Reported rather than thrown: it is a content gap to
       fix in the labs, and it does not make the file unusable. */
    const labsWithQuestions = new Set(pool.map((q) => q.lab)).size;
    if (pool.length < ASK + 3 || labsWithQuestions < 2) {
      thin.push(p.key + ' (' + pool.length + ' questions across ' + labsWithQuestions + ' labs)');
    }

    bank.paths[p.key] = {
      name: p.name,
      steps: p.steps.length,
      pool: pool
    };
  }

  /* Stable key order and no timestamp: the freshness gate compares content, so
     anything that changes on every run would make the file permanently dirty. */
  const json = JSON.stringify(bank, null, 1) + '\n';
  const had = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  const changed = had !== json;

  const counts = Object.entries(bank.paths)
    .map(([k, v]) => k + ':' + v.pool.length)
    .join('  ');
  log('lab path exams');
  log('  ' + paths.length + ' paths, ' + ASK + ' asked, ' + PASS + ' to pass   ' + counts);
  if (thin.length) {
    log('  THIN POOLS (fewer than ' + (ASK + 3) + ' questions): ' + thin.join(', '));
  }
  log('  ' + (changed
    ? (check ? 'would write ' : 'wrote ') + json.length + ' bytes'
    : 'already current, nothing to write'));

  if (!check && changed) fs.writeFileSync(OUT, json);
  return {
    paths: paths.length,
    questions: Object.values(bank.paths).reduce((a, v) => a + v.pool.length, 0),
    thin: thin,
    changed: changed,
    bytes: json.length
  };
}

module.exports = { buildExams, ASK, PASS };

if (require.main === module) {
  buildExams({ check: process.argv.includes('--check') });
}
