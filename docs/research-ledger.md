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

**Direct planche research is thin, and none of it validates this app's
specifics.** It exists — biomechanical modelling, an acute muscle-activation
study, small uncontrolled rings-training interventions in elite gymnasts, and a
small controlled rings comparison (see §11) — but a targeted review did not
identify robust evidence validating a novice floor-planche dose, these unlock
gates, or any timeline. Every progression standard, every hold-time bar, and
every timeline in this app — and in every competing product — is coaching
consensus, inference, or anecdote. The science that does exist is mostly about
isometrics, tendons, frequency and motor learning in general; it is genuinely
useful, but it validates none of the specifics.

*Corrected 2026-10-05:* this section used to say "there is no peer-reviewed
research on planche training — PubMed returns zero results". That was a
narrow-search zero turned into "no literature". The conclusion for the app is
unchanged; the claim is now the accurate one.

The app's copy must reflect that asymmetry.

---

## 1. Isometric training

| Source | Type | Finding | Tier | Used for |
|---|---|---|---|---|
| Oranchuk, Storey, Nelson, Cronin. *Isometric training and long-term adaptations.* Scand J Med Sci Sports 29(4):484–503, 2019. PMID 30580468 | Systematic review, 26 studies | Long muscle length 0.86–1.69 %/wk hypertrophy vs short 0.08–0.83 %/wk. ≥70% MVC needed for tendon adaptation | MODERATE | Justifies isometrics as the app's core stimulus; intensity gating |
| Ghayomzadeh et al. *Isometric vs dynamic RT.* J Sci Med Sport 28(12), 2025. PMID 40817007 | Meta-analysis, 32 studies | ISO vs control SMD 0.65; **isokinetic subgroup SMD −0.20, ns** (test-specificity confound) | STRONG | Honest framing: isometrics work, but partly measured on their own terms |
| Weir, Housh, Weir. J Appl Physiol 77:197–201, 1994. PMID 7961233 | Controlled trial, n=7 | Gains at trained angle and one adjacent; none at ±3 further angles | LIMITED | Angle specificity |
| Lanza, Balshaw, Folland. Eur J Appl Physiol 119:2465–76, 2019. PMID 31522276 | Controlled trial | Trained 65°: +12% at 65°, +11% at 50°, +7% at 80°, +5% at 35° | MODERATE | Why each planche step needs its own lean angle |
| Lum D, Barbosa TM. *Brief review: effects of isometric strength training on strength and dynamic performance.* Int J Sports Med 40(6):363–75, 2019. DOI 10.1055/a-0863-4539 | Narrative review of controlled trials (leg extension and similar; no planche) | Recommends, for maximal strength, 80–100% MVC in 1–5 s contractions totalling 30–90 s a session; for hypertrophy, 3–30 s contractions totalling >80–150 s a session over >36 sessions. At equal intensity, gains tracked total contraction time per session more than per repetition. Read from the published text 2026-11-01 | MODERATE (general isometrics); INFERENCE for the planche | `KEY_HOLD_AGGREGATE_SEC` — about a minute sits inside the strength range. A working planche hold is treated as a high-%MVC contraction because a position held only ~10–20 s at most demands near-maximal force; that step is inference, not measured |

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
| Hickmott, Chilibeck, Shaw, Butcher. Sports Med Open 8:9, 2022. PMC8762534 | Meta-analysis | Autoregulation vs standardized 1RM: **MD 2.07 kg, 95% CI −0.32 to 4.46, p = 0.09, SMD 0.21 — ns** | MODERATE–STRONG | Framed as *no difference detected* — **not** equivalence (corrected 2026-10-05: a nonsignificant test does not establish equality), and not evidence for the app's bandit |
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
| Pancar et al. Sci Rep 16(1):10299, 2026. PMID 41730991 | Within-subject RCT, n=19 untrained men, unilateral curls / leg extensions | **Reduced-volume** weeks: no between-condition difference *detected* in the selected hypertrophy/10RM outcomes (p = 0.239–0.955). Corrected 2026-10-05 from "cost nothing": this does not show no cost, injury prevention, or a planche schedule | LIMITED |
| Rogerson et al. Sports Med Open 10(1):26, 2024. PMID 38499934 | Survey, n=246 | All athletes deload; **6.4 ± 1.7 days every 5.6 ± 2.3 weeks**; volume cut, frequency kept | STRONG *as practice*, zero as efficacy |

Coleman's deload *stopped* resistance training for a week (other activity was
allowed); Pancar's *reduced* the dose. They are different interventions and
neither validates the app's five-week rule.

**Product implication, applied:** the app schedules easy weeks and says plainly
that this is convention rather than proven. The previous copy — "strength lands
during recovery" — was removed, and two surviving copies of it in Learn and the
tips were removed on 2026-10-05.

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
| Sprague et al. Pilot Feasibility Stud 7(1):58, 2021. PMID 33632313 | Pilot RCT, 15 randomised, diagnosed patellar tendinopathy, ages 16–40, clinician-led with periodic supervision | Verbatim rule: pain **≤5/10 during or immediately after**, and **back to pre-activity level by the following morning** | STRONG for the rule text; LIMITED for efficacy. Feasibility only — it does **not** clear undiagnosed wrist/elbow pain for planche work, and is not paediatric wrist evidence |
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

---

# Second pass — 2026-08-05 (adversarially verified)

A 112-agent deep-research run with 3-vote adversarial verification per claim.
**Twenty claims failed verification and are recorded below rather than
suppressed**, because several are attractive enough to be re-derived by
accident. Everything in this section is either 3-0 verified or explicitly
flagged as refuted/uncovered.

## The competitor question: CaliPro

**VERIFIED 3-0**, against Apple's iTunes Lookup API (primary JSON, not a
summarised page):

| | |
|---|---|
| App | `id6762614539`, bundle `com.ofek.calipro` |
| Title | "CaliPro" — subtitle "AI Calisthenics Form Coach" |
| Developer | individual, `ofek yahalom` (no Ltd/Inc/LLC) |
| Released | 2026-04-30 · v2.8 on 2026-07-30 (actively maintained) |
| Price | free download; IAP $6.99/wk, $9.99/mo, $39.99/yr (50% off), $79.99/yr |
| Ratings | 3.909 from **22** ratings |
| Languages | English only |

Self-describes as on-device pose tracking scoring a filmed planche or
front-lever hold 1–100 on joint angles across six aspects. **This is developer
copy, not observed behaviour.**

Excluded lookalikes: "Calisthenics Pro – Workout" (`id6762489614`, Tomohito
Kii) is a different product on every discriminator. `calipro.io` and
`calipro.co.uk` belong to unrelated entities — **the claim that calipro.io is
this product was refuted 0-3**. No official website was confirmed; the App
Store listing is the only verified primary source.

No Android competitor is worth benchmarking: the nearest is a Brazil-focused
app with 500+ installs and zero ratings.

## The null result that matters most

**Nothing could be established about ANY competitor's actual mechanics from
public sources.** Every such claim failed verification, almost all because they
were *arguments from absence in marketing copy*.

Specifically refuted — do not re-derive these:
- CaliPro lacks placement / progression gating / plateau diagnosis / deloads /
  pain rails / forecasting (1-2)
- CaliPro v2.8 shipped a side-view refusal gate and honest sub-3s scoring,
  i.e. convergent evolution on this app's invariants (**0-3**)
- Movement Athlete's adaptation inputs are entirely self-reported (1-2)
- A Movement Athlete redesign destroyed users' training history (0-3)
- Both gamification-harm claims

**Absence from a store listing is not absence from a product.** This app must
not claim competitors lack features.

## Pose estimation — the substantive science

**Rode et al. 2025, *Scientific Reports*** — `10.1038/s41598-025-22626-7` ·
[PMC12589393](https://pmc.ncbi.nlm.nih.gov/articles/PMC12589393/).
Validation against 27-camera marker-based mocap: **2.2M frames, 25
participants, 44 model configurations.** VERIFIED 3-0.

- Monocular **depth (out-of-image-plane) error is ~2–3× in-plane error** for
  every 3D-capable estimator tested.
- The authors' operational recommendation: **orient the camera so the angles
  you care about lie in the image plane**, or use multi-view.
- They name **BlazePose "Local" mode as accurate in 2D when depth estimates
  are discarded**.

This is published, model-specific backing for `MAX_SIDE_VIEW_RATIO` and for
judging in 2D. Critically, the cause is **projective geometry, not model
quality** — a newer model will not fix it.

The same paper documents the near-arm/far-arm **self-occlusion** problem a side
view creates. The existing near+far averaging and `unseen` states are the
correct response; do not replace with worst-of or silent single-arm judging.

**Cabuk et al.** — `10.5114/biolsport.2026.154942` ·
[PubMed 41783455](https://pubmed.ncbi.nlm.nih.gov/41783455/). VERIFIED 3-0,
abstract level only. Markerless accuracy is **task- and joint-specific**;
test-retest ranged moderate to very good with marked variability in certain
task-joint combinations. **Aggregate RMSE figures cannot be borrowed.**

### Flagged, do NOT rely on

Elbow flexion may sit in the least favourable measurement regime of any joint
angle — reported MAEs 2D 21.5–26.1°, 3D 16.3–23.2°, versus knee 2D 9.3–22.9°.
This matters disproportionately because progression credit rests on signed
elbow bend. **But both the standalone claim and the "no monocular estimator
reaches the ~5° clinical threshold" claim FAILED verification (0-3 and 1-2).**
The paper's elbow task was shoulder rotation with a partly self-occluded upper
limb — not a static side-view straight-arm hold. Transfer is INFERENCE.

## Additions to "what the app must not claim"

11. Do **not** quote OpenCap's pooled RMSE (~4.9–5.9°), r=0.845 or ES=−0.140 as
    this app's accuracy — different pipeline (two-camera, OpenSim-fitted), and
    the standalone claims asserting those as a transferable floor were refuted.
12. Do **not** claim any absolute joint-angle accuracy without task-specific
    validation of *that* task, *that* joint and *that* camera view.
13. Do **not** claim competitors lack placement, plateau diagnosis, deloads,
    pain rails or uncertainty handling.
14. Do **not** claim a competitor independently rediscovered this app's
    invariants (refuted 0-3).

## The open question this app is uniquely placed to answer

> **What is single-camera BlazePose's joint-angle error for a static,
> side-view, straight-arm hold with the far arm partly self-occluded?**
> No published validation covers this task-joint-view combination.

The app already owns the machinery to measure it — `poseSynth` (skeletons built
from known angles), `realPoses.fixture.ts`, `formJudge.eval.test.ts` and
`selfTestJudge()`. Nobody else's number applies, so measuring it would be a
genuine contribution and the only defensible accuracy figure the app could ever
state.

## Coverage gaps — "not investigated", not "nothing found"

No surviving claim addressed: isometric training at long muscle lengths or
joint-angle specificity of transfer; scapular protraction / serratus / straight-
arm loading biomechanics; tendon and distal-biceps tendinopathy literature
depth; CV uncertainty quantification as distinct from accuracy; motor learning
and the McKay/Carter replication re-analyses; anthropometry and leverage. The
**whole of Priority 4** is uncovered — no FIG Code of Points, no rings
research, no hand-balancing injury epidemiology, no physiotherapy return-to-load
protocols, no open pose datasets, no on-device ML privacy.

## Source-quality limits

App Store and Play listings were verified as authentic via primary APIs and live
DOM inspection — this establishes existence, identity, pricing, ratings and
self-description, **not** that any app behaves as its marketing says. The
Emerald/Kybernetes gamification study is paywalled; only abstract-level
direction of effect was visible. Neither Rode et al. nor Cabuk et al. could be
cross-checked on the publisher's own site (auth walls); both were confirmed real
via PMC/PubMed/Europe PMC and DOI landings.

---

## 11. Third pass — 2026-10-05 audit corrections

Recorded from the 2026-10-05 external audit's research review, as that review
reported them (its own access notes are kept; these rows were not independently
re-fetched in this pass). They change wording, not the app's conclusions.

### Direct planche-related evidence that exists

| Source | Type | Finding | Tier | Limit |
|---|---|---|---|---|
| Rosaci et al. JSCR 39(6):680–686, 2025. DOI 10.1519/JSC.0000000000005074 | Acute EMG, n=7 high-level adult ring specialists | Muscle activation in support scale/planche vs five preparatory exercises | LIMITED | Activation differences do not establish faster learning or transfer to floor athletes |
| Bioengineering 10(7):761, 2023. DOI 10.3390/bioengineering10070761 | Nine-segment biomechanical model | Anthropometry changes planche mechanics | INFERENCE | Not a training outcome; never a body-type ceiling or weight-loss advice |
| Schärer et al. IJERPH 16:4571, 2019 | Uncontrolled 4-week intervention, 9 elite men (8 analysed) | Support-scale resistance up ~3.6%; pairwise p = .06/.08 printed as significant | LIMITED | No comparator; nothing about novices, dose or injury |
| Schärer et al. Sports 10:49, 2022 | Uncontrolled, 10 elite men (9 post-tested), 6 sessions | Max resistance +8.32%; endurance contrast p = .06 | LIMITED | No fastest-acquisition or safety conclusion |
| Correa, UAI undergraduate thesis, 2023 | 10 participants, 5 per group, 5 weeks | Assisted-progression group had smaller duration penalties | OPEN (very low confidence) | Not peer reviewed; posture penalties remained; no retention test |
| Sukdee 2014; Alhenawy 2024; Eshtayev et al. 2025 | Small rings/gymnastics comparisons | Judged scores, not floor-planche acquisition | LIMITED | Reporting inconsistencies noted by the audit |

Excluded as direct evidence: Bernasconi 2009 (the "support scale" is the
swallow/Maltese) and Kravchuk 2020 (a bent-arm, elbow-supported task).

### Symptom guidance behind the athlete copy

| Source | Type | Used for |
|---|---|---|
| American Academy of Pediatrics gymnastics guidance, updated 2024-07-01 | Official clinical education | Wrist/elbow swelling or pain the next day warrants medical review — the threshold now used in onboarding, the check-in and the mid-session report |
| NHS wrist pain guidance, reviewed 2025-11-05 | Official symptom guidance | Severity distinctions; not copied as country-specific instructions |

**Applied:** onboarding no longer says parallettes or fists "usually remove the
problem entirely", and no copy waits for pain "that persists for weeks". A grip
change alters the wrist's angle; it does not diagnose or clear pain.

### Assistance is not a number

| Source | Type | Finding | Used for |
|---|---|---|---|
| Uchida et al. J Phys Ther Sci 28:1266–1271, 2016 | Lab measurement, 8 band colours × 10 elongations | Tension depends on stretch and often differs from manufacturer references | Why the remembered setup records *where* a band acts, and why assisted holds never count toward an unassisted unlock — colour is not a percentage of bodyweight removed |

## 12. Where the 2026-11 features sit

This records how the upgrade leans on the rows above, so its copy can be
checked against them. The last three rows add sources found on 2026-11-01:
one peer-reviewed review (Lum & Barbosa 2019, entered in §1) and two
coaching-practice sources (a coach's blog and a members' forum — CONSENSUS at
best). No planche trial exists among them.

| Feature | Basis | Tier as stated to athletes |
|---|---|---|
| Next-shape practice (the bridge) | Isometric gains concentrate at the trained angle (§1, Weir; Lanza); short hard holds were the stronger tendon stimulus in the one trial comparing lengths (§2, Bohm 2014) | Coaching consensus / the app's design |
| Early promotion (next shape's opening dose, full evidence, current past half its bar) | Unlock bars are convention (§9); the next shape held clean is direct evidence | The app's design — copy says the bars are convention |
| Push-up versions, pressed one step behind | Coaching practice only | Coaching consensus |
| Accessory double progression, set-to-set targets, drop-off suggestion | Autoregulation research (§4) is about dynamic lifts; the isometric thresholds are chosen | Design choice; the drop-off copy names its velocity-loss origin and says "your call" |
| A second, shorter session for once-a-week athletes | §3: volume-equated frequency made little measured difference — the gain is the extra work | Stated exactly that way |
| Weekly work view | Planning arithmetic | "A planning aid — no study sets these numbers" |
| Hand-relative steadiness | Measured on the 2026-10-10 audit's real footage (fixed / pan / oscillation) | Describes movement, never its cause |
| Minimum dose (a warm-up and five ~3 s maximal holds, for a day a full session will not happen) | Nuzzo, Pinto, Kirk & Nosaka, *Resistance exercise minimal dose strategies for increasing muscle strength in the general population: an overview.* Sports Med 54(5):1139–62, 2024. DOI 10.1007/s40279-024-02009-0, PMID 38509414. Its Table 8: practising a brief maximal isometric contraction 5–7 days a week, ≤3 min a session, raised *isometric* strength over a few weeks — e.g. Barss et al. 2018 (J Appl Physiol, PMID 30188797), five 3-s maximal grip contractions daily for 18 days, +9.7% trained hand. Elbow flexors, grip and knee extensors only; small, mostly decades-old trials; the overview did not assess study quality and calls practising the test "proof-of-concept"; it makes no claim about joint-angle specificity. Short holds over long: §2 (Bohm 2014). Extra sessions: §3 — the gain is the extra work | LIMITED. Copy: "Brief maximal holds raised strength in small trials on simpler movements; none tested the planche." Never: "proven", "specific to the planche", or a percentage |
| In-hold cues on time held (`holdCues`) | Timing arithmetic, not research: the stop allowance happens after the hold | A bug fix, stated as one |
| About a minute of key-hold practice a session (`KEY_HOLD_AGGREGATE_SEC`, 3–6 sets) | Primary: §1, Lum & Barbosa 2019 — 30–90 s of high-intensity contraction a session for strength (simpler movements; planche transfer is inference). Coaching practice agrees: Antranik Kizirian, *How to implement a steady state training cycle* (antranik.org, coach blog, no date; attributed to Coach Sommer via the GymnasticBodies forum): test the max hold, then sets at 50–80% of it for "60 seconds of quality aggregate practice", 3–4×/week. The tendon prescription in §2 (Mersmann 2017: 5×4 contractions of 3 s) adds up to the same minute. Fetched 2026-11-01 by a subagent; the article itself cites no trial | MODERATE for isometric dose in general, INFERENCE for the planche; the copy says no planche trial exists. Short sessions give up the reach toward the minute before any accessory block (`Block.reach`) |
| An in-session max clean hold about every three weeks (`plan.queueRetest`) | Coaching practice varies: the same Sommer cycle re-tests only after 8–12 weeks ("Don't test it before 8 weeks"), while a StrongFirst forum program (2023, members' posts, low quality) works 3-week blocks at a percentage of the max. Both agree on submaximal work most of the time and occasional true maxes. The app takes the short end because its working targets are a fraction of the last measured max, early strength gains run fast (§2, Kubo 2010), and an athlete who stops at every call otherwise never re-anchors (simulated) | CONSENSUS for the practice; the cadence is the app's design choice, not a measured optimum |
| Next-shape attempts aimed at the opening dose (4–10 s) | Sommer 2008's standard in §9: "15 s, plus 3–5 s on the next variation" | CONSENSUS. The steady-state cycle above advises *against* practising the next progression early — coaches disagree, and the app sides with the 2008 standard |

---

## 13. Fourth pass — 2026-11 multi-skill research

Indexed from four reports written 2026-11-17/18 for the multi-skill upgrade
(front lever, human flag, handstand and handstand push-up, 90° hold) and filed
whole under `docs/research/` (§13.12). Rows are as the reports give them;
nothing was re-fetched while indexing, so each report's access notes still
apply: papers at abstract level unless the report marks otherwise, many pages
read through a fetch tool that summarises. This pass relaxes none of rules 1–14.

Tags beyond the tiers are the reports' own. **SINGLE** / *single coach*: one
coach or vendor, not consensus. **VERIFIED** (apps only): a page states it —
never that an app behaves that way. **UNVERIFIED**: not opened (a search
summary, or a dead, paywalled or blocked page). **RAW / TOOL / ABSTRACT** (pose
report): read by eye, through the fetch tool's extraction, or abstract only.

### 13.1 The finding that matters most

**The asymmetry recorded for the planche holds for every new skill: research
exists beside these skills, and none of it validates a ladder, a bar, a dose or
a timeline.** Each zero below is *not found in the searches run*, never *does
not exist* — the reports list what they did not search.

| Area | Found | Not found | Report |
|---|---|---|---|
| Several skills at once | Research on dynamic lifts and laboratory motor tasks — it can bound a design choice, never validate one | A peer-reviewed test of a multi-skill calisthenics programme; a ceiling on straight-arm isometric work per session or week; a maintenance dose for a static skill (a dozen targeted PubMed queries, not a systematic search) | programming |
| Front lever, human flag | One self-report injury survey of 93 adults (Ngo 2021) | A study of either hold in PubMed. Google Scholar and SPORTDiscus were not searched and unread candidates exist — so "none was found in PubMed", never "there is no research" | lever |
| Handstand | Peer-reviewed work on *how a handstand is balanced* and on wrist load and wrist pain | A trial behind any hold-time bar, rep standard, progression order, frequency or timeline | handstand |
| Handstand push-up, pike push-up | Adjacent work only: head load in a headstand, kipping forces, gymnasts' measured rep counts | An EMG or kinematic study of the strict movement; injury data specific to it | handstand |
| 90° hold, 90° push-up | One coach's 2008 forum posts, one official exercise page, vendor and anonymous pages that disagree | Any research at all; a named coach's hold standard for the tuck or straddle hold | handstand |
| The camera on these skills | How the models are built; adjacent evidence that inverted bodies are the worst case for generic pose pipelines | A published measurement of BlazePose or MoveNet joint-angle accuracy on any of these skills | pose |

So every rule, ladder and bar in the upgrade is CONSENSUS, a single coach or
this app's design — and the copy has to say so, as it does for the planche.

### 13.2 Combining skills in one session

From the programming report. No row was tested on these skills; each is a
default the athlete can see and override.

| Question | What the sources say | Tier — and where the app's own design starts |
|---|---|---|
| Session order | Steven Low: warm-up → skill development → strength → cool-down, skill work in every session (https://stevenlow.org/the-fundamentals-of-bodyweight-strength-training/); skill work before strength (r/bodyweightfitness wiki, an undated third-party mirror). Encoded as warm-up → balance practice (5–15 min) → the priority strength skill → its push/pull partner → bent-arm strength → accessories | CONSENSUS for the template. "First gains most" is STRONG for dynamic lifts, INFERENCE for holds; fatigue impairing skill learning is MODERATE in the lab. Never "this order prevents injury" |
| Kind of work | Low: skill work is practisable for about 5–15 min without significant fatigue (handstands, L-sits); statics are slotted by push or pull — planche a push, front lever a pull; re-sort every 6–8 weeks. The wiki mirror lists front lever, planche and human flag as strength skills, not skill work | CONSENSUS. Two placements are INFERENCE: 90° work as bent-arm pushing, and the flag counted with the straight-arm skills |
| How many at once | Low: two to four skill-work items — his reason is session length, not physiology. Joshua Slocum (GymnasticBodies forum, a member): within one overlapping family one, maybe two. Fitloop's guide (https://fitloop.app/skills): one or two goals to start. The Movement Athlete help centre: no more than five, in 2–4-week blocks | CONSENSUS — **the numbers disagree and none is measured**; the copy should say the sources give two to four, five, and one or two |
| Priority and rotation | The hard day goes to the priority skill (Yerai Alonso, Calisteniapp co-founder — one coach, https://calisteniapp.com/articles/how-to-plan-your-workouts). Rotation: 2–4-week blocks (Movement Athlete); re-sort every 6–8 weeks (Low); 8–12 weeks unchanged per position (the steady-state cycle, §12) | CONSENSUS; priority has MODERATE support by transfer from dynamic lifts; block lengths disagree by a factor of four |
| Maintenance dose | Coaches: once a week holds a movement but progresses slowly (Slocum; a GMB podcast guest). Encoded as: a non-priority skill keeps its progression on about one session a week and one or two sets | CONSENSUS; MODERATE for dynamic strength; INFERENCE for a hold; **OPEN for balance** |
| Pairing and rest | Low: planche with front lever or back lever; alternate push and pull — planche, 90–120 s, front lever — to shorten rests from 3–7 min to about 1.5–3.5. GMB (Ryan Hurst, https://gmb.io/planche/): rotate planche holds with pulling work | CONSENSUS; rest lengths MODERATE by transfer |
| Frequency, easy weeks | Low: full body 3×/week, later a push/pull or straight-arm/bent-arm split; every 4–8 weeks keep intensity, halve volume, drop the isometrics first. **Daily handstands are disputed** — Low trains them almost daily; GMB says 2–4×/week, not daily by default (https://gmb.io/handstand/) | CONSENSUS; frequency §3; deloads remain convention (§5) |
| Dose | Per straight-arm skill about 30–65 s of hold at 60–70% of max (Low, https://stevenlow.org/prilepin-tables-for-bodyweight-strength-isometric-and-eccentric-exercises/) or 60 s at 50–80% (steady-state cycle). Two or three such skills a session is roughly 1.5–3 min of straight-arm holds | CONSENSUS per skill. The combined total is **OPEN** — a planning heuristic, labelled as one |
| Budget by joint | Planche, front lever and flag share an elbow/shoulder straight-arm budget; planche, handstand, handstand push-up and 90° work a wrist budget; handstand push-up, planche and 90° a pushing-shoulder budget. A joint report reaches every skill loading that joint; two skills in one budget do not step up in the same week | Grouping CONSENSUS (Low; steady-state cycle; GMB). The budgets and the one-step-per-week rule are **this app's design heuristics (INFERENCE)** — they describe load, never predict injury (§6) |
| Overuse | Straight-arm work is singled out as hardest on elbows and shoulders — front lever, back lever and planche by name in the steady-state cycle (also Low; GMB). Tendinopathy was the most reported diagnosis and the shoulder the most injured site among 93 street-workout adults (Ngo et al. 2021, PMID 34189146); in 181 Dutch calisthenics athletes **technique training used as a warm-up** was among the factors associated with injury (Mohammad, Mehrab, Weir 2025, PMID 39652047). Wrists: §13.5. Handstand push-up + planche + 90° on the shoulder: no source isolates it. **Lookalikes excluded:** McDonald-Wedding 2023 (PMID 37252647) and Leaf 2003 (PMID 12775207) study the *Australian sport of calisthenics* | CONSENSUS for the coaching; the surveys LIMITED and cross-sectional — association, not cause; the pushing-shoulder combination **OPEN** |

Peer-reviewed work that can bound — never validate — a combined session; all
at PubMed abstract level, none on planche, lever, flag or handstand training:

| Source | Type | Finding | Tier | Supports — and does not |
|---|---|---|---|---|
| Nunes et al. Eur J Sport Sci 21(2):149–157, 2021. PMID 32077380 | Meta-analysis, 11 studies | Strength gains were largest in the exercises done first (multi-joint first: ES 0.32, p = 0.034); order made no detectable difference to hypertrophy | STRONG for dynamic lifts; INFERENCE for holds | The priority skill first. Not a measured order effect for holds |
| Branscheidt et al. eLife 8:e40578, 2019. PMID 30832766 | Lab experiments | Muscle fatigue impaired motor-skill learning, and the deficit showed on later days without fatigue | MODERATE (a lab motor task); INFERENCE for handstands | Balance practice before strength work |
| Czyż et al. Sci Rep 14:15974, 2024. PMID 38987617 | Meta-analysis, 54 studies | Interleaved practice helped retention in lab tasks; almost negligible in applied settings | STRONG for the question asked | No evidence-based reason to interleave or to block skills — choose on logistics |
| Pelland et al. Sports Med 56(2):481–505, 2026. PMID 41343037 | Meta-regressions, 67 studies | Counting indirect sets as half fitted best; strength rises with weekly volume and frequency, with diminishing returns | STRONG for dynamic lifts; INFERENCE here | Overlap between skills as partial credit — any coefficient is the app's |
| Grgic et al. Sports Med 48(1):137–151, 2018. PMID 28933024 | Systematic review, 23 studies | Trained individuals needed rests over 2 min to maximise strength | MODERATE | Consistent with coaches' 2–7 min rests |
| Spiering et al. J Strength Cond Res 35(5):1449–1458, 2021. PMID 33629972; Bickel et al. Med Sci Sports Exerc 43(7):1177–87, 2011. PMID 21131862 | Narrative review; RCT, n = 70 | Strength and size held for up to 32 weeks on one session a week and one set per exercise if intensity is kept; the trial behind it cut the dose to one-third or one-ninth | MODERATE | A maintenance slot keeps the progression and cuts sets and days. General resistance training, not skills |
| Androulakis-Korakakis et al. Sports Med 50(4):751–765, 2020. PMID 31797219 | Systematic review + meta-analysis | One set, 2–3×/week (the report's prose says 1–3×), still raised squat and bench 1RM in trained men, sub-optimally | MODERATE | A secondary skill on a very small dose may still creep |
| Schärer et al. 2019 (PMID 31752246) and 2022 (PMID 35447859), also §11 | Uncontrolled, elite gymnasts | Two rings statics trained in the same 3–4-week block both improved | LIMITED | The only data found on two static elements trained concurrently |

**OPEN after this pass:** total straight-arm isometric time per session or
week; how many skills is too many; interference between two straight-arm
skills; maintenance of a hold or of balance; any flag or 90° frequency or dose.

### 13.3 Front lever

From the lever report; unattributed pages are named as such, not as coaches.

| | What the report records | Tier / status |
|---|---|---|
| Ladder | Shared: tuck → advanced (flat) tuck → … → full. **The middle is contested:** Steven Low's chart (third-party-hosted copy: https://www.calisthenics-101.co.uk/wp-content/uploads/2020/05/Overcoming-Gravity-2nd-Edition-Exercise-Charts.pdf) puts the straddle below half-lay / one-leg; Antranik (https://antranik.org/progression-exercises-for-static-holds/) and Cali Move (https://blog.calimove.com/2026/09/15/front-lever-progression/) put one-leg below the straddle; GMB (https://gmb.io/levers/) and Sean Maples (https://www.12minuteathlete.com/front-lever-progressions/) have no one-leg step. The report: offer both orders and say so — a side-view camera sees a one-leg lever far better than a straddle, a product reason, not a coaching one | CONSENSUS for tuck first, advanced tuck second, full last; the order between is **OPEN**; the camera remark INFERENCE |
| Hold-time standards | Sommer 2004: 60 s; Sommer 2008: 15 s plus 3–5 s on the next variation (§9, not re-opened). **No gate at all:** the steady-state cycle and Low (60–70% of max, about a minute in total). Maples: 5 × 15 s per step, the full lever up to 10 s. GMB, Logan Christopher, Cali Move: no number. Unattributed pages: 30 s / 10 s / 5 s (FitnessVolt) and "15–20 s per step", which traces to no named coach. **Spread 5 s (unattributed) to 60 s, about 12×.** FIG men's code 2022–2024, rings: the front lever is an A-value hold of 2 s (https://abgym.ab.ca/app/uploads/2023/06/MAG-CoP-2022-2024.pdf, p. 86; the 2025–2028 code was not checked) | Each number a single coach; unattributed numbers are **not** CONSENSUS. The report's suggested bars (tuck 20 s … full 5–10 s, shortening as the lever lengthens) are design inside that spread |
| Prerequisites | Maples: 5 chin-ups or pull-ups, a 30 s inverted hold on rings, 10 V-ups. Cali Move: no count — a strict pull-up base plus straight-arm work. Low's chart puts each back lever shape one level below the same front lever shape | Single coach each. "Low requires the back lever first": UNVERIFIED |
| Form standard | Elbows locked; body horizontal, hips and lower back level (GMB, Maples, Christopher, Cali Move). Scapula retracted and depressed is cued by three coaches; no opened source argues for neutral. Faults: hip pike (likelier in the straddle), sagging hips, bent arms, swinging. Maples: athletes misjudge horizontal — use a partner or video. Bar grip, head position, an arched back: covered nowhere | CONSENSUS for straight arms, the line and retraction + depression; the neutral question OPEN / not found; grip OPEN |
| Accessories, dose, timelines | Rows trail the same-shape hold by one to two chart levels (Low); negatives into each shape before the pause (GMB); arch pulls, ice cream makers and front lever pulls as gates (Maples). Dose: about a minute of total hold at 50–80% (steady-state) or 60–70% (Low) of a tested max. **Timelines: nothing usable** — Maples declines to give one; Cali Move's 6–12 months to a full lever is a coach's estimate with no data behind it | Single coach each; dose CONSENSUS (two coaches); timelines **OPEN** |
| Safety and research | GMB: levers load the shoulder heavily — on pain stop and drop a level. Ngo, Solis-Urra, Sanchez-Martinez. Orthop J Sports Med 9(6):2325967121990926, 2021. PMID 34189146 — online survey, 93 adults, 62.4% injured in 12 months; activity at the time of injury: freestyle/dynamic 20.7%, muscle-up 12.1%, planche 12.1%, **front lever 10.3%**. **No study of the hold was found** — PubMed's phrase search returns 3 unrelated records; candidates seen by title only are not evidence yet. Elbow or biceps-tendon data for straight-arm pulling, and anything youth-specific (the survey excluded under-18s): not found | Ngo LIMITED — self-report, no exposure denominator: 10.3% is a share of injured respondents, **not a risk**. Research OPEN |
| Mechanics, load fractions | **No sourced torque or "% of full" figure was found.** From geometry: shoulder torque = the weight beyond the shoulder × the horizontal distance of its centre of mass; hip and knee angle set that distance, so as in §10 the joint angles are the dial and the step name is a label. Abducting each leg by θ scales the legs' lever beyond the hip by cos θ — a narrow straddle is close to a full lever, a wide one much easier, which alone could explain the disputed order | INFERENCE, no numbers attached. Any fraction comes from the `lib/loading.ts` model and is called a model (rule 10) |

### 13.4 Human flag

Much thinner than the front lever, and the lever report says so plainly: **no
named coach's standard for the full flag could be verified, no named-coach
weekly dose was found, and no study of the hold was found.**

| | What the report records | Tier / status |
|---|---|---|
| Ladder | Low's chart: tuck → advanced tuck → straddle → full flag, the full flag at the same level as the full front lever. Al Kavadlo (https://breakingmuscle.com/?p=9825, https://breakingmuscle.com/?p=9985): clutch flag first, then a near-vertical flag lowered toward level. Antranik, crediting Paul Scott (https://antranik.org/human-flag-tutorial/): vertical flag lowered slowly → one-legged → full. David Jackson (https://totalcoaching.com/blog/?p=1271): the push–pull in a supported vertical flag first, both sides | Shared — start near vertical, shorten the legs before the full shape, train both sides: CONSENSUS (thin). **OPEN:** the clutch flag as a preliminary (one coach); straddle or one-leg as the last step |
| Hold-time standards | Named-coach numbers that could be opened: clutch flag 20 s (Al Kavadlo); vertical flag 20–30 s with straight arms (Antranik / Paul Scott). Low and Jackson give none. **Full flag: nothing verified** — 5 s appears twice, once UNVERIFIED (Danny Kavadlo; page now 404) and once unattributed (FitnessVolt, which calls its marks its own standard) | Single coach each. Every bar past the vertical flag in the report's suggested ladder is design; the full-flag bar is **OPEN** |
| Prerequisites and form | Kavadlo: plenty of pull-ups and handstand push-ups, no numbers; Antranik: 3 × 5 wall handstand push-ups, self-imposed. The bottom arm pushes, the top arm pulls; both arms straight — no opened source allows or discusses a bent top arm; pelvis and torso locked in one line, legs horizontal (Jackson). Grip: overhand or mixed (Kavadlo); top hand overhand, bottom open-palmed with the thumb down (Jackson). Twist about the long axis: addressed nowhere | Single coach each; pull-up counts across sources run 5 / 8 / 10 / "lots" — **no agreed number**. Arm roles CONSENSUS; straight arms and line CONSENSUS (thin); **no named-coach grip width** |
| Dose and timelines | **Weekly dose: no named-coach convention found.** Timelines: Jackson's about three months to a photo-length flag; "7 weeks from beginner" is workshop promotion; FitnessVolt itself says no reliable source gives one | **OPEN** |
| Safety and research | Kavadlo: the press flag loads the shoulders heavily, the bottom arm most. Train both sides, the weaker more (Antranik; Jackson). Ngo 2021 names the flag only as a *hypothesised* shoulder risk in its introduction. **No study of the hold was found** — PubMed's phrase search returns 9 records, all molecular or cell biology; pole-sport literature and competition codes were not investigated. Wrist and elbow loading of the bottom arm, falls, youth: no sourced data | Single coach; both sides CONSENSUS (thin), with no evidence it prevents injury; the rest OPEN |

### 13.5 Handstand and handstand push-up

From the handstand report. **HeSPU** is the headstand push-up, head to the
floor; **HSPU** has the hands raised so the shoulders reach the hands.

| | What the report records | Tier / status |
|---|---|---|
| Handstand ladder | Agreed: wrist preparation → an inclined wall position → chest-to-wall for strength and line → a bail learned *before* balancing → wall-assisted balance drills (heel pulls, toe pulls) → kick-up entries → freestanding holds, wall work continuing alongside (Ryan Hurst, https://gmb.io/handstand/; Mikael Kristiansen of Handstand Factory, https://gmb.io/freestanding-handstand/; Sommer 2008; Antranik; Cali Move). Disputed: chest-to-wall first (the majority) or back-to-wall (Kyle Weiger, https://kyleweiger.com/wall-handstands-and-why-they-are-useful/) | CONSENSUS for the order; wall orientation is a majority preference. A tuck-up-first camp: UNVERIFIED |
| Hold-time standards | Wall hold before balance work: 3 × 20–30 s (Kristiansen) · 60 s (Antranik; GymFit; Emmet Louis, https://handstandfactory.com/podcast/s1ep23-beyond-30-seconds/) · 3 min as a long-term target (Sommer 2008) — **a 6–9× range**. Freestanding milestones cluster at 10 / 15 / 30 / 60 s. *Measured, not coached:* 83 competitive male gymnasts aged 7–18 held a freestanding handstand on parallel bars for 7.7 ± 14.6 s at Level 4 and 78.7 ± 26.6 s at Level 10 (Sleeper et al., Int J Sports Phys Ther 11(7):1082–1100, 2016, PMID 27999723) | CONSENSUS at best; none validated. Sleeper MODERATE as description, not a standard |
| Form standard | Wrists, shoulders, hips and ankles stacked; shoulders open and elevated — **the opposite of the planche cue**, degree disputed; ribs down, pelvis tilted back; elbows locked (GymFit; Weiger; Hurst; Low). **Head position is a genuine disagreement**; two tiny studies lean to looking at the floor (Asseman & Gahéry 2005, PMID 15670656; Farana et al. 2025, PMID 40980972). Shoulder screens did **not** predict handstand score in 111 novices (Malíř et al. 2024, PMID 38739595); balance was best with joined, straight fingers in 31 young gymnasts (Milosis & Satras 2023, DOI 10.52165/sgj.15.3.375-394) | CONSENSUS for the line; head studies LIMITED — do not grade head position; Malíř MODERATE; Milosis LIMITED. "Straight is easier to balance": OPEN |
| Balance control | A **wrist strategy** — sway corrected by wrist flexor torque with the body held as one segment; hip torque marks the poorer balances (Kerwin & Trewartha 2001, PMID 11445766; Yeadon & Trewartha 2003, PMID 14999137; Blenkinsop, Pain, Hiley 2017, PMID 28791131 — more than 75% of the time). Vision matters. Review: MacDonald et al. 2025, PMID 41473027 — 21 studies, samples mostly 1–10. Over-balance has a wrist answer (finger pressure); under-balance does not | MODERATE for the wrist strategy; the review MODERATE as a map, not STRONG; over / under-balance CONSENSUS + INFERENCE. "Balance comes from the core" is unsupported |
| Practice dose | Short, frequent and fresh; numbers vary — Hurst 2–4×/week for 15–20 min, Low 5–10 min every session, Cali Move most days. Two small studies: wrist-strategy coaching improved balance time in less-skilled novices and left joint angles unchanged; posture coaching improved posture scores, **not balance time** (Rohleder & Vogt 2019, DOI 10.52165/sgj.11.2.209-222; 2018, DOI 10.1080/24748668.2018.1440459) | CONSENSUS on short and frequent; studies LIMITED; no trial compares frequencies — OPEN. Line and balance are separate things to learn — score them separately |
| Safety: wrists | **The best-evidenced risk.** Of 321 adults practising at least weekly, 56.7% reported persistent or recurring wrist pain, with no association with training frequency, warming up, braces or parallettes / blocks (56.8% vs 56.3%, p = 1.000) — Martonovich et al., J Funct Morphol Kinesiol 10(4):372, 2025, PMID 41133562; its abstract and table contradict each other on age, so no age claim. The gymnast meta-analysis of §6 found risk rising with weekly hours — **the two disagree on whether training load matters** (the programming report reads this survey's null as weekly hours). In 59 non-elite gymnasts (mean age 9.3) 56% had wrist pain and 51% radiographic stress changes at the growth plate (DiFiori et al. 2002, PMID 12435656). AAP threshold (§11): next-day swelling or pain warrants a doctor. Wrist prep (GMB, https://gmb.io/wrists/) "prepares", never "prevents" | Martonovich LIMITED (self-selected, self-reported) but the only handstand-specific data; DiFiori MODERATE for high-volume youth gymnastics, INFERENCE beyond it; wrist prep CONSENSUS |
| Safety: falls, eyes | Learn the bail before balancing (Kristiansen; Hurst; Cali Move; Marmerstein); no fall-injury data was found. **Eye pressure:** intraocular pressure roughly doubled in headstand (Baskaran et al. 2006, PMID 16806478; 75 practitioners) and rose within a minute in head-down yoga poses, back to baseline within two (Jasien et al. 2015, PMID 26698309). Neither studied handstands or harm: asking anyone with glaucoma or another eye condition to check with their clinician is defensible; "inversions damage eyes" is not | Bail CONSENSUS; fall injuries OPEN; the eye-pressure measurements MODERATE |
| Push-up ladder and standards | Low's chart (https://stevenlow.org/wp-content/uploads/2017/02/OG2ChartsPrint.pdf): pike HeSPU → box HeSPU → wall HeSPU eccentric → wall HeSPU → wall HSPU → free HeSPU → free HSPU. "Enough to move on" for pike push-ups: 6 clean reps a set (Cali Move) · 4 × 10 (Yaad Mohammad via Antranik, https://antranik.org/hspu-tutorial-yaad/) · 10–15 a set (CrossFit, https://www.crossfit.com/essentials/hspu-and-you-master-the-movement); wall reps before harder work: 5 to 8–10; negatives: a 2-count to 5–10 s | CONSENSUS on the order; **every number is SINGLE** — rep standards are convention, none measured |
| Push-up form and safety | Head lands ahead of the hands; elbows track back; full lockout at the top; head to floor is the partial range, shoulders to hands the full one. The head taps and never rests: head loads in a yoga headstand peaked at 40–48% of body weight (Hector & Jensen 2015, PMID 26118514), and *kipping* peaks usually exceeded body weight (Bove 2025, DOI 10.58524/jcss.v4i2.623 — abstract, 16 volunteers), which supports strict-only as a cautious design choice and does not prove kipping harmful. Never to failure — in an inverted press failure means landing on the head | Form CONSENSUS; Hector & Jensen MODERATE; Bove LIMITED; the failure rail CONSENSUS + INFERENCE. No EMG, kinematic, injury or adolescent study of the movement was found — OPEN |
| Timelines and proposed bars | Timelines are all anecdote — none may be shown as a forecast (6–8 weeks for some, years for others, and Hurst declines to give one answer; "3–4× faster" sits on a page selling a programme). The report's bars — chest-to-wall 60 s, **7 of 10 kick-ups reaching balance for ≥ 5 s**, freestanding 10 / 30 / 60 s, pike 3 × 8 through wall HeSPU 3 × 5 to one clean freestanding rep, strict only — are convention or design. Two consequences: a timed float is not always a handstand, so hit rate gates better than one best hold; a wall hold can verify the line, never the balance | CONSENSUS only that timelines vary enormously. No bar is measured — the copy must say so (rule 1) |

### 13.6 90° hold and 90° push-up

Thin, in the handstand report's own words: **no research at all**; one named
coach (Sommer, forum posts from 2008); one official exercise page; otherwise
vendor and anonymous sites that disagree. Everything is SINGLE unless marked.

| | What the report records | Tier / status |
|---|---|---|
| Names | *90 degree push-up*: from a handstand, lower with a forward lean until the body is horizontal on bent arms, then press back. *90 degree hold / bent-arm planche*: the static bottom position. Sommer's **Bower** (https://www.gymnasticbodies.com/forum/topic/214-bowers-an-advanced-pushup-variation): the low point is an unsupported bent-arm planche where no rest is possible. An *elbow lever* rests the body on the elbows — a different, balance skill. Low's charts list no 90° push-up, 90° hold or bent-arm planche | SINGLE (Sommer; the GymFit page) |
| A clean hold | Elbows at about 90° (three low-quality sources that agree, e.g. Gornation, https://www.gornation.com/blogs/calisthenics-exercises/90-degree-handstand-push-up); body horizontal and straight; **elbows not resting on the torso** — only Sommer and Lost Art of Hand Balancing say so clearly; shoulder blades protracted and depressed (GymFit, https://www.gymnasticbodies.com/exercises/hollow-back-press). **"Forearms vertical" is stated by no opened source, and the mechanics argue against it:** with the hands under the centre of mass and the elbow at 90°, a straight body puts the hand behind the elbow, so the forearm leans. Shoulder demand is of planche order (the same distance as §10) with the elbow bent | SINGLE × 3 for the elbow angle; two sources for the no-support rule; forearm and torque INFERENCE — measure before making a rule, and never a percentage |
| Ladders, prerequisites, timelines | Sommer 2008: ten steps from the strict push-up through pseudo planche push-ups, the headstand push-up and chest rolls to the full Bower — no standards. Entry requirements for the hold run from a one-minute plank and 25 push-ups (Thenx, vendor) to a 5 s elbow lever (CalisthenicsWorld.org, anonymous); for the push-up from a 15 s free handstand, 5 strict handstand push-ups and a tuck planche, trained twice a week (Calixpert, a membership site, https://www.calixpert.com/exercises/90-degree-handstand-push-ups) to a straddle or full planche plus 5 free handstand push-ups (a vendor's app blog). Timelines: several weeks to months (Calixpert) against four years or more (the app blog) | **OPEN** — different guesses, not points on one scale. Whether the elbow lever transfers, and whether bent-arm planche work helps or hinders the straight-arm planche: OPEN |
| Safety, proposed ladder | No research and almost no coaching text; elbows — nothing found. The hold combines planche-order shoulder torque with a deeply loaded wrist, and the push-up adds an inverted eccentric ending near the floor, so the report inherits every planche rail and adds the never-to-failure rail. Its ladder is to be **flagged low-confidence in the UI: no bar has a named coach behind its number** | The rail reasoning is INFERENCE; every bar is design |

### 13.7 What a single phone camera can and cannot judge on these skills

From the pose report. **Nothing below is an accuracy figure for this app** —
every number is somebody else's task, joint, view and pipeline (rules 11–12).

| Question | What was found | Tier / status |
|---|---|---|
| How the models meet a turned body | BlazePose turns the crop so the hip→shoulder line is vertical before landmarking, taking that alignment from a detector its authors describe as a face-detector proxy that assumes a visible head (Bazarevsky et al., arXiv:2006.10204 · TOOL; GHUM model card, https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf · RAW). In IMAGE mode — the app's — that detector runs on every sample; the vendor's accuracy tables describe tracking mode and scope out a head that is not visible. MoveNet has no rotation step, so an inverted body reaches the network inverted (model card · RAW) | MODERATE for the mechanism; behaviour on an inverted or pole-gripping body **OPEN** — the first thing to measure |
| Inverted | No published measurement for BlazePose, MediaPipe or MoveNet was found. Adjacent: an OpenPose-based classifier of nine static calisthenics skills scored lowest on the one inverted skill (one-arm handstand F1 0.64; front lever 0.74; human flag 0.83 — Finocchiaro, Farinella & Furnari, VISAPP 2024, arXiv:2507.12245 · TOOL); four generic 2D detectors had 81–92% of keypoints correct in regular skiing and 35–54% in falls (Zwölfer et al. 2023, DOI 10.1016/j.jsampl.2023.100034 · ABSTRACT); OpenCap against Vicon gave joint-angle RMSE of 40.1° ± 14.5° on gymnastics movements against 11.6° ± 6.7° on ordinary tasks (Buchanan et al. 2026, PMID 42485837 — handstand report) | LIMITED–MODERATE, other pipelines; transfer to BlazePose INFERENCE. A warning, not this app's number: no planche threshold is reused upside-down without re-measuring |
| Hanging, horizontal | Prone support is inside the vendors' stated domain, with no accuracy figure. Supine bodies: MediaPipe 2D angle error 13.4°, and turning the video upright did not help it (Aguilar-Ortega et al. 2023, DOI 10.3390/s23218862 · TOOL). **Not found:** wrist or hand landmark error with a bar or pole across the grip; any measurement on a face-up horizontal hang | MODERATE (one lab); the front lever itself **OPEN** |
| Front-on flag | Only the classifier F1 is flag-specific. Geometry: from the front, body line against horizontal, lateral sag, straightness of both arms and leg separation lie in the image plane; hip pike / arch and chest roll are depth — 2–3× worse (Rode et al., above). The back view hides the face — the higher-risk recording for BlazePose. Left/right swaps: quantified only for OpenPose on gait, about 5% of frames (Stenum et al. 2021, DOI 10.1371/journal.pcbi.1008935 · TOOL). Self-occlusion by the pole: nothing published | Geometry INFERENCE; Stenum MODERATE. Supports body line, sag and arm straightness from the front; refuses hip flexion and trunk roll |
| Joint-angle validity | Published MediaPipe errors span about 7° to 25° by joint, task, view and near or far side. Elbow flexion agreed poorly with mocap (ICC 0.53, SEM 11.7°) and flattened at full flexion (Wang, Smith & Zhu 2023, DOI 10.1371/journal.pone.0293178 · RAW). **The far side is measurably worse:** knee-angle RMSE 10.7° near leg, 25.1° far leg from one lateral camera (Dill et al. 2024, DOI 10.3390/s24237772 · TOOL). **Disagreement kept visible:** Hamilton et al. 2024 (DOI 10.1016/j.jbmt.2024.04.033 · ABSTRACT) report good-to-excellent agreement for knee and elbow angles. The vendor's PDJ (91.8 and 96.6 for the full model in its two cards) accepts a keypoint within 20% of torso size — by the report's arithmetic up to about 18–21° on a forearm | MODERATE (Hamilton and the vendor figures LIMITED; the arithmetic INFERENCE). Reinforces rule 12: elbow accuracy is condition-specific and unsettled, and none of these is a straight-arm hold. Dill is published support for the near / far handling |
| What `visibility` means | Defined as the probability a keypoint is in frame **and** not occluded; `presence` is in-frame only (GHUM model card · RAW). No figure for its accuracy is published; a Google collaborator wrote that the Pose Landmarker cannot detect occlusions (issue #5806, https://github.com/google-ai-edge/mediapipe/issues/5806 · TOOL — informal). MoveNet's score is an in-frame / confidence signal, not an occlusion flag | MODERATE for the definitions; whether it tracks real occlusion (a bar, a pole, the torso hiding the far arm) is **OPEN**. One threshold cannot serve both backends; `unseen` means *insufficient evidence*, never *confirmed occluded* |
| Camera placement | Classical 2D analysis: lens perpendicular to the plane of movement, movement centred (Mercer, UNLV handout · RAW; Puig-Diví et al. 2019, DOI 10.1371/journal.pone.0216448 · TOOL). A counting study found a 45° diagonal counted best (Oliosi et al. 2026, DOI 10.2196/82412 · TOOL). **They answer different questions** — a diagonal helps detection and counting; any departure from perpendicular projects the joint angle — so for a judge that grades angles the perpendicular rule governs. Vendor validation images were at 2–4 m | Teaching practice CONSENSUS; studies MODERATE; camera height — no primary recommendation found — OPEN. Each is one source's operating condition |

Per skill (the pose report's §14; every cell INFERENCE):

| Skill | View | Could measure, once checked on real footage | Cannot |
|---|---|---|---|
| Front lever | Side-on, lens level with the body | Hold time; torso and hip angle; knee extension; elbow bend in the picture plane; drift | Scapular position; straddle width and anything else in depth; roll; grip |
| Human flag | Front-on, perpendicular to the plane of pole and body | Hold time; body line; lateral sag; straightness of both arms; leg separation | Hip pike or arch, chest roll, shoulder detail — all depth |
| Handstand | Side-on, phone upright | Hold time; wrist–shoulder–hip–ankle stacking; shoulder and hip angle; elbow bend in the picture plane; sway | Sideways lean; where an arch comes from; finger corrections; head position when the arms cover the ears |
| Handstand / pike push-up | Side-on | A count of slow reps; tempo; body line. Lockout and depth **only after** the sampling study (§13.8) | Elbow flare; whether the head touched (contact is not observable); depth to better than about 6–15° at 3 samples a second |
| 90° hold | Side-on, as the planche | Hold time; torso angle; near-arm elbow angle; forearm angle; feet clear of the floor; drift | The far arm (hidden by the torso); whether the elbows rest on the trunk (contact is not observable) |

- **Collisions with the existing judge** (INFERENCE from the app's own documented assumptions): `floorEdge` assumes a trunk lying across gravity and hands below the shoulders — false for a handstand and for anything hanging; the side-view gate refuses exactly the view a flag needs, which needs a measured *minimum*-width gate instead; signed-bend tolerances were measured near lockout and need re-measuring at about 90°. Until measured, the fallback is `unseen`, the stopwatch and the athlete's own rating.

### 13.8 Rep counting

From the pose report (its §7). Counting reps from pose is an established
method; no validation of grading a rep's depth or lockout from pose was found.

| Question | What was found | Tier / status |
|---|---|---|
| Methods that exist | Two-threshold (hysteresis) counting over a smoothed per-frame pose classification (the MediaPipe and ML Kit method, https://developers.google.com/ml-kit/vision/pose-detection/classifying-poses · TOOL); joint-angle thresholds with a state machine that counts only a complete cycle (Sinclair, Kautai & Shahamiri, arXiv:2308.02420 · RAW); two salient poses in order (Yao, Cheng & Zou, *PoseRAC*, arXiv:2303.08450 · TOOL); peak picking on a smoothed angle signal; class-agnostic counting from video self-similarity (Dwibedi et al., *RepNet*, arXiv:2006.15418 · TOOL) | MODERATE for the vendor method and RepNet; the preprints LIMITED to LIMITED–MODERATE |
| Sampling rates used | Every pose-based source opened processed 15–43 frames a second (15 fps was a hardware limit, with slow deliberate movements). **None sampled anywhere near 3 a second for rep or range-of-motion work**; none below 15 was found. Authors comparing 30 and 120 fps state that no standard guideline exists for choosing a rate (Alenzi et al. 2025, DOI 10.3390/jcm14051687 · TOOL) | Alenzi MODERATE; the gap is *not found*, not *does not exist* |
| Reported accuracy | Counting: exact-count match 61.1% for push-ups overall, 85.7% from the best (diagonal) placement, 66.7–77.3% from the side (Oliosi et al. 2026 — a MoveNet-based commercial pipeline). **Depth and lockout: no validation against any reference was found** for push-ups, handstand push-ups, pike push-ups or pull-ups | Oliosi MODERATE, not transferable (rule 12); depth grading **OPEN** |
| Counting at 3 a second | Sampling theory needs more than two samples a cycle, so reps slower than about 0.7 s can in principle be counted; a hysteresis counter needs a sample in each end zone — guaranteed only for reps slower than about 0.9–1.1 s, and two per zone (the minimum for any noise rejection) only for reps slower than about 1.8–2.3 s | INFERENCE — the report's derivation, not a citation |

**Depth and lockout at 3 a second** (the same derivation): the nearest sample
can miss the turning point by half a sample interval. Worst-case under-reading
of the extreme over a 90° range, from a smooth turnaround to an abrupt one:

| Samples / s | 1 s rep | 2 s rep | 3 s rep | 4 s rep | Samples in the last 10% of range (2 s rep, smooth) |
|---|---|---|---|---|---|
| 3 | 22.5° – 30° | **6.0° – 15°** | 2.7° – 10° | 1.5° – 7.5° | 1.2 |
| 5 | 8.6° – 18° | 2.2° – 9° | 1.0° – 6° | 0.6° – 4.5° | 2.0 |
| 10 | 2.2° – 9° | 0.6° – 4.5° | 0.3° – 3° | 0.1° – 2.3° | 4.1 |
| 15 | 1.0° – 6° | 0.3° – 3° | 0.1° – 2° | 0.1° – 1.5° | 6.1 |

That is sampling error alone; landmark jitter (about 1.5–2% of torso) adds
roughly 3° on one segment in one frame, and the hold judge's persistence rule
has no equivalent at a turning point. The report's reading: at 3 a second the
app could plausibly *count* slow reps but cannot honestly *grade* depth or
lockout; 10–15 samples a second around each turning point is a hypothesis to
test on the app's own 30 fps footage.

**Decision taken: no camera rep count ships. A rung on a push-up line is
evidenced by a filmed set the athlete rates Clean and checks on the replay
against a per-rung checklist** — the second of the report's two fallbacks (a
count with depth self-reported, or no count and a replay to confirm).

### 13.9 Competitor apps

From the programming report (Apple's iTunes Lookup API and review feed, US
storefront, 2026-11-17; vendors' pages). **VERIFIED means a page states it —
developer copy, never behaviour; absence from a listing is not absence from a
product.** The second pass's null result on competitor mechanics stands.

| App (App Store ID) · rating (count) · version | What its listing or site states — VERIFIED as copy only |
|---|---|
| The Movement Athlete (1357148593) · 4.54 (303) · 1.70.77, 2026-10-20 | Up to five skills at a time in 2–4-week blocks, main and side skills; an assessment of about three minutes — performed or self-reported is UNVERIFIED. No camera feature advertised in the pages opened |
| Cali Move Workouts (6461533732) · 4.68 (243) · 2.0.1, 2026-11-03 | Any number of plans and single workouts share one calendar. *Developer-acknowledged:* the level used to drop automatically after a few hard sessions, users found that confusing, and it is now shown, recommended and left to the athlete |
| CaliPro (6762614539) · 3.67 (24) · 2.14, 2026-08-30 | Scores a filmed planche or front-lever hold 1–100 from joint angles, on-device; counts reps from a spoken set and scores each; trims the clip to the hold |
| Handstand Balance: AI Coach (6761752286) and iBalance: Handstand Coach (6761697275) · no ratings | A stopwatch that runs only while a stable handstand is detected, live cues, strict and lenient tolerance modes (the first says its results are estimates, not judging); joint angles scored against a straight line (the second) |
| Gymscore (6744373919) · 4.08 (26) · 2.0.9, 2026-11-13 | A form score in five areas after each set of any recorded exercise. Among 10 reviews read: the same video scored differently twice |
| GymScore for Gymnasts (6768770702) · 5.0 (3) · 1.2.5, 2026-11-11 | Explains a routine's likely deductions, deliberately gives no scores, and says when a video is too hard to read — developer copy, not evidence of anyone converging on this app's rules (rule 14) |

- **What changed about CaliPro** since the second pass: rating 3.67 from 24 (was 3.909 from 22); version 2.14 (was 2.8), with no update in eleven weeks. Its description links Terms and Privacy pages on calipro.io — whether it did in August is not known — and those terms describe an AI form-analysis service taking uploaded videos, billed on the web, last updated 8 April 2025. So "calipro.io is this product — refuted 0-3" **needs re-opening**; that the web service and the iOS app are one product is still not established.
- **UNVERIFIED and not used:** Onyx's current status; Zenia; the generic form-check apps found in store search; whether Kinetic's clip verification is a person or software. Identity, rating and version for 25 apps are in the report.
- **Complaints** (recent reviews from Apple's feed — a complaint sample, not a satisfaction measure): paying before trying; billing and cancellation; lost sessions; difficulty that will not bend; inconsistent AI form scores; hold cues gone silent, or the app pausing the athlete's music.

### 13.10 Additions to "what the app must not claim"

Merged from the four reports' lists and numbered on from rule 14 (the reports'
own numbers collide, so these are the numbers of record). **P** programming,
**C** pose, **H** handstand, **L** lever.

15. **Any hold-time bar, rep standard or prerequisite count for these skills as validated, standard or "the rule".** All are convention or this app's design: front lever bars spread 5–60 s and two leading sources set none; wall-handstand conventions span 20 s to 3 min; pull-up prerequisites run 5, 8, 10 and "lots". Nor that 60 s chest-to-wall is *required* before freestanding practice — one of three conventions. [L, H]
16. **A timeline, completion date or typical duration for any step or skill** — "tuck in 2–3 months", "flag in 7 weeks", "6–12 months to a front lever", "handstand in N weeks", "N× faster", "four years" to a 90° push-up. Each is anecdote, a coach's estimate or vendor copy. [L, H]
17. **"Research shows" or "EMG shows" about the front lever, the flag, the handstand push-up or the pike push-up** — no such study was found. Nor "there is no research": Google Scholar and SPORTDiscus were not searched and unread candidates exist. [L, H]
18. **That the camera counts reps, or vouches for a rep's depth or lockout.** No camera rep count ships (§13.8): no source sampled near 3 a second, and the worst-case miss on a 2-second rep is about 6–15° before landmark noise. Nor any rep-counting accuracy from the literature (98.9%, off-by-one 0.56 …) as this app's. [C]
19. **Any pose-estimation accuracy figure for inverted, hanging or flag poses, or that the judge is validated for them because the model was "trained on yoga and fitness".** The vendor's PDJ / PCK@0.2 (91.8, 96.6, 95.5 …) is tracking mode on private data with a 20%-of-torso tolerance; its training mix is undisclosed and no inversion result is published; OpenCap's 40° gymnastics error is a warning from another pipeline. Nor an upright or planche threshold reused upside-down without re-measuring. [C, H]
20. **That a joint was "hidden" or "seen" on the visibility score alone** (its link to real occlusion is unpublished); **anything from the front view of a flag about hip pike, arch or body roll** (all depth); **or that 2–4 m, a 45° diagonal or any camera height is *validated* placement** (each is one source's operating condition). [C]
21. **Any number of concurrent skills (2–4, five, one or two) as measured or optimal; any ceiling on straight-arm isometric time as evidence-based; the hypertrophy range of 12–20 weekly sets (Baz-Valle et al. 2022, PMID 35291645) as a bound on skill strength; or that one set a week maintains a planche, lever or handstand.** The coaches' numbers disagree, nothing was measured on these skills, and the maintenance evidence is dynamic lifting in general populations. [P]
22. **That any order, pairing, grip, scapular position, warm-up or training both sides prevents injury** — the planche–front lever pair "balancing" the shoulder and skill practice before strength included. The one survey that asked found technique-as-warm-up *associated with more* injury, and cannot show cause either way. [P, L, H]
23. **That warming up, wrist braces, wraps, parallettes or blocks prevent wrist pain or injury** — the one handstand survey found no association for any of them; say they prepare the wrist or change its position. **Nor that wrist pain is normal and can be trained through** (the next-day swelling-or-pain threshold stays, §11), **or that daily handstand practice is safe or recommended** (coaches disagree, and wrist pain is common in every population surveyed). [H, P]
24. **An injury rate or risk for any of these skills.** Ngo 2021's 10.3% is the share of injured respondents who were doing a front lever (self-report, adults only, no exposure data); the flag is only *hypothesised* as a shoulder risk in that paper's introduction; the pectoralis rupture case report happened in a different move; the Australian sport of calisthenics is not bodyweight strength training. [L, P]
25. **That the handstand push-up is safe or unsafe for the neck as a fact, that kipping is proven harmful, that any group is "at risk", that the head can take weight at the bottom, or that pressing overhead causes impingement.** Say only that the app counts strict reps and wants a light head touch. [H]
26. **That inversions harm the eyes or raise blood-pressure risk** (eye pressure rises head-down in yoga poses; no study links handstand practice to harm), **or that handstands improve standing balance, circulation, brain function, hair growth or any health outcome.** [H]
27. **One correct handstand:** the straight line as the only correct form or proven easier to balance; one correct head position (do not grade it); shoulders shrugged to the maximum (elevated, yes — "100%" is disputed by a specialist coach); spread or clawed fingers improving balance (the only study found favoured joined, straight fingers); balance coming from the core (measured control is at the wrist); a shoulder screen predicting handstand ability (it did not in 111 novices). [H]
28. **That fatigue-free practice is proven to speed learning a handstand.** Fatigue acutely worsens balance metrics and nothing tested handstand learning [H]; the one study of fatigue and skill learning is a laboratory motor task — MODERATE there, INFERENCE here [P].
29. **A settled answer where named coaches differ:** straddle or one-leg first; retracted-and-depressed as the only correct scapula, or neutral as a fault (the lever report's list says two coaches cue retraction, its form table three); wall orientation; kick-up or tuck-up; whether the front lever is harder than the flag (Low's chart rates them equal, Cali Move says the lever is harder for most, nobody measured it). [L, H]
30. **Any torque or "% of a full lever" figure as measured** — none was sourced; a model is called a model (rule 10). Nor *Overcoming Gravity* levels as measured difficulty, or a handstand push-up step as a multiple of body weight on the overhead press — one author's chart equivalences; nor that the chart places the 90° push-up anywhere (it does not list it). [L, H]
31. **About the 90° hold:** its prerequisites as established; that it is a beginner skill; that it strengthens joints or connective tissue; that a clean hold has vertical forearms (no source says so, and the mechanics suggest otherwise for a straight body); that the elbow lever builds toward it; that bent-arm planche work does or does not carry over to the straight-arm planche. [H]
32. **Coach attributions that could not be verified:** "Low requires the back lever first" (only the chart's level order is known); the clutch flag as required (one coach) or a required grip width (no named coach gives one); the GMB / Kavadlo flag numbers or Danny Kavadlo's 5 s as quotations; the unattributed numbers — FitnessVolt's pass marks, "15–20 s per step", the anonymous flag blog's 30 s rules — as coaching consensus. [L]
33. **The FIG 2 s as a training standard, or as the current rule** — verified only for the 2022–2024 men's code (rings front lever, an A-value hold of 2 s); the 2025–2028 code was not checked. [L]
34. **Anything youth-specific about the front lever or the flag as evidence-based** — no youth data was found; the one survey excluded under-18s [L]. No adolescent handstand push-up study was found either [H].
35. **What rules 4 and 7 and §11's band row already forbid, re-imported from sources used here:** "connective tissue adapts more slowly than muscle", "tendons need months while muscle needs weeks", "a warm-up protects the shoulder", and band colour as a share of bodyweight removed. [L, H]

### 13.11 Claims that could not be verified

Recorded by name, from the reports' own lists, so they are not re-derived.

| Claim | Why it stays unverified | Report |
|---|---|---|
| Sommer's article prescribes 60 s of statics *after* the workout | Only a forum paraphrase was read (the article returned HTTP 402); a reply in the same thread says his athletes do them in the warm-up | programming |
| The Recommended Routine includes handstand skill work | The current page was not opened | programming |
| Antranik's sample routine totals about four minutes of statics; the flag should be trained at most twice a week | A search summary; an unattributed site | programming |
| Push/pull imbalance causes shoulder injury | Not established by anything opened | programming |
| The Movement Athlete's assessment is performed, not self-reported | Its pages do not say (a related claim failed 1-2 in the second pass) | programming |
| calipro.io and the iOS app CaliPro are one product | The listing links the site, but its terms pre-date the iOS release by a year and describe uploads and web billing | programming |
| "Low requires the back lever before the front lever" | A secondary site says so; a forum poster could not find it in the book | lever |
| "Hold each step 15–20 s"; FitnessVolt's 30 s / 10 s / 5 s front lever marks | Search summaries of unattributed pages; they trace to no named coach in what was opened | lever |
| FitnessFAQs' front lever ladder, and bent-arm pulling as a must | The page returned 404; search summary only | lever |
| Al Kavadlo's GMB flag tutorial and its hold times; Danny Kavadlo's 5 s full flag | Pages no longer served; a search summary and an anonymous copy give conflicting numbers | lever |
| Dragon flags, side planks, hanging leg raises or a "hanging side pull" as lever or flag accessories | In no opened named-coach source | lever |
| A biomechanical analysis quoting about 1051 N at the arms in a front lever | Search summary; the repository returned HTTP 403; type, method and author unconfirmed | lever |
| Tom Merrick: 30 s chest-to-wall, 4–6×/week, a handstand in 3–12 months | Search summary only; the site had expired | handstand |
| A named coach teaches the tuck-up or jump entry first | No opened source does | handstand |
| Back-to-wall handstands stress the spine; a shoulder-blade position protects the subacromial space | Coaching opinions stated with no source | handstand |
| Younger handstand practitioners report more wrist pain (Martonovich 2025) | The abstract (p = 0.042) and the full-text table (p = 0.223) contradict each other | handstand |
| The pose detector fails on flipped bodies because it was trained with ±45° rotation | That is issue #808, about the BlazeFace *face* model; the pose detector's rotation range is unpublished | pose |
| Pull-up counting at 91.5% (Wang, Chen & Duan 2021); the BASES video guidelines; a blog comparing Apple Vision and MediaPipe on headstands; Hamilton 2024's task details | None could be opened (Hamilton: abstract only) | pose |

- **Not investigated — not "nothing found":** Google Scholar, SPORTDiscus and Semantic Scholar; the *Overcoming Gravity* book text and Sommer's primary texts; the live r/bodyweightfitness and r/handbalancing wikis; coaches' video and paid material; the FIG code for 2025–2028 and for the handstand; pole-sport literature and codes; elbow and biceps-tendon literature; Google Play.

### 13.12 Where each report is filed

Copied unchanged. Section numbers inside a report are its own — cite "pose
report §7.3", never a ledger section. §13.10 and §13.11 draw on all four.

| Report | File | Indexed in |
|---|---|---|
| Multi-skill programming and the app landscape | `docs/research/2026-11-multi-skill-programming-and-apps.md` | §13.1, §13.2, §13.9 |
| Pose-estimation feasibility: inverted, hanging and flag poses; rep counting | `docs/research/2026-11-pose-feasibility.md` | §13.1, §13.7, §13.8 |
| Handstand, handstand push-up, 90° hold and 90° push-up | `docs/research/2026-11-handstand-hspu-ninety.md` | §13.1, §13.5, §13.6 |
| Front lever and human flag | `docs/research/2026-11-front-lever-and-flag.md` | §13.1, §13.3, §13.4 |
