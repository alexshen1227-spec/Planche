import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Claims the app must not make, enforced on every string it can show.
 *
 * `docs/research-ledger.md` keeps a list of claims that failed verification or
 * that the evidence does not support, and CLAUDE.md repeats the worst of them.
 * Review alone did not keep them out: on 2026-10-05 the tip of the day still
 * said "your biceps tendons take months", the Learn guide still said "strength
 * is built during recovery", and two coach day-reasons said a light day "turns
 * that into strength" — each refuted in writing elsewhere in the same repo.
 *
 * So this reads every string literal, template and JSX text in `src` with the
 * TypeScript parser (comments, which quote these claims on purpose, are not
 * read) and fails on a refuted claim. A sentence that negates the claim — "no
 * trial has shown a warm-up prevents injury" — is how the app is meant to talk
 * about it, so rules marked `unlessNegated` let those through.
 */

interface Rule {
  id: string
  pattern: RegExp
  /** Why the claim is out, pointing at where that was decided. */
  why: string
  /** Allow a sentence that explicitly denies or hedges the claim. */
  unlessNegated?: boolean
  /** A narrower exemption, for claims whose refutations also contain "not". */
  allowWhen?: RegExp
}

const RULES: Rule[] = [
  {
    id: 'tendon-lag',
    pattern: /\btendons?\b.{0,60}\b(slower|lag|lags|behind|months)\b|\btendons keep score\b/i,
    why: 'Ledger §must-not-claim 4: tendons lagging muscle by a fixed time is not supported (CLAUDE.md, measured #1).',
    unlessNegated: true,
  },
  {
    id: 'strength-in-recovery',
    pattern:
      /\binto strength\b|\bstrength (is built|lands|arrives|appears) (during|in) (recovery|rest|the deload)\b|\bstrength is (expressed|realised|realized) after recovery\b/i,
    why: 'CLAUDE.md, measured #2: do not reintroduce "strength lands during recovery".',
    // "Strength is built during recovery, not during the hard sessions" holds
    // a "not" too, so only an explicit "rather than claiming …" lets it pass.
    allowWhen: /\b(rather than|instead of|no longer)\b.{0,20}\bstrength (is built|lands|arrives|appears)\b/i,
  },
  {
    id: 'deload-proven',
    pattern: /\bdeloads?\b.{0,40}\b(proven|necessary|essential|required)\b/i,
    why: 'Ledger §must-not-claim 3: deloads are convention; the trials found no benefit.',
    unlessNegated: true,
    allowWhen: /\b(convention|rather than proven)\b/i,
  },
  {
    id: 'deload-skipping',
    pattern: /\bskipping (deloads|easy weeks)\b/i,
    why: 'Ledger §must-not-claim 3: nothing shows that skipping a deload slows progress.',
  },
  {
    id: 'warm-up-prevents-injury',
    pattern:
      /\b(warm[- ]?ups?|warming up|warm wrists|preparation|prehab|everything that follows)\b.{0,60}\b(prevents?|protects?|bulletproof|injury[- ]proof|long career|safer)\b|\bhow people end up taking\b/i,
    why: 'Ledger §must-not-claim 7: no trial shows warming up prevents injury in resistance training.',
    unlessNegated: true,
  },
  {
    id: 'injury-free-promise',
    pattern: /\b(stay|staying|keeps? you) injury[- ]free\b/i,
    why: 'No routine can promise this; the safety guide is about lowering risk and responding to pain.',
    unlessNegated: true,
  },
  {
    id: 'not-get-hurt',
    pattern: /\bhow not to get hurt\b/i,
    why: 'No routine can promise this; the safety guide is about lowering risk and responding to pain.',
  },
  {
    id: 'validated-hold-standard',
    pattern: /\b(unlock (bars?|targets?)|hold[- ]times?|the bars?) (are|is) (minimums?|validated|proven)\b|\b10[- ]second rule\b/i,
    why: 'Ledger §must-not-claim 1 and CLAUDE.md measured #5: no hold-time standard is validated.',
    unlessNegated: true,
  },
  {
    id: 'injury-prediction',
    pattern: /\b(predicts?|predicting|forecasts?)\b.{0,30}\binjur/i,
    why: 'Ledger §must-not-claim 5 and CLAUDE.md measured #3: load ratios may describe load, never predict injury.',
    unlessNegated: true,
  },
  {
    id: 'load-spike-injury',
    pattern: /\b(spikes?|load)\b.{0,60}\bjoints? (complain|get hurt|break down)\b/i,
    why: 'CLAUDE.md measured #3: a load ratio may describe load, never forecast joint trouble.',
    unlessNegated: true,
  },
  {
    id: 'habit-building',
    pattern: /\b(streaks?|badges?|achievements?)\b.{0,30}\b(builds?|forms?|creates?)\b.{0,20}\bhabits?\b/i,
    why: 'Ledger §must-not-claim 9: streaks and badges are not shown to build habits.',
    unlessNegated: true,
  },
  {
    id: 'ten-percent-rule',
    pattern: /\b10% (rule|a week)\b.{0,40}\b(safe|safety|prevents?)\b/i,
    why: 'Ledger §must-not-claim 6: the 10%-per-week rule failed its RCT.',
    unlessNegated: true,
  },
  {
    id: 'invented-figures',
    pattern:
      /#1 reason|\bnumber[- ]one reason\b|\bmost common (complaint|injury|reason)\b|\berase \d+%|\bby \d+% or more\b/i,
    why: 'There is no planche research to source a prevalence or effect size from; do not invent one.',
  },
  {
    id: 'speed-promises',
    pattern: /\b(next (one|step)|everything after (them|it)) arrives? faster\b|\bfastest way to (stall|progress|improve)\b|\bshortest path\b|\bsingle most (important|useful)\b|\bthe best dynamic\b/i,
    why: 'Progression-specific advice is CONSENSUS at best; it must not be phrased as a measured result.',
  },
  {
    id: 'camera-counts-reps',
    // The camera (or "it", of the camera) as the one counting — not an
    // instruction to the athlete to count their own reps on the replay.
    pattern: /\b(camera|judge|checker|model|app)\b[^.,;:]{0,30}\bcount(s|ed|ing)?\b.{0,30}\breps?\b|\bit counts\b.{0,20}\breps?\b/i,
    why: 'Ledger §13: no camera rep count exists — at three samples a second the judge cannot vouch for the bottom of a rep. The replay review is the evidence.',
    unlessNegated: true,
  },
  {
    id: 'no-research-absolute',
    pattern: /\b(there is|there's|there are) no (research|stud(y|ies)|evidence)\b|\bno research (covers|exists)\b|\b(has|have) never been studied\b/i,
    why: 'Ledger §13.10 rule 17 (and the 2026-10-05 audit): a search that found nothing is "none was found", never "there is no research".',
  },
  {
    id: 'research-shows',
    pattern: /\b(research|science|EMG|studies) (shows?|proves?|confirms?|says?)\b/i,
    why: 'Ledger §13.10 rule 17: no study of these holds or push-ups was found, so nothing may be introduced as what research shows.',
    unlessNegated: true,
  },
  {
    id: 'gear-prevents-pain',
    pattern: /\b(parallettes|wrist wraps?|wraps|braces?|blocks|push-up handles)\b.{0,50}\b(prevents?|protects?)\b/i,
    why: 'Ledger §13.10 rule 23: the one handstand survey found no association between wrist pain and warming up, braces or parallettes.',
    unlessNegated: true,
  },
  {
    id: 'inversion-health-claims',
    pattern: /\b(handstands?|inversions?|being upside down)\b.{0,50}\b(improves? (your |the )?(circulation|brain|balance|blood flow)|(damages?|harms?) (your |the )?eyes)\b/i,
    why: 'Ledger §13.10 rule 26: no study links handstand practice to eye harm or to any health benefit.',
    unlessNegated: true,
  },
  {
    id: 'pose-accuracy-figures',
    pattern: /\b(PDJ|PCK)\b|\b\d{2}(\.\d)?\s?% (accurate|accuracy)\b/i,
    why: 'Ledger §13.10 rule 19: no accuracy figure exists for inverted, hanging or flag poses; the vendor numbers are another task on private data.',
  },
  {
    id: 'maintenance-proven',
    pattern: /\b(one|a single) set (a|per) week\b.{0,50}\b(maintains?|keeps?|is enough)\b/i,
    why: 'Ledger §13.10 rule 21: no maintenance dose has been measured for any of these skills.',
    unlessNegated: true,
  },
  {
    id: 'skill-timelines',
    pattern: /\b(front lever|human flag|handstand|90° hold)\b.{0,60}\b(takes?|in)\b.{0,12}\b\d+\s*(weeks?|months?)\b/i,
    why: 'Ledger §13: no source gives a defensible timeline for the front lever, flag, handstand or 90° hold; do not quote one.',
    unlessNegated: true,
  },
]

const NEGATION = /\b(no|not|never|nor|none|nobody|neither|without)\b|n['’]t\b/i

function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/)
}

/**
 * The rules a single sentence breaks. Text in curly quotes is a mention, not a
 * claim — the update log has to name what it removed — so it is blanked first.
 */
function breaches(text: string): Rule[] {
  const sentence = text.replace(/“[^”]*”/g, '“…”')
  return RULES.filter(
    (rule) =>
      rule.pattern.test(sentence) &&
      !(rule.unlessNegated && NEGATION.test(sentence)) &&
      !rule.allowWhen?.test(sentence),
  )
}

const SRC = fileURLToPath(new URL('..', import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    if (!/\.tsx?$/.test(name) || /\.(test|fixture)\.tsx?$|\.d\.ts$/.test(name)) return []
    return [path]
  })
}

/** Every piece of text a file can put on screen: string literals, templates and JSX text. */
function copyIn(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const out: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text)
    else if (ts.isTemplateExpression(node)) {
      // Substitutions become a placeholder so the sentence around them stays whole.
      out.push([node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join('X'))
    } else if (ts.isJsxText(node)) out.push(node.text.replace(/\s+/g, ' '))
    ts.forEachChild(node, visit)
  }
  visit(source)
  // Prose only: module specifiers, class names and keys are not claims.
  return out.filter((text) => /[a-z]{3,} [a-z]{2,} [a-z]{2,}/i.test(text))
}

describe('source hygiene', () => {
  it('has no stray control characters in any source file', () => {
    // A backspace once landed inside a regular expression: a shell had eaten
    // the backslash of a "\b", and the pattern silently stopped matching.
    // Nothing a person can see in a diff, so it is checked here.
    const offenders: string[] = []
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) return walk(path)
        return /\.(tsx?|css)$/.test(name) ? [path] : []
      })
    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf8')
      // Tab, line feed and carriage return are the only control characters source needs.
      // eslint-disable-next-line no-control-regex
      const found = text.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/)
      if (found) offenders.push(`${relative(SRC, file)}: U+${found[0].charCodeAt(0).toString(16).padStart(4, '0')}`)
    }
    expect(offenders).toEqual([])
  })
})

describe('claims the app must not make', () => {
  it('appear nowhere in the text the app can show', () => {
    const files = sourceFiles(SRC)
    expect(files.length).toBeGreaterThan(40)
    const offences: string[] = []
    for (const file of files) {
      for (const text of copyIn(file)) {
        for (const sentence of sentencesOf(text)) {
          for (const rule of breaches(sentence)) {
            offences.push(`${relative(SRC, file)} [${rule.id}] "${sentence.slice(0, 140)}" — ${rule.why}`)
          }
        }
      }
    }
    expect(offences).toEqual([])
  })

  it('catch the exact sentences that were removed for making them', () => {
    // Taken verbatim from the copy this test was written to replace. If a rule
    // is loosened until one of these passes, the guard has lost its teeth.
    const removed = [
      'Your delts adapt in weeks; your biceps tendons take months.',
      'Second loaded session today — skill work only, tendons keep score.',
      'Strength is built during recovery, not during the hard sessions.',
      'Your last hard session hit RPE 9+ — today turns that into strength instead of fatigue.',
      'Skipping deloads is slower, not faster.',
      'Cold wrists under a planche lean is how people end up taking three months off.',
      'Wrist pain is the #1 reason people quit planche training.',
      'A short night can erase 20% of your holds — plan tests for rested days.',
      'Sleep, caffeine, stress, and how recently you trained all swing a max hold by 20% or more.',
      'The unlock targets are minimums.',
      'Banking extra seconds on the current step makes the next one arrive faster, not slower.',
      'This is the single most important strength builder on the whole road — treat it as a main lift, not a warm-up.',
      'Here is how not to get hurt.',
      'Spend the first weeks earning the basics, and everything after them arrives faster.',
      'The full warm-up costs three minutes and protects the wrists that all of this runs on.',
      'Today recovers it into strength instead of stacking more on top.',
      'Take a Deload Flow week at roughly half volume. Strength is expressed after recovery, not during accumulation.',
      'Spikes like this are where progress stalls and joints complain.',
      'Raises body temperature and heart rate so everything that follows is safer.',
      'It cannot see whether a toe is still touching the wall — you confirm the free part — and for push-ups it counts the reps it can see reach the bottom and lock out.',
      'The camera counted eight reps reaching the bottom.',
      'A front lever takes 6 months for most people.',
      'There is no research on the human flag.',
      'The 90° hold has never been studied.',
      'Research shows the front lever builds the lats better than rows.',
      'Parallettes prevent wrist pain in handstands.',
      'Handstands improve circulation and balance.',
      'The pose model is 96.6% accurate on fitness poses.',
      'One set a week maintains a front lever.',
    ]
    for (const sentence of removed) {
      expect(breaches(sentence).length, sentence).toBeGreaterThan(0)
    }
  })

  it('let through the hedged way of saying the same things', () => {
    const allowed = [
      'That is preparation, not protection — no trial has shown a warm-up prevents injury in strength training — but it is a good moment to notice how your joints feel.',
      'The popular line that tendons lag muscle by a set number of months is not what that research found.',
      'The two controlled trials of planned deloads found no strength benefit, so treat it as a pressure valve rather than the week strength appears.',
      'The unlock bars are convention, not measured thresholds.',
      'Measured strength can climb by a third while muscle and tendon are both still unchanged.',
      'Deload weeks are convention rather than proven, and the app now tells you that rather than claiming strength lands during recovery.',
      'Strength arrives faster than the structures carrying it.',
      'Gone: a warm-up that “protects” the wrists and wrist pain as “the #1 reason people quit”.',
      'No routine can keep you injury-free, so it no longer promises to.',
      'The camera does not count reps — the replay does.',
      'It does not count push-up reps: those sets are filmed so that you can check them on the replay.',
      'No source gives a timeline for the human flag, so none is quoted: nobody can say it takes 6 months.',
      'Thinly sourced: no research on it was found and no named coach publishes hold times for it, so every bar here is this app’s own design.',
      'Wrist pain is common among people who practise handstands, and no study has shown that warming up, wraps or parallettes prevent it.',
      'No study of the hold was found.',
      'No maintenance dose has been measured for these skills, so a couple of sets is this app’s choice.',
    ]
    for (const sentence of allowed) {
      expect(breaches(sentence).map((rule) => rule.id), sentence).toEqual([])
    }
  })
})
