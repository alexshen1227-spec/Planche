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
    ]
    for (const sentence of allowed) {
      expect(breaches(sentence).map((rule) => rule.id), sentence).toEqual([])
    }
  })
})
