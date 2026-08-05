# Research ledger — Planche Lab V2

Compiled 2026-08-04 for the V2 release. Every claim the app makes to an
athlete should be traceable to a row here, or should not be made.

## How to read the tiers

| Tier | Means |
|---|---|
| **STRONG** | Systematic review / meta-analysis / RCT, directly relevant |
| **MODERATE** | Primary research, adjacent population or single lab |
| **LIMITED** | Small, indirect, or preprint |
| **CONSENSUS** | Experienced coaches agree; no trial exists |
| **INFERENCE** | Biomechanical or statistical reasoning |
| **OPEN** | Genuinely unknown |

## The single most important finding

**There is no peer-reviewed research on planche training.** PubMed returns zero
results for "planche" as a training intervention. Every progression standard,
every hold-time bar, and every timeline in this app — and in every competing
product — is coaching consensus, inference, or anecdote. The science that does
exist is about isometrics, tendons, frequency and motor learning in general,
and it is genuinely useful, but it validates none of the specifics.

The app's copy must reflect that asymmetry.

---

## 1. Isometric training

| Source | Type | Finding | Tier | Used for |
|---|---|---|---|---|
| Oranchuk, Storey, Nelson, Cronin. *Isometric training and long-term adaptations.* Scand J Med Sci Sports 29(4):484–503, 2019. PMID 30580468 | Systematic review, 26 studies | Long muscle length 0.86–1.69 %/wk hypertrophy vs short 0.08–0.83 %/wk. ≥70% MVC needed for tendon adaptation | MODERATE | Justifies isometrics as the app's core stimulus; intensity gating |
| Ghayomzadeh et al. *Isometric vs dynamic RT.* J Sci Med Sport 28(12), 2025. PMID 40817007 | Meta-analysis, 32 studies | ISO vs control SMD 0.65; **isokinetic subgroup SMD −0.20, ns** (test-specificity confound) | STRONG | Honest framing: isometrics work, but partly measured on their own terms |
| Weir, Housh, Weir. J Appl Physiol 77:197–201, 1994. PMID 7961233 | Controlled trial, n=7 | Gains at trained angle and one adjacent; none at ±3 further angles | LIMITED | Angle specificity |
| Lanza, Balshaw, Folland. Eur J Appl Physiol 119:2465–76, 2019. PMID 31522276 | Controlled trial | Trained 65°: +12% at 65°, +11% at 50°, +7% at 80°, +5% at 35° | MODERATE | Why each planche step needs its own lean angle |

**Correction recorded:** the widely-quoted "isometric strength transfers ±15°"
has no primary source — it traces to blogs. The real window depends on training
muscle length. The app does not quote a number.

## 2. Tendon and connective tissue

| Source | Type | Finding | Tier | Used for |
|---|---|---|---|---|
| Bohm, Mersmann, Arampatzis. *Human tendon adaptation to mechanical loading.* Sports Med Open 1:7, 2015. PMC4532714 | Meta-analysis, 27 studies | Stiffness SMD 0.70. **High intensity (>70%) SMD 0.90 vs low 0.04, I²=0%.** Contraction type irrelevant | STRONG | "Intensity, not accumulated easy time, is the tendon stimulus" |
| Bohm et al. J Exp Biol 217:4010–17, 2014. PMID 25267851 | Controlled trial, 14 wk | **3 s loading: +57% stiffness. 12 s loading: +25%.** Longer holds were worse | MODERATE | Argues against long-hold programming |
| Kubo et al. J Strength Cond Res 24(2):322–31, 2010. PMID 19996769 | n=8, monthly measures | Strength **+29.6% by month 2 while muscle CSA *and* tendon stiffness were unchanged.** On detraining, muscle decayed *first* | LIMITED | The capability-jump rail. **Corrected a claim we had made**: this does not support "tendons lag muscle by two months" |
| Mersmann, Bohm, Arampatzis. Front Physiol 8:987, 2017. PMID 29249987 | Narrative review | Prescription: 5×4 contractions at 85–90% MVC, 3 s, 3×/wk, ≥12 wk | CONSENSUS | Session-shape sanity check |

## 3. Frequency and volume

| Source | Type | Finding | Tier | Used for |
|---|---|---|---|---|
| Grgic et al. Sports Med 48(5), 2018. PMID 29470825 | Meta-analysis | ES rises with frequency, but **volume-equated p = 0.421 (ns)** | STRONG | "Pick the frequency you'll keep" |
| Ralston et al. Sports Med Open 4(1):36, 2018. PMID 30076500 | Meta-analysis | Volume-equated **ES 0.03 (−0.20–0.27)** | STRONG | Same |
| Schoenfeld, Ogborn, Krieger. Sports Med 46(11), 2016. PMID 27102172 | Meta-analysis | The famous "2×/week" result — but the abstract states **the volume-matched analysis could not be performed** | MODERATE | Recorded so we don't repeat the folk version |
| Israetel et al. *Mesocycle progression.* Strength Cond J. DOI 10.1519/SSC.0000000000000518 | Practitioner article | Origin of MEV/MAV/MRV | CONSENSUS | **PubMed phrase index returns zero for "maximum recoverable volume".** Never present as measured |

## 4. Autoregulation and effort ratings

| Source | Type | Finding | Tier | Used for |
|---|---|---|---|---|
| Hickmott, Chilibeck, Shaw, Butcher. Sports Med Open 8:9, 2022. PMC8762534 | Meta-analysis | Autoregulation vs standardized: **MD 2.07 kg, p = 0.09, SMD 0.21 — ns** | MODERATE–STRONG | Framed as *equivalence*, never superiority |
| Halperin et al. *Accuracy in predicting reps to failure.* Sports Med 52(2), 2022. PMID 34542869 | Meta-analysis, 414 pts | **Underprediction 0.95 reps; between-person SD 1.45.** Training status β = −0.006 (no effect) | STRONG | Why RPE is treated as noisy input, not truth |

**Correction recorded:** Greig et al. 2020 is a *narrative* review with no pooled
effects, widely miscited as a meta-analysis. Zourdos 2016 validated an RPE
scale against velocity; it never measured RIR accuracy.

**OPEN:** no literature exists on RIR or "seconds in reserve" for isometric
holds. RPE-clamp work suggests perceived effort and remaining capacity
*dissociate* during a sustained hold.

## 5. Deloads

| Source | Type | Finding | Tier |
|---|---|---|---|
| Coleman et al. PeerJ 12:e16777, 2024. PMID 38274324 | RCT, n=39 | A 1-week **cessation** mid-programme: all credible intervals cross zero; posterior favoured *continuous* training | LIMITED |
| Pancar et al. Sci Rep 16(1):10299, 2026. PMID 41730991 | Within-subject RCT, n=19 | **Reduced-volume** deloads cost nothing (p = 0.239–0.955) | LIMITED |
| Rogerson et al. Sports Med Open 10(1):26, 2024. PMID 38499934 | Survey, n=246 | All athletes deload; **6.4 ± 1.7 days every 5.6 ± 2.3 weeks**; volume cut, frequency kept | STRONG *as practice*, zero as efficacy |

**Product implication, applied:** the app schedules easy weeks and says plainly
that this is convention rather than proven. The previous copy — "strength lands
during recovery" — was removed.

## 6. Injury and load

| Source | Type | Finding | Tier |
|---|---|---|---|
| DiLeo et al. Orthop J Sports Med 14(1), 2026. PMID 41552624 | Meta-analysis, **185,107 gymnasts** | Pooled wrist-pain prevalence **53% (39–66%)**; risk rises with weekly training hours | STRONG in that population |
| Impellizzeri et al. *ACWR: conceptual issues and pitfalls.* IJSPP 15(6), 2020. PMID 32502973 | Critical review | **"No evidence supporting the use of ACWR"** for injury-risk management | STRONG |
| Impellizzeri et al. Sports Med 51(3), 2021. PMID 33332011 | Re-analysis | Replacing the chronic denominator with **random numbers** gave materially the same effect | STRONG |
| Buist et al. Am J Sports Med 36(1), 2008. PMID 17940147 | RCT, n=532 | A programme built on the **10% rule**: injury 20.8% vs 20.3%. No protective effect | STRONG |

**Applied:** `readinessLoad` and `MAX_WEEKLY_LOAD_RAMP` are retained as
descriptive heuristics for "you've done a lot lately", explicitly labelled, and
never framed as injury prediction.

**Note the asymmetry:** the best-evidenced risk in hand-support training is the
**wrist**, driven by weekly hours — not the elbow, which is where calisthenics
folklore points. Distal biceps tendinopathy, the injury most warned about, has
almost no literature (1 of 19 studies in a 2025 tendon-loading scoping review).

## 7. Pain-guided training

| Source | Type | Finding | Tier |
|---|---|---|---|
| Silbernagel et al. Am J Sports Med 35(6), 2007. PMID 17307888 | RCT, n=38 | Continuing to load under a pain-monitoring model did **not** impair recovery | MODERATE |
| Sprague et al. Pilot Feasibility Stud 7(1):58, 2021. PMID 33632313 | Pilot RCT | Verbatim rule: pain **≤5/10 during or immediately after**, and **back to pre-activity level by the following morning** | STRONG for the rule text; LIMITED for efficacy |
| Silbernagel, Hanlon, Sprague. J Athl Train 55(5), 2020. PMC7249277 | Clinical review | Recovery days by pain band: 0–1 daily, 2–3 → 2 days, 4–5 → 3 days | CONSENSUS |

**Applied:** `signals.persistentComplaint` implements the week-on-week clause,
which is the part a training log can actually watch. Achilles/patellar
evidence; upper-limb application is INFERENCE and the copy says so.

## 8. Behaviour and motivation

| Source | Type | Finding | Tier |
|---|---|---|---|
| Michie et al. Health Psychol 28(6), 2009. PMID 19916637 | Meta-regression, 44,747 pts | Pooled 0.31; **self-monitoring explained the most heterogeneity**; 0.42 combined with a control-theory technique | STRONG |
| Deci, Koestner, Ryan. Psychol Bull 125(6), 1999. PMID 10589297 | Meta-analysis, 128 studies | Tangible contingent rewards undermine intrinsic motivation (d −0.28 to −0.40); **positive feedback enhances it (+0.33)** | STRONG |
| Nishi et al. EClinicalMedicine 76:102798, 2024. PMID 39764571 | Meta-analysis, 10,079 pts | Gamified vs non-gamified app: **+489 steps/day** — trivial | STRONG |
| Ma et al. IJBNPA 20(1):109, 2023. PMID 37700303 | Meta-regression | **Social reward β = −0.40, negatively associated** with habit-intervention effectiveness | MODERATE |
| Singh et al. Healthcare 12(23):2488, 2024. PMID 39685110 | Meta-analysis | Habit formation: **median 59–66 days, range 4–335** | MODERATE |

**OPEN:** there is no peer-reviewed streak evidence in exercise. Meanwhile real
mHealth engagement is intermittent by nature (mean 16-week breaks), so an
unforgiving streak makes the statistically normal case feel like failure. The
app keeps its week counter self-referential and non-punitive, and the North
Star forbids adding more.

## 9. Coaching sources (progression standards)

All CONSENSUS. Recorded because the app's unlock bars sit among them.

| Source | Standard to advance |
|---|---|
| Christopher Sommer, 2004 (via quoted forum posts) | 60 s single hold |
| Christopher Sommer, *Building the Gymnastic Body*, 2008 | **15 s**, plus 3–5 s on the next variation |
| Joshua Naterman, 2010 (reconciliation) | 60 s below straddle, **15 s straddle and above** |
| Steven Low, *Overcoming Gravity* | No gate. Work at **60–70% of max hold**; progress emerges |
| GMB Fitness | 5 × 20 s at 2–3 min rest |
| r/bodyweightfitness Recommended Routine | 3 × 30 s — but the RR explicitly **does not program planche** |

**The apparent "60 s vs 15 s war" is an artefact**: both camps quote the same
coach at different dates. Nobody credible argues for a 60-second straddle.

**The widely-repeated "10 second rule" traces to no named coach** — it appears
across content farms with no attribution. Not used.

**FIG Code of Points:** a planche must be held **2 seconds** to count in
competition; straddle = A value, full = C value. Every training standard above
is 5–30× stricter than the sport's own.

## 10. Mechanics (derivation, not citation)

In a balanced planche, shoulder torque = (body mass − arm mass) × g × d, where
d is the horizontal distance from shoulder to the centre of mass of everything
supported. Two consequences drive `lib/loading.ts`:

- **Arm length cancels.** It changes the required lean angle, not the load.
- **d is set by hip and knee angle**, so the progression *name* is a label and
  the joint angle is the actual dial. Advanced tuck spans ~72–92% of
  full-planche load; straddle width is worth ~10 points.

Tier: **INFERENCE** throughout. Corroborated loosely by an independent
practitioner calculation landing within ~10%, and by a coaching claim that
flattening the back adds 20–30% (model says 54%→72%, i.e. +33%).

---

## What the app must not claim

Collected from all four research streams, and enforced in review:

1. Any hold-time standard as validated.
2. A completion date for any skill.
3. That deloads are proven necessary.
4. That tendons lag muscle by a fixed number of months.
5. Any ACWR-style ratio as injury prediction.
6. The 10%-per-week progression rule as safety evidence.
7. That warming up prevents injury in resistance training (zero trials exist;
   McCrary et al. searched and found none for the upper body).
8. That the camera score is a safety, injury-risk or medical assessment.
9. That streaks or badges build habits.
10. Relative-difficulty percentages as measured fact rather than a model.

## Verification notes

Citations in sections 1–8 were verified against PubMed/PMC/Crossref records
displaying title and author list. One fabricated citation was caught and
discarded during research and is not present. Sources that could not be
verified are omitted rather than included with a caveat.
