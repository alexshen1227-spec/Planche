# Pose-estimation feasibility: front lever, human flag, handstand, HSPU / pike push-up, 90° hold

Research pass 2026-11-17. Target configuration: MediaPipe Tasks PoseLandmarker
(BlazePose GHUM "full", `@mediapipe/tasks-vision` 1.0.0, `runningMode: 'IMAGE'`,
one independent detection per seeked frame, about 3 samples a second) with
MoveNet Thunder (TFJS) as fallback.

This pass **adds rows to** `docs/research-ledger.md`; it does not relax its
rules 11–14. Nothing below is an accuracy figure for the app. Every number is
somebody else's task, joint, view and pipeline.

## 0. How to read this

**Tiers** (the ledger's): STRONG · MODERATE · LIMITED · CONSENSUS · INFERENCE · OPEN.
Two conventions for source types the ledger has not needed before:

- Vendor documentation, model cards and source code are authoritative for *how
  the software is built and what the vendor scopes out* — tiered MODERATE
  (primary, single source, not independently tested). Vendor *accuracy numbers*
  are self-reported on private data — tiered LIMITED.
- GitHub issues are anecdote (LIMITED) unless a maintainer states a design fact.

**Verification status** of each source:

- `RAW` — I read the raw text myself (PDF text or page print).
- `TOOL` — full text was retrieved and read through the fetch tool's
  extraction (a small model summarising the page), not by eye. The passages
  carrying most weight were re-queried a second time: the BlazePose paper,
  Dill, Oliosi, Lafayette, Aguilar-Ortega Table 4, Baldinger Table 3, Leuthold,
  Finocchiaro. The rest (Puig-Diví, Alenzi, Stenum, PoseRAC, RepNet, BRACE,
  FineGym, the GitHub issues) are single-pass extractions — check the table
  cell in the source before reusing any number from them.
- `ABSTRACT` — abstract / database record only.
- `UNVERIFIED` — could not be opened; listed so nobody mistakes it for checked.

**Quoting.** Statements are paraphrased with a locator (section, table, page)
rather than quoted, because of a hard limit on verbatim reproduction in this
session. One verbatim quote appears (§2.1). Re-open the source for exact wording
before putting anything into athlete-facing copy.

---

## 1. Bottom line

1. **No published measurement exists** of BlazePose or MoveNet joint-angle
   accuracy on a handstand, front lever, human flag, handstand push-up or
   bent-arm planche. Searched: a general web search, Europe PMC, arXiv, the
   MediaPipe and TFJS issue trackers (log in §11). OPEN.
2. **BlazePose is rotation-normalising at the landmark stage and
   face-dependent at the detection stage.** The landmark network only ever sees
   a crop turned so the hip→shoulder line is vertical; the alignment comes from
   a detector the authors describe as a face-detector proxy that assumes a
   visible head. In IMAGE mode the app runs that detector on *every* sample.
   The vendor's published accuracy excludes the detector stage. MODERATE (docs)
   for the mechanism; OPEN for how it behaves on an inverted or pole-gripping
   body.
3. **Adjacent evidence says inverted bodies are the worst case for generic
   pose pipelines**: a pose-based calisthenics classifier scored lowest on the
   one inverted skill, and COCO-style detectors lost roughly half their correct
   keypoints on falling (often flipped) skiers. Neither used BlazePose.
   LIMITED–MODERATE, transfer is INFERENCE.
4. **Published joint-angle errors for MediaPipe span about 7° to 25°** depending
   on joint, task, view and whether the limb is on the far side; elbow and
   shoulder flexion are the least consistent across studies. This reinforces
   ledger rule 12 rather than giving a usable number.
5. **The far side is measurably worse.** One study reports knee-angle RMSE of
   10.7° for the near leg and 25.1° for the far leg from the same lateral
   camera. That is published support for the app's near/far handling. MODERATE.
6. **Rep counting from pose is an established method** (thresholds with
   hysteresis, state machines, smoothed-signal peaks), but every source I
   opened processed 15–43 frames a second. Nothing published supports judging
   bottom depth or lockout at about 3 samples a second; simple kinematics says
   it cannot be done to better than roughly 6–15° worst case on a 2-second rep.
   INFERENCE — the app must measure this by subsampling its own footage.
7. **`visibility` is defined as in-frame-and-not-occluded, but nobody has
   published how well it tracks real occlusion**, and a Google collaborator
   wrote on the tracker that the Pose Landmarker cannot detect occlusions.
   MoveNet's score is not an occlusion signal at all. OPEN.
8. **Camera-placement sources disagree by objective**: classical 2D analysis
   says perpendicular to the plane of motion; a 2026 counting study found a 45°
   diagonal counted best and a pure side view counted squats worst. Counting
   robustness and angle validity are different goals (§8).
9. **Two code-level collisions** follow from the app's own documented
   assumptions (§10): `floorEdge` assumes a trunk that lies across gravity and
   hands below shoulders — false for a handstand and for anything hanging — and
   the side-view gate refuses exactly the view a human flag needs.

---

## 2. What the primary sources say about the model the app runs

### 2.1 BlazePose / MediaPipe Pose Landmarker

| # | Fact (paraphrased) | Source · status | Tier |
|---|---|---|---|
| A1 | The person detector is a face detector used as a proxy; the authors state as a deliberate strong assumption that the head is always visible for the single-person case, because the face is the strongest cue for where the torso is. | Bazarevsky et al., *BlazePose*, arXiv:2006.10204 §2.2 — https://arxiv.org/abs/2006.10204 (read via ar5iv) · TOOL. Repeated in the Google blog, 2020-08-13 — https://research.google/blog/on-device-real-time-body-pose-tracking-with-mediapipe-blazepose/ · TOOL | MODERATE |
| A2 | Besides the face box, the detector predicts alignment points: the hip midpoint, the size of a circle around the whole person, and the incline of the line joining the shoulder and hip midpoints. | Same paper §2.2; blog; legacy MediaPipe Pose doc — https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md (GitHub returned 404 to the fetcher; read via the mirror https://chuoling.github.io/mediapipe/solutions/pose.html) · TOOL | MODERATE |
| A3 | Before landmarking, the image is rotated so the hip→shoulder line is parallel to the y-axis and the hips are centred. Alignment comes either from the detector or from the previous frame's keypoints. The authors say they *deliberately limit* the supported angle/scale/translation ranges in training to keep the network small, and add only 10% scale/shift augmentation. | Paper §2.6 · TOOL | MODERATE |
| A4 | The GHUM model card gives the landmark input as a 256×256 crop of an aligned full body, centred on mid-hip, in vertical body pose, with rotation distortion of ±10°; it states tolerance to 10% shift/scale and 8° roll. | *Model Card: MediaPipe BlazePose GHUM 3D*, 16 Apr 2021, pp. 1 and 4 — https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf · RAW | MODERATE |
| A5 | In a video pipeline the detector runs on the first frame and again only when the tracker reports no person; otherwise the next crop is derived from the previous frame's landmarks. | Paper §2.1; blog · TOOL | MODERATE |
| A6 | IMAGE mode treats every call as an independent still and resets tracking state each call. The legacy doc says the same of `static_image_mode: true`: person detection runs on every input image. | Pose Landmarker guide — https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker and `/web_js` · TOOL; legacy Pose doc (mirror) · TOOL | MODERATE |
| A7 | Out-of-scope uses listed by the vendor include: head not visible; person farther than about 4 m / 14 ft; several people; anything needing metric depth. | GHUM model card p. 2 · RAW (identical in the 22 Jun 2021 card hosted by ML Kit — https://developers.google.com/static/ml-kit/images/vision/pose-detection/pose_model_card.pdf · RAW) | MODERATE |
| A8 | Stated trade-off: the model "is sensitive to face position, scale and orientation in the input image" (GHUM model card, Limitations → Trade-offs). The Environment note adds that face-overlap conditions degrade quality and increase jitter. | GHUM model card p. 2 · RAW | MODERATE |
| A9 | The card's own evaluation mode is *tracking mode* — a crop obtained from the previous frame's prediction. Its PDJ (= PCK@0.2) averages are 87.0 / 91.8 / 94.2 for lite / full / heavy on 1,400 smartphone back-camera photos. The June 2021 card reports 93.8 / 96.6 / 98.3 on the same design. | GHUM model cards pp. 5–6 · RAW | LIMITED (self-reported, private data) |
| A10 | A keypoint counts as correct under PDJ if its predicted visibility matches ground truth **and** its 2D error is under 20% of the projected torso diameter. | GHUM model card p. 5 · RAW | MODERATE (definition) |
| A11 | Training data: the card says the majority (85K) of training images are fitness poses, plus 30K consented AR-app images; the 2020 paper lists 60K common-pose and 25K fitness images. Occlusion robustness comes from simulated occluders (random coloured rectangles); hidden points are annotated by best guess. | Card p. 3 · RAW; paper §2.4, §2.6 · TOOL | MODERATE |
| A12 | Vendor validation sets are called Yoga, Dance and HIIT, each image a single person 2–4 m from the camera. GHUM *full*: Yoga mAP 62.6 / PCK@0.2 95.5; Dance 67.4 / 96.3; HIIT 68.0 / 95.7. The 2020 (pre-GHUM) paper reports BlazePose Full at PCK@0.2 84.1 on its AR set and 84.5 on its yoga/fitness set, against 87.8 / 83.4 for OpenPose. | Legacy Pose doc, *Pose Estimation Quality* table (mirror) · TOOL; paper Table 1 · TOOL | LIMITED |
| A13 | Those evaluation sets are not public: asked directly, a maintainer replied that only the solutions are open-sourced. | Issue #2209 — https://github.com/google-ai-edge/mediapipe/issues/2209 · TOOL | MODERATE |
| A14 | Intended uses named on the card include fitness and repetition counting and pose measurements (angles, distances); the card also says the primary intended application is entertainment and it is not for life-critical decisions. | Card pp. 2–3 · RAW | MODERATE |
| A15 | ML Kit's pose API (same BlazePose family) documents that the user's face must be present for a pose to be detected, and that detection works best with the whole body in frame. | https://developers.google.com/ml-kit/vision/pose-detection · TOOL | MODERATE |

**What is absent.** I found no mention of handstands, inversion, upside-down
bodies, or the *pose detector's* rotation range in the paper, the blog, either
model card, the current guide or the legacy doc. The only yoga claims are the
blog's remark that the alignment scheme gives consistent tracking in complicated
cases such as some yoga asanas, and the Yoga validation numbers in A12, whose
pose mix is undisclosed. So *trained on yoga* cannot be turned into *validated
on inversions*.

**Reading A3–A9 together (INFERENCE, mine).** The landmark network is not
rotation-invariant — it tolerates about 8–10° — so everything for a horizontal
or inverted body rests on the alignment being right. In video mode the alignment
is inherited frame to frame. In IMAGE mode it is re-derived by the face-proxy
detector on every sample, and that is the stage the vendor's accuracy tables do
not cover. For the app this means: published PDJ figures describe a different
operating mode, and detector behaviour on these poses is the first thing to
measure.

A related but **non-transferable** data point: for the *face* detector
(`face_detection_front.tflite`), a Google engineer wrote that it was trained
with ±45° rotation augmentation and that flipped faces are not expected to work
(issue #808 — https://github.com/google-ai-edge/mediapipe/issues/808 · TOOL).
That is the BlazeFace model, not the pose detector; the pose detector's rotation
range is unpublished. Do not cite #808 as a fact about pose detection.

### 2.2 MoveNet Thunder

| # | Fact (paraphrased) | Source · status | Tier |
|---|---|---|---|
| B1 | Single-stage CenterNet-style model (MobileNetV2 + FPN), 256×256 input for Thunder, 17 COCO keypoints, targeted at movement/fitness; tuned for difficult poses and motion blur. | *MoveNet.SinglePose Model Card* pp. 1–2 — https://storage.googleapis.com/movenet/MoveNet.SinglePose%20Model%20Card.pdf · RAW | MODERATE |
| B2 | Trained on COCO (filtered to 28k images with fewer than three people) plus Google's internal *Active* set (23.5k single-person images from YouTube fitness, stretching and dance videos). | Card p. 3 · RAW | MODERATE |
| B3 | The launch blog explains Active was added because COCO rarely shows extreme poses and gives yoga, push-ups and headstands as examples; it also notes supine positions are hard for detectors trained on the wrong data. | https://blog.tensorflow.org/2021/05/next-generation-pose-detection-with-movenet-and-tensorflowjs.html (17 May 2021) · TOOL | MODERATE (statement of training intent, not a result) |
| B4 | Thunder keypoint mAP on the Active evaluation set (1,161 images) is about 90–95 across subgroups; on single-person COCO val it is about 74–83. | Card p. 4 · RAW | LIMITED |
| B5 | Intended for one person about 3–6 ft from a webcam. The model outputs all 17 keypoints even when they are occluded; low confidence is emitted for keypoints *outside the frame*; suggested threshold 0.3. | Card p. 2 · RAW | MODERATE |
| B6 | Input cropping uses the previous frame's detections: an axis-aligned square centred on the hip midpoint, sized from torso and body extents, falling back to the whole padded image when the torso joints are not confident (keypoint score 0.2). There is **no rotation step**. | TF Hub tutorial, *Cropping Algorithm* — https://www.tensorflow.org/hub/tutorials/movenet · RAW | MODERATE |
| B7 | In the TFJS detector the crop region is an instance field that persists between `estimatePoses()` calls with no static-image check; it resets only via `reset()`, a null image, or a pose score below `minPoseScore`. | `pose-detection/src/movenet/detector.ts` — https://github.com/tensorflow/tfjs-models/blob/master/pose-detection/src/movenet/detector.ts · TOOL | MODERATE |

**Consequences (INFERENCE).** MoveNet has no face-first detector to fail, which
is the app's reason for keeping it — but it also has no rotation normalisation,
so an inverted body reaches the network inverted and robustness rests wholly on
training data. And because the crop persists across seeks, a body that moves a
lot between samples (reps at 0.33 s spacing) may be clipped by a crop computed
from the previous sample. Neither has a published measurement.

---

## 3. Q1 — Inverted poses (handstand, HSPU)

### 3.1 Published evidence on inverted or flipped bodies (none uses BlazePose or MoveNet)

| Finding | Source · status | Tier / transfer |
|---|---|---|
| Calisthenics static-skill dataset (839 videos, 9 skills incl. planche, front lever, human flag, one-arm handstand; 24 fps, 960×540). Poses from OpenPose BODY_25B fed to an MLP: 76.17% frame accuracy. Per-class F1: iron cross 0.91, V-sit 0.88, human flag 0.83, back lever 0.83, planche 0.80, one-arm front lever 0.76, front lever 0.74, maltese 0.74, **one-arm handstand 0.64** (lowest skill). The authors attribute the handstand result to the upside-down body and the iron-cross result to an upright, non-overlapping body. | Finocchiaro, Farinella & Furnari, *Calisthenics Skills Temporal Video Segmentation*, VISAPP 2024 (DOI as listed by SciTePress: 10.5220/0012400600003660); arXiv:2507.12245 — https://arxiv.org/abs/2507.12245 · TOOL | LIMITED. A classification score, not a landmark-accuracy score; OpenPose, not BlazePose. Transfer is INFERENCE |
| Four generic 2D detectors (OpenPose, Mask R-CNN, AlphaPose, DCPose) on alpine-ski video: 81–92% of keypoints correct in regular skiing, 68–80% out of balance, **35–54% in falls**. | Zwölfer et al., JSAMS Plus 2:100034, 2023, DOI 10.1016/j.jsampl.2023.100034, PMID 41868559 · ABSTRACT | MODERATE for generic detectors; INFERENCE for BlazePose |
| Same group: detectors struggle with fully flipped people; they attribute it to training that covers upright poses with small rotations. Running the detector on the input rotated in 10° steps and choosing the best rotation per frame improved results in every category, most in falls. | Zwölfer et al., Sci Rep 13:21465, 2023, DOI 10.1038/s41598-023-47875-2, PMID 38052814 — https://pmc.ncbi.nlm.nih.gov/articles/PMC10697942/ · TOOL | MODERATE / INFERENCE |
| Earlier 4-page version: on fall frames PCK@0.2 rose from 0.51 to 0.72 (DCPose) and 0.64 to 0.72 (AlphaPose) with input rotation plus a kinematic model; upside-down and horizontal skiers often produced no keypoints at all; it relays that adding rotation augmentation in training lowered overall accuracy. | Zwölfer et al., arXiv:2112.12193 — https://arxiv.org/abs/2112.12193 · TOOL | LIMITED |
| Gymnastics video: a skeleton-based action model scored far below RGB models (Gym99 top-1 36.4% vs 80.4%), with gymnast detections and poses missed in many frames, especially during intense motion. | Shao et al., *FineGym*, arXiv:2004.06704 §4.2, Fig. 5 — https://arxiv.org/abs/2004.06704 · TOOL | LIMITED (dynamic gymnastics, not static holds) |
| Breakdancing: a COCO-pretrained HRNet scored AP 0.158 on the frames that needed manual labelling (0.357 after fine-tuning); on an external power-move set 0.462 → 0.598. | *BRACE: The Breakdancing Competition Dataset for Dance Motion Synthesis*, ECCV 2022, arXiv:2207.10120 Table 5 — https://arxiv.org/abs/2207.10120 · TOOL | LIMITED (the paper does not single out inversion) |
| Athletic movements generally: monocular 3D models trained on conventional data perform poorly; fine-tuning cut MPJPE from 214 mm to 65 mm. | Yeung et al., *AthletePose3D*, arXiv:2503.07499 · ABSTRACT | LIMITED |
| Supine bodies: several estimators did poorly; turning the video so the person looks upright helped most of them (e.g. HMR 2D angle error 23.8° → 19.6°, AlphaPose 11.8° → 9.3°) but **not MediaPipe** (2D keypoint error 0.051 → 0.050; 2D angle 13.4° → 14.2°; 3D angle 10.3° → 10.8°). | Aguilar-Ortega et al., Sensors 23(21):8862, 2023, DOI 10.3390/s23218862, PMID 37960561, Table 4 — https://pmc.ncbi.nlm.nih.gov/articles/PMC10648737/ · TOOL | MODERATE. Consistent with BlazePose's built-in alignment (A3); it is a lying body with a visible face, not an inverted one |

### 3.2 Field reports

- A developer of a calisthenics app asked for fine-tuning support because the
  stock model struggles with unusual poses, naming upside-down positions. Only
  reply: forwarded internally; still open. Issue #5295 (opened 2024-04-05) —
  https://github.com/google-ai-edge/mediapipe/issues/5295 · TOOL · LIMITED.
- A request to improve non-upright cases (turned away, martial arts, sitting,
  prone); a maintainer eventually suggested the *heavy* model for accuracy and
  occlusion tolerance, then the bot closed it. Issue #4868 —
  https://github.com/google-ai-edge/mediapipe/issues/4868 · TOOL · LIMITED.
- An on-device rep counter built on BlazePose (via ML Kit) reported that it
  could not determine the pose of people whose face was not visible, causing
  miscounts for people angled away from the camera. Sinclair, Kautai &
  Shahamiri, *Pūioio*, arXiv:2308.02420 §6 — https://arxiv.org/abs/2308.02420
  · RAW · LIMITED (preprint), but it is the only published observation of A1/A15
  biting in practice.
- A third-party blog comparing Apple Vision and MediaPipe on yoga images
  (including headstands) surfaced in search but could not be opened.
  UNVERIFIED — not used.

### 3.3 Answers

- *How does BlazePose handle upside-down bodies?* By design, through the
  alignment step (A2–A3), so the landmark network should see an inverted
  athlete as an upright figure with arms overhead — **if** the face-proxy
  detector fires and estimates the incline correctly. MODERATE for the
  mechanism. Whether it does on a side-view handstand, where the near arm
  partly covers an inverted face, is OPEN; the vendor flags sensitivity to face
  position and orientation (A8) and scopes out a non-visible head (A7).
- *Rotation robustness, yoga/handstand training data, known failures when the
  face is hidden or inverted?* Rotation range of the detector: unpublished.
  Training data: fitness-dominated; no pose breakdown. Face hidden: scoped out
  by the vendor, required by ML Kit, and observed failing in one preprint.
  Face inverted: nothing published.
- *Measured accuracy on handstands / inverted yoga?* No published measurement
  found for BlazePose, MediaPipe or MoveNet.
- *Does MoveNet handle inversion?* Its training set was extended specifically
  toward yoga/fitness poses (B2–B3), which is a statement of intent, not a
  result; it has no rotation normalisation (B6). OPEN.

### 3.4 What the app must measure (nothing published covers it)

1. Detection rate per sampled frame, side-view handstand, IMAGE mode, at the
   app's lowered confidence floors — for BlazePose and for MoveNet.
2. The same frames **pre-rotated 180°** before detection (and 90° for a clip
   recorded sideways), landmarks rotated back, compared on detection rate and
   on landmark position. Published precedent: Zwölfer (helped generic
   detectors) and Aguilar-Ortega (did not help MediaPipe on supine bodies).
3. Whether a sequential pass in VIDEO mode from the kick-up (upright start)
   keeps a lock that IMAGE mode cannot find. Caveat (INFERENCE): the tracker
   was trained with ~10% shift/scale between frames (A3), so it needs dense
   consecutive frames, not 0.33 s seeks.
4. Left/right label stability and elbow reading when the upper arms cover the
   ears.

---

## 4. Q2 — Horizontal and hanging bodies

| Finding | Source · status | Tier |
|---|---|---|
| Prone support is inside the vendors' stated domain: the GHUM card's own illustration is a side-view plank with occluded keypoints marked; MediaPipe's and ML Kit's rep-counting walkthroughs use push-ups; MoveNet's blog names push-ups among the poses its extra training data was added for. No accuracy figure accompanies any of these. | GHUM card p. 1 · RAW; pose-classification doc (mirror https://chuoling.github.io/mediapipe/solutions/pose_classification.html) · TOOL; ML Kit classifying-poses page · TOOL; MoveNet blog · TOOL | MODERATE (scope), no measurement |
| Lying on a couch (supine leg exercises), five cameras, OptiTrack reference, 27 people: some estimators returned no joints in many supine frames; MediaPipe's 2D angle error on the supine exercises was 13.4°; per camera its 2D angle MAE ranged 10.3°–14.0° with SDs of 13–21°; a failure example shows couch legs captured as ankles. | Aguilar-Ortega et al. 2023, Tables 4–7, Fig. 19 · TOOL | MODERATE (one lab; different joints and view from a lever) |
| Physiotherapy set emphasising supine and quadruped positions (25 people, Vicon): BlazePose world-coordinate body angles averaged 12.3° error, 3D MPJPE 100.3 mm; BlazePose often under-reads trunk tilt toward/away from the camera. | Leuthold, Xiloyannis & Zimmermann, arXiv:2512.06783, Table 5 — https://arxiv.org/abs/2512.06783 · TOOL | LIMITED (preprint; 3D, not 2D) |
| MediaPipe and HRNet vs Qualisys for knee and elbow angles, 22 people: good-to-excellent ICCs for each exercise except one sit-to-stand measure; coefficient of variation under 10%. Error magnitudes in degrees are not in the abstract. A search snippet of the full text (not the abstract record) says the video was sagittal and the tasks included prone knee flexion and standing elbow flexion — treat those two details as UNVERIFIED. | Hamilton et al., J Bodyw Mov Ther 40:315–319, 2024, DOI 10.1016/j.jbmt.2024.04.033, PMID 39593603 · ABSTRACT (full text returned 403) | LIMITED |
| A person lying on a sofa was not landmarked (legacy API); the only maintainer reply was to migrate APIs. | Issue #5276 — https://github.com/google-ai-edge/mediapipe/issues/5276 · TOOL | LIMITED (anecdote) |
| Push-up counting with a MoveNet-based commercial pipeline (phones on the floor): exact-count match 66.7–77.3% from the side, 81.8–85.7% from a 45° diagonal at 90–200 cm, 20–36.8% from the front. | Oliosi et al., JMIR mHealth uHealth 14:e82412, 2026, DOI 10.2196/82412, PMID 41813421, Table 2 — https://pmc.ncbi.nlm.nih.gov/articles/PMC12978916/ · TOOL | MODERATE for that pipeline |
| Pull-ups with BlazePose (ML Kit): 203 of 248 reps counted on 30 YouTube clips of mixed views; 153 counted for 150 performed in a two-person live test on the phone's front-facing camera (one set over-counted by 3). The notes column also records a set in a black long-sleeved top where detection struggled; the extracted table does not let me pair notes with rows. | Sinclair et al., arXiv:2308.02420, Tables 7, 10, 11 · RAW (tables partly garbled in text extraction) | LIMITED |
| Pull-up counting with HRNet keypoints plus a Hough-transform bar finder, reported 91.5% counting accuracy. | Wang, Chen & Duan, CSSE 2021 — seen only on a secondary index (https://aminer.org/pub/61caf8d491e0113fe21a9fa0/) · UNVERIFIED | — |

**Not found:** any measurement of wrist/hand landmark error when a bar or pole
crosses the hands; any measurement on a face-up horizontal hang (front lever)
beyond the classification F1 in §3.1 (front lever 0.74, OpenPose). The only
vendor statement bearing on bar occlusion is that occluders were *simulated* as
coloured rectangles in training (A11) — INFERENCE that a bar resembles one;
nothing measured.

**App must measure:** per-frame detection for a supine horizontal hang in
profile; wrist and hand landmark behaviour with the bar across the grip (the
app's hand-relative steadiness and its elbow reading both hang off the wrist);
whether the bar itself is ever captured as a limb.

---

## 5. Q3 — Frontal view of a horizontal body on a vertical pole (human flag)

- **Published, flag-specific:** only the OpenPose-based classifier in §3.1
  (human flag F1 0.83, joint third of nine skills). No landmark or angle
  accuracy. LIMITED.
- **Geometry (INFERENCE, consistent with the ledger's Rode et al. row):** seen
  from the front, a flag is a frontal-view body turned about 90° in the
  picture. Body line versus horizontal, lateral sag, elbow straightness of both
  arms and leg separation all lie in the image plane. Hip pike/arch and chest
  roll are depth, which the ledger already records as 2–3× worse.
- **Face dependence:** from the front the face is visible but rotated ~90°;
  from behind it is not visible. Given A1, A7, A15 and the Pūioio observation,
  the back view is the higher-risk recording for BlazePose. INFERENCE — measure
  both.
- **Left/right swap:** the only quantified report is for OpenPose on
  *sagittal* gait video — the limbs' left/right identity switched in about 5%
  of frames and was corrected by hand (Stenum, Rossi & Roemmich, PLoS Comput
  Biol 17(4):e1008935, 2021, DOI 10.1371/journal.pcbi.1008935, Methods —
  https://pmc.ncbi.nlm.nih.gov/articles/PMC8099131/ · TOOL · MODERATE for
  OpenPose). Nothing published for BlazePose or for a rotated frontal body; a
  tracker search for swapped left/right pose landmarks returned nothing
  specific. An open issue reports unsteady *rear-leg* tracking in side view
  (#4969 — https://github.com/google-ai-edge/mediapipe/issues/4969 · TOOL ·
  LIMITED).
- **Self-occlusion by the pole:** nothing published.

**App must measure:** detection front vs back; label stability over a hold;
whether the pole is read as an arm; and it must replace, not reuse, the
side-view gate (§10).

---

## 6. Q4 — Joint-angle validation against motion capture (new rows only)

The ledger already holds Rode et al. 2025 and Cabuk et al.; they are not
repeated. All figures below are other people's tasks and views.

| Study · status | Model / view / reference | Result | Tier |
|---|---|---|---|
| Wang, Smith & Zhu, PLoS One 18(10):e0293178, 2023, DOI 10.1371/journal.pone.0293178, PMID 37871043 (accepted text at arXiv:2310.07322) · RAW | BlazePose 3D world landmarks, one webcam ~4 m at chest height, ~15 fps effective; OptiTrack 10 cameras; 25 adults, standing ROM tests; subject turned side-on for flexion tests and front-on for abduction tests | Agreement with mocap (ICC; SEM): shoulder flexion 0.18 (9.7°), **elbow flexion 0.53 (11.7°, MDC 32.4°)**, shoulder abduction 0.68 (12.4°), shoulder extension 0.92 (3.3°), shoulder adduction 0.89 (4.0°), hip flexion 0.83 (5.2°), hip extension 0.84 (4.3°), hip flexion knee-bent 0.64 (5.7°), hip adduction 0.89 (3.4°), hip abduction 0.95 (2.7°). BlazePose's own test-retest ICCs were 0.79–0.98. The BlazePose angle trace flattened at the top of elbow flexion while the mocap trace kept rising. Wrist and ankle tests were dropped because hand and foot points were unreliable. Authors flag an all-black mocap suit as a confound. | MODERATE |
| Lafayette et al., Sensors 23(1):3, 2022, DOI 10.3390/s23010003, PMID 36616603 — https://pmc.ncbi.nlm.nih.gov/articles/PMC9824231/ · TOOL | MediaPipe on a Kinect V2 colour image, 30 Hz; Qualisys 6 cameras; 6 people; single-plane limb movements facing the sensors and turned 30° | Mean absolute error 8.57 ± 3.06° overall (upper limb 9.98 ± 3.79°, lower limb 7.16 ± 1.21°); RMS 16.68 ± 4.05° overall | LIMITED (n = 6) |
| Dill et al., Sensors 24(23):7772, 2024, DOI 10.3390/s24237772, PMID 39686309 — https://pmc.ncbi.nlm.nih.gov/articles/PMC11644880/ · TOOL | MediaPipe Pose, frontal + lateral phones at 30 fps, tripods ~1.3 m; Qualisys 11 cameras; 9 people, 810 squats | Lateral camera alone (MediaPipe's own 3D output), knee-angle RMSE (median): **10.7° near leg, 25.1° far leg**, which the authors explain by the near side hiding the far side. Frontal camera alone: reported only as much worse. Two-camera fusion: 10.3° / 7.7°. Joint position: monocular 56.3 mm vs fused 30.1 mm median RMSE | MODERATE |
| Baldinger, Reimer & Senner, Sensors 25(3):799, 2025, DOI 10.3390/s25030799, PMID 39943438 — https://pmc.ncbi.nlm.nih.gov/articles/PMC11819822/ · TOOL | **OpenPose** 2D, four cameras at 45° obliques (two front, two back), ~43 fps; Vicon 12 cameras; 16 people, front lunges | RMSE by joint across the four views: knee 15.5–29.4°, hip 15.2–25.3°, **elbow 29.4–37.1°**, shoulder 23.6–36.5°; elbow correlation 0.65–0.89; shoulder unsatisfactory from every view. Authors: viewing angle changes the estimate strongly, most at end range, and each camera angle must be validated per movement | MODERATE for OpenPose at oblique views; not BlazePose |
| Aguilar-Ortega et al. 2023 (§3.1) · TOOL | MediaPipe among eight estimators; five cameras; OptiTrack | MediaPipe 3D-angle error standing 11.96 ± 9.99° (best of the eight there); 2D-angle MAE by camera 10.3–14.0°; centre cameras best, side cameras worst for those exercises | MODERATE |
| Washabaugh et al., Gait Posture 97:188–195, 2022, DOI 10.1016/j.gaitpost.2022.08.008, PMID 35988434 · ABSTRACT | OpenPose, **MoveNet Thunder**, MoveNet Lightning, DeepLabCut; sagittal gait; 32 adults | Hip MAE 3.7 ± 1.3° (OpenPose) and 4.6 ± 1.8° (MoveNet Thunder); knee 5.1 ± 2.5° (OpenPose) | MODERATE (upright gait) |
| Stenum et al. 2021 (§5) · TOOL | OpenPose, sagittal gait, 25 Hz, camera 3.3 m away at 1.3 m | MAE hip 4.0°, knee 5.6°, ankle 7.4° | MODERATE |
| Leuthold et al. 2025 (§4) · TOOL | BlazePose world coordinates | 12.3° mean body-angle error | LIMITED |
| Hamilton et al. 2024 (§4) · ABSTRACT | MediaPipe, sagittal | Good-to-excellent ICC incl. standing elbow flexion | LIMITED |

**View-angle dependence, summarised.** In-plane, upright, sagittal gait
(OpenPose, MoveNet): roughly 4–7°. Mixed clinical ROM tasks with MediaPipe:
roughly 7–14° mean, RMS near 17°. Far-side limb from a lateral camera: about
25°. A 45° oblique camera (OpenPose): 15–37° depending on the joint. That
ordering matches the ledger's Rode et al. finding and the cause it names
(projective geometry).

**Disagreements to keep visible.**

- *Elbow.* Wang et al. found elbow flexion among the worst (ICC 0.53) and saw
  the reading saturate at full flexion; Hamilton et al. report good-to-excellent
  agreement for standing elbow flexion (abstract only); Baldinger et al. report
  29–37° RMSE at oblique views with a different model. The ledger's flagged
  elbow claim also failed verification. Conclusion unchanged: elbow accuracy is
  condition-specific and unsettled, and none of these is a straight-arm hold.
- *Best camera.* Aguilar-Ortega et al. found frontal/centre cameras best; Dill
  et al. found the frontal camera worst and the lateral best. Each is right for
  its own plane of motion.
- *Vendor PDJ.* The two published versions of the GHUM card give 91.8 and 96.6
  for the full model. Neither describes IMAGE mode.

**Why PCK/PDJ cannot stand in for angle accuracy (INFERENCE, arithmetic).** PDJ
accepts a keypoint within 20% of torso size (A10). With a 0.5 m torso that is
10 cm, which on a 0.26–0.30 m forearm is up to about 18–21° of segment
direction. A model can score 96% PDJ and still be far outside a 5–10° form
tolerance.

---

## 7. Q5 — Rep counting and judging dynamic reps

### 7.1 Established methods

| Method | Source · status | Tier |
|---|---|---|
| Classify each frame into terminal poses (k-NN over pairwise joint distances after normalising torso size and orientation), smooth the class probability with an exponential moving average, and count with **two thresholds** — enter at one level, exit at a slightly lower one — so a probability hovering at the line cannot double-count. Demonstrated on push-ups and squats; advises a few hundred samples per terminal state across camera angles. | MediaPipe *Pose Classification* doc (mirror) · TOOL; ML Kit classifying-poses page (about 100 samples per class) — https://developers.google.com/ml-kit/vision/pose-detection/classifying-poses · TOOL | MODERATE (vendor method) |
| Joint-angle thresholds (lower/upper) map each frame to Top / Intermediate / Bottom; a state machine counts only a complete cycle; a short sliding window votes on the phase; optical flow substitutes when landmark in-frame likelihood drops below 0.75. | Sinclair et al., arXiv:2308.02420 §3 · RAW | LIMITED |
| Count when the joint angle crosses the middle of the expected range; mark the rep valid only if it also reaches the end ranges. | Alatiah & Chen, arXiv:2005.03194 — https://arxiv.org/abs/2005.03194 · TOOL | LIMITED |
| Represent each action by two salient poses; a trigger with upper and lower score bounds counts when both occur in order. Runs BlazePose on every frame. | Yao, Cheng & Zou, *PoseRAC*, arXiv:2303.08450 §5.1 — https://arxiv.org/abs/2303.08450 · TOOL | LIMITED–MODERATE |
| Frame-state classifier plus a Markov-chain transition model. | Oliosi et al. 2026, Methods · TOOL | MODERATE |
| Peak picking on the angle signal after outlier removal (seasonal decomposition, 3-SD residuals); Savitzky–Golay or low-pass (5 Hz Butterworth) smoothing before angle analysis. | Wang et al. 2023 (peak picking) · RAW; Baldinger et al. 2025 and Stenum et al. 2021 (smoothing) · TOOL | MODERATE |
| Class-agnostic video counting from a temporal self-similarity matrix: 64 frames in, predicted period between 2 and 32 frames, video replayed at 1–4× speeds to fit. | Dwibedi et al., *RepNet*, CVPR 2020, arXiv:2006.15418 — https://arxiv.org/abs/2006.15418 · TOOL | MODERATE (not pose-based) |

### 7.2 Sampling rates actually used

Every pose-based source opened processed the native video rate or close to it:
15 fps (Wang, by hardware limit, with slow deliberate movements), 24 fps
(calisthenics dataset), 24–30 fps (Alatiah & Chen), frame by frame at the
clip's own rate (PoseRAC, Pūioio), 25 Hz (Stenum), 30 fps (Oliosi, Dill,
Lafayette), ~43 fps (Baldinger). RepNet's design needs at least two sampled frames per period.
**No source sampled anywhere near 3 a second for rep or ROM work.**

On frame rate itself: comparing 30 and 120 fps on the same 2D landing and
cutting tasks changed measured peak frontal-plane knee angle by about 2.2–3.5
(degrees implied; the table prints no unit), and the authors state that no
standard guideline exists for choosing a rate
(Alenzi et al., J Clin Med 14(5):1687, 2025, DOI 10.3390/jcm14051687, PMID
40095676 — https://pmc.ncbi.nlm.nih.gov/articles/PMC11901006/ · TOOL ·
MODERATE; fast tasks, manual digitising). A university teaching handout treats
30 Hz as enough for knee flexion in running (Mercer, UNLV, *Kinematic Analysis*
— https://jmercer.faculty.unlv.edu/wp-content/uploads/2026/07/Kinematic-Analysis-Instrumentation.pdf
· RAW · CONSENSUS). The BASES video-analysis guidelines (Payton) could not be
opened — UNVERIFIED, not used.

### 7.3 Minimum rate for a 2–4 s strength rep (INFERENCE — derivation, not a citation)

Two separate questions:

**Counting.** Sampling theory needs more than two samples per cycle, so 3/s can
in principle count reps slower than about 0.7 s. A hysteresis counter is
stricter: it needs at least one sample inside each end zone. For a smooth
(sinusoidal) rep the body spends 37% of the cycle beyond a 70%-of-range
threshold and 30% beyond an 80% threshold, so at 3/s one sample per zone is
guaranteed only for reps slower than about 0.9–1.1 s, and *two* samples per zone
(the minimum for any noise rejection) only for reps slower than about 1.8–2.3 s.

**Depth and lockout.** The nearest sample can miss the turning point by half a
sample interval. Worst-case under-reading of the extreme, for a 90° range of
motion, bounded by a smooth turnaround (sinusoid) and an abrupt one (constant
speed, instant reversal):

| Samples / s | 1 s rep | 2 s rep | 3 s rep | 4 s rep | Samples within the last 10% of range (2 s rep, smooth) |
|---|---|---|---|---|---|
| 3 | 22.5° – 30° | **6.0° – 15°** | 2.7° – 10° | 1.5° – 7.5° | 1.2 |
| 5 | 8.6° – 18° | 2.2° – 9° | 1.0° – 6° | 0.6° – 4.5° | 2.0 |
| 7.5 | 3.9° – 12° | 1.0° – 6° | 0.4° – 4° | 0.3° – 3° | 3.1 |
| 10 | 2.2° – 9° | 0.6° – 4.5° | 0.3° – 3° | 0.1° – 2.3° | 4.1 |
| 15 | 1.0° – 6° | 0.3° – 3° | 0.1° – 2° | 0.1° – 1.5° | 6.1 |
| 30 | 0.3° – 3° | 0.1° – 1.5° | <0.1° – 1° | <0.1° – 0.8° | 12.3 |

Formulae: smooth = A·(1 − cos(π·Δt/T)) with A = half the range; abrupt =
range·Δt/T. A pause at the top or bottom shrinks these; a bounce enlarges them.

This is sampling error only. Landmark noise adds to it: the app's own measured
jitter (about 1.5–2% of torso per landmark, per `CLAUDE.md`) works out to
roughly 3° on a single segment direction in a single frame, so one sample at an
extreme cannot support a verdict however well timed. The static-hold persistence
rule (about a second of agreeing samples) has no equivalent at a turning point
that lasts a fraction of a second.

**Reading:** at the current 3/s the app could plausibly *count* slow reps but
cannot honestly *grade* bottom depth or lockout. Something like 10–15 samples a
second around each turning point (a coarse pass to find reps, then a dense pass
of a few tenths of a second either side of each extreme) is the smallest design
the arithmetic supports for 2-second reps. Treat that as a hypothesis to test,
not a specification.

### 7.4 Reported accuracy (none transferable)

| Source · status | Setup | Result | Tier |
|---|---|---|---|
| Oliosi et al. 2026 · TOOL | 44 students, 12 phone placements, ~1,320 reps per exercise, two human raters as reference, MoveNet-based commercial pipeline | Exact-count match 61.1% (push-ups) and 61.5% (squats) overall, MAE about 1.1 reps; best cells 85.7% (push-up, diagonal, 90–180 cm) and 95.5% (squat, diagonal, 200 cm); squats from the side 0–36% | MODERATE |
| Sinclair et al. 2023 · RAW | BlazePose via ML Kit | YouTube clips (30 per exercise): squats 172/174, push-ups 192/248, pull-ups 203/248. Live, two people, 450 reps: 451 counted | LIMITED |
| Yao et al. 2023 (PoseRAC) · TOOL | RepCount-pose benchmark | MAE 0.236, off-by-one accuracy 0.560 (previous best 0.443 / 0.291); with ViTPose instead of BlazePose 0.305 / 0.463 | LIMITED–MODERATE |
| Dwibedi et al. 2020 (RepNet) · TOOL | Countix test set | MAE 0.364, off-by-one **error** 0.303 (this paper reports the share of videos *not* within one count, so lower is better — the opposite convention to PoseRAC's off-by-one accuracy above); known failure: half-counting | MODERATE |
| Alatiah & Chen 2020 · TOOL | OpenPose, push-ups / pull-ups / squats | Counter error within ±1 rep, metric undefined | LIMITED |

**Range-of-motion (depth) grading from pose:** I found no validation of
bottom-depth or lockout grading for push-ups, handstand push-ups, pike
push-ups or pull-ups against any reference. The nearest evidence is Wang et
al.'s observation that BlazePose under-reports the top of elbow flexion —
which, if it held on a phone, would bias depth readings toward "not deep
enough". OPEN.

**App must measure:** (1) record reps at 30 fps or more, compute extremes at
full rate, then subsample to 3 / 5 / 10 / 15 per second and report the error in
depth, lockout and count — this needs no new hardware; (2) depth by elbow angle
versus depth by head-to-hand height, against hand-drawn landmarks on the same
frames; (3) whether MoveNet's persisted crop (B7) clips a moving body between
samples; (4) detection continuity through the fastest part of the rep.

---

## 8. Q6 — Camera placement for single-camera 2D analysis

| Recommendation / finding | Source · status | Tier |
|---|---|---|
| Put the lens axis perpendicular to the plane of the movement; move the camera back and zoom rather than standing close; keep the movement in the centre of the picture because the edges distort; do not move the camera after calibrating. | Mercer, UNLV handout · RAW | CONSENSUS (teaching practice) |
| A 2D tool was accurate from 90° down to 45° at 5 m **when a perspective grid was calibrated in the plane of motion**; horizontal coordinate error grew from about 1.4 mm at 90° to about 5.4 mm at 45°; the authors recommend 90°. Test object was a flat printed figure, not a person. | Puig-Diví et al., PLoS One 14(6):e0216448, 2019, DOI 10.1371/journal.pone.0216448, PMID 31166989 — https://pmc.ncbi.nlm.nih.gov/articles/PMC6550386/ · TOOL (per-angle means computed by the reader from Table 1) | MODERATE |
| Angles computed from x and y alone change with the angle between subject and camera; best results come from a level, head-on image. | ML Kit classifying-poses page · TOOL | MODERATE (vendor) |
| Deviation from perpendicular, camera height and distance all affect results; spatial measures are most accurate mid-frame and degrade toward the edges through perspective. Setup used: 3.3 m away, 1.3 m high. | Stenum et al. 2021, Discussion/Methods · TOOL | MODERATE |
| Viewing angle changes joint-angle estimates strongly, especially at end range; validate each camera angle for each movement. | Baldinger et al. 2025 · TOOL | MODERATE |
| Distance: vendor validation images had the person 2–4 m away and beyond ~4 m is out of scope (BlazePose); MoveNet is described as best at 3–6 ft from a webcam; a MoveNet-based counter did best at 180–200 cm and worse at 90 and 360 cm. | Legacy Pose doc · TOOL; GHUM card · RAW; MoveNet card · RAW; Oliosi et al. 2026 · TOOL | LIMITED–MODERATE |
| Whole body in frame: detection works best with the entire body visible; the landmark crop expects a full body with about 25% margin; a counter miscounted clips with partly visible bodies. | ML Kit pose page · TOOL; GHUM card p. 4 · RAW; Sinclair et al. §6 · RAW | MODERATE |
| Camera height: no primary recommendation found beyond levelling the camera and centring the movement. Heights used ranged from the floor (Oliosi) to about 1.3 m (Stenum, Dill) and chest height (Wang). | — | OPEN |

**Disagreement.** Oliosi et al. found the 45° diagonal best for counting and
the pure side view worst for squats; the 2D-analysis sources above say
perpendicular. They answer different questions: a diagonal shows both sides of
the body to the detector (better detection, better counting), while any
departure from perpendicular projects the joint angle (worse measurement —
Baldinger's 45° views gave 15–37° RMSE). For a judge that grades angles, the
perpendicular rule governs; for a counter that only needs states, a small yaw
may help detection. The app's existing width-ratio gate already encodes a
tolerance; it would need re-measuring per skill, not loosening by analogy.

**Can a front view measure frontal-plane angles?** Yes when the segments stay
in the image plane, no when the task rotates out of it:

- Front-on recordings of frontal-plane movements agreed well with mocap for hip
  abduction (ICC 0.95), hip adduction (0.89) and shoulder adduction (0.89),
  less well for shoulder abduction (0.68). Wang et al. 2023, Table 2 · RAW ·
  MODERATE (3D output, standing).
- In a single-leg squat, 2D frontal-plane angles correlated poorly with 3D
  (knee r = 0.31; trunk, hip, ankle not significant; mean differences up to
  about 8.7°), while sagittal angles agreed within about 0.7–3.1°. The authors
  point to rotations a 2D view cannot see. Schurr et al., Int J Sports Phys Ther
  12(2):163–172, 2017, PMID 28515970 —
  https://pmc.ncbi.nlm.nih.gov/articles/PMC5380858/ · ABSTRACT · MODERATE.
- A frontal camera was the worst single view for a sagittal angle (knee flexion
  in squats). Dill et al. 2024 · TOOL · MODERATE.

For the flag this supports measuring the body line, lateral sag and arm
straightness from the front, and refusing anything that is hip flexion or
trunk roll.

---

## 9. Q7 — Do `visibility` / `presence` indicate occluded joints?

| Fact | Source · status | Tier |
|---|---|---|
| Definitions: `visibility` is the probability that the keypoint is inside the frame **and** not occluded by a larger body part or an object; `presence` is the probability it is inside the frame, saying nothing about occlusion. Both are raw outputs that need a sigmoid. | GHUM model card pp. 1 and 8 · RAW. The JS API reference gives the shorter form (visible within the image; present within image bounds, unset when the model has no presence output) — https://developers.google.com/edge/api/mediapipe/js/tasks-vision.normalizedlandmark · TOOL | MODERATE |
| How it was trained: a per-point visibility classifier, with occlusions simulated by random coloured rectangles; hidden points labelled by annotators' best guess. | Paper §2.6 · TOOL; card p. 3 · RAW | MODERATE |
| Visibility agreement is folded into PDJ (A10); no separate figure for visibility accuracy is published. | Card p. 5 · RAW | MODERATE (absence) |
| Asked on the tracker how the scores are computed and how far they can be trusted, Google staff were assigned and never answered. | Issue #4959 — https://github.com/google-ai-edge/mediapipe/issues/4959 · TOOL | LIMITED |
| On a report of confident landmarks for a hand hidden behind the back, a Google collaborator replied that the issue was outside the Pose Landmarker's scope because it cannot detect occlusions. | Issue #5806 (2025-01-07) — https://github.com/google-ai-edge/mediapipe/issues/5806 · TOOL | LIMITED (informal, about hands, multi-person) |
| In the legacy Python solution `presence` was deliberately cleared to zero; a contributor explained that visibility serves a similar purpose. | Issue #1790 — https://github.com/google-ai-edge/mediapipe/issues/1790 · TOOL | MODERATE |
| The web package returned no visibility at all in 0.10.0; a fix was merged (PR #5142) and a maintainer pointed to a 0.10.12 nightly. The app's rule that an absent visibility counts as unseen is the right defence. | Issues #4409, #4479 — https://github.com/google-ai-edge/mediapipe/issues/4409 · TOOL | MODERATE |
| In a 25-person validation a visibility floor of 0.5 removed frames in only four trials (0.13%), yet elbow flexion agreed poorly with mocap and the authors show elbow and wrist points visibly off at full flexion. | Wang et al. 2023, Methods and Discussion · RAW | LIMITED. My reading: high visibility did not mean accurate position in that setup |
| The far leg in a lateral view carried 25.1° knee-angle error against 10.7° for the near leg; the paper does not report what visibility those landmarks had. | Dill et al. 2024 · TOOL | MODERATE (error), OPEN (visibility) |
| MoveNet: outputs every keypoint even when occluded; confidence falls for keypoints outside the frame. Its score is an in-frame/confidence signal, not an occlusion flag. | MoveNet card p. 2 · RAW | MODERATE |

**Answer.** By definition visibility is meant to drop for occluded joints, and
it is trained to. Whether it does so *reliably* — against a bar, a pole, the
torso hiding the far arm — is unpublished; the one maintainer statement on
record says the task cannot detect occlusions, and one validation study suggests
visibility can stay high while position is wrong. OPEN. The two backends'
scores do not mean the same thing, so one threshold cannot serve both.

**App must measure:** on its own footage, label joints as seen / hidden (far
arm behind torso, wrist behind bar, hand on pole) and plot visibility against
(a) the label and (b) distance from a hand-drawn landmark. Until then
`unseen` should keep meaning *insufficient evidence*, never *confirmed
occluded*.

---

## 10. Code-level flags found while checking the questions against the app

These are INFERENCE from the app's own documented assumptions, not literature.

1. **`floorEdge` (`src/lib/poseForm.ts`, around lines 1426–1491).** Its comment
   states that every graded position is a support hold whose trunk lies across
   gravity and whose hands are below the shoulders. With the new skills:
   a handstand or handstand push-up has a truly vertical trunk (≥ 68° would be
   read as *phone on its side*); a front lever has arms pointing up to the bar
   (≥ 120° would be read as *upside down*); a human flag's top arm points up and
   sideways; a pike push-up's trunk can approach the 68° line. Orientation can
   no longer be read from the body without knowing the skill. Any replacement
   threshold has to be measured the way these were.
2. **Side-view gate (`apparentBodyWidthRatio`, `MAX_SIDE_VIEW_RATIO = 0.42` in
   `src/lib/poseBackend.ts`).** It refuses front-on bodies. The human flag needs
   a front-on body, so the flag needs the opposite gate (a minimum width), again
   measured.
3. **Sampling (`chooseSampleCount`, 3 per second, cap 120).** Sized for holds;
   §7.3 applies to reps.
4. **MoveNet crop persistence** (B7) across seeks and between clips.
5. **IMAGE mode** (A6) means published tracking-mode accuracy does not apply.

---

## 11. Searched and not found

No published measurement was found for each of the following. Queries were run on
2026-11-17 through a general web search, Europe PMC's REST search, arXiv /
ar5iv, and the GitHub issue-search API for `google-ai-edge/mediapipe` and
`tensorflow/tfjs`:

- BlazePose / MediaPipe / MoveNet accuracy on handstands or inverted yoga
  (terms: handstand, headstand, inverted, upside down, gymnastics, rotation).
  Tracker search for *handstand*: zero issues. *upside down*: four, one
  relevant (#5295).
- Front lever, human flag, pole or aerial apparatus pose estimation: only the
  OpenPose classification paper in §3.1.
- Wrist/hand landmark error with a bar or pole across the grip.
- Left/right label swaps for BlazePose (tracker search returned nothing
  specific).
- Push-up, handstand push-up or pike push-up elbow-angle validity against
  motion capture for any model.
- Depth / lockout grading validity for any pose-based rep system.
- Calibration of the visibility score against true occlusion.
- Any pose-based rep or ROM analysis sampled below 15 frames a second.
- A primary recommendation for camera height.

Could not open: BASES/Payton video guidelines (paywalled chapter); the CSSE 2021
pull-up paper; Hamilton et al. full text (403); MDPI and one university
repository (403 / bot wall — read instead through Europe PMC full text); a
SportRxiv preprint surfaced by search (403).

---

## 12. Proposed additions to "what the app must not claim"

15. That the camera judge is validated for handstands, levers, flags or
    push-up variants because the model was *trained on yoga and fitness* — the
    training mix is undisclosed and no inversion result is published.
16. The vendor's PDJ / PCK@0.2 figures (91.8, 96.6, 95.5 …) as accuracy for
    this app: tracking mode, private data, 20%-of-torso tolerance.
17. Any rep-counting accuracy from the literature (98.9%, off-by-one 0.56 …)
    as this app's; and any depth or lockout verdict as measured until the
    sampling study in §7.4 exists.
18. That a joint was "hidden" or "seen" on the strength of the visibility
    score alone.
19. That 2–4 m, a 45° diagonal, or any camera height is *validated* placement —
    each is one source's operating condition.
20. Anything from the front view of a flag about hip pike, arch or body roll.

---

## 13. Sources opened this pass

Vendor / primary documentation

- Bazarevsky et al., *BlazePose: On-device Real-time Body Pose tracking*, arXiv:2006.10204 — https://arxiv.org/abs/2006.10204 · TOOL
- Google Research blog, 13 Aug 2020 — https://research.google/blog/on-device-real-time-body-pose-tracking-with-mediapipe-blazepose/ · TOOL
- Model Card, MediaPipe BlazePose GHUM 3D (16 Apr 2021) — https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf · RAW
- Same card, 22 Jun 2021 version hosted by ML Kit — https://developers.google.com/static/ml-kit/images/vision/pose-detection/pose_model_card.pdf · RAW
- Pose Landmarker guide and web guide — https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker , `/web_js` · TOOL
- JS API reference: `NormalizedLandmark`, `PoseLandmarker` — https://developers.google.com/edge/api/mediapipe/js/tasks-vision.normalizedlandmark · TOOL
- Legacy MediaPipe Pose and Pose Classification docs (via mirror) — https://chuoling.github.io/mediapipe/solutions/pose.html , `/pose_classification.html` · TOOL
- ML Kit pose detection and classifying-poses pages — https://developers.google.com/ml-kit/vision/pose-detection · TOOL
- MoveNet.SinglePose Model Card — https://storage.googleapis.com/movenet/MoveNet.SinglePose%20Model%20Card.pdf · RAW
- TensorFlow blog, MoveNet launch, 17 May 2021 · TOOL; TF Hub MoveNet tutorial · RAW; TFJS `movenet/detector.ts` · TOOL
- npm registry record for `@mediapipe/tasks-vision` (latest was 1.2.3 on the day, so a 1.x line exists; individual versions were not listed) · TOOL
- GitHub issues #808, #1790, #2018, #2209, #4409, #4462, #4479, #4868, #4959, #4969, #5276, #5295, #5806 · TOOL

Peer-reviewed and preprints: listed with DOI / PMID / arXiv id at first use in
§§3–9.

---

## 14. Per-skill table

Everything in the "can measure" column is conditional on the app first passing
the checks in the "must verify" column on real footage. Basis for the view
column: the ledger's Rode et al. row plus §8. All cells are INFERENCE unless a
section is cited.

| Skill | Recommended view | What one phone camera can honestly measure | What it cannot | What the app must verify itself | Fallback when it cannot be measured |
|---|---|---|---|---|---|
| **Front lever** (hanging, horizontal, face up) | Perpendicular side view, lens about level with the body, bar and whole body in frame with margin, inside the vendor's ≤ 4 m scope | Hold time; torso angle to horizontal; hip angle (pike/arch); knee extension (tuck vs straight); elbow bend in the picture plane; drift relative to the hands | Scapular position; straddle width and anything else in depth; roll about the body's long axis; grip; an elbow bending toward the camera | Per-frame detection of a supine horizontal hang in IMAGE mode, both backends (§4); wrist and hand landmarks with the bar across the grip; visibility behaviour at the bar (§9); a hanging-aware replacement for `floorEdge` (§10); far-arm handling re-measured for vertical arms | Refuse the criterion as `unseen`; log the hold on the stopwatch and the athlete's own rating; offer the replay with landmarks drawn, no verdict |
| **Human flag** (horizontal, on a vertical pole) | Front-on, chest toward the camera, perpendicular to the plane of pole and body, lens about level with the body | Hold time; body line versus horizontal; lateral sag at the hips; straightness of both arms (both lie in the picture plane); leg separation up/down | Hip pike or arch, chest roll, any shoulder detail — all depth (ledger: 2–3× worse); which way the hips are turned | Detection with the face rotated ~90°, and front versus back view (§5, A1/A7/A15); left/right label stability; whether the pole is read as a limb; a *minimum*-width gate replacing the side-view gate (§10); orientation logic without `floorEdge` | Same as above. If only a back view is available and detection is unreliable, time-only |
| **Handstand** (inverted, static) | Perpendicular side view, phone upright (portrait) so hands and feet both fit, lens near the middle of the body's height, far enough for a margin | Hold time; stacking of wrist–shoulder–hip–ankle against vertical; shoulder angle (open/closed); hip angle (pike/arch as one shoulder–hip–ankle angle); knee extension; elbow bend in the picture plane; sway relative to the hands | Sideways lean and left/right asymmetry; where in the spine an arch comes from (there are no spine landmarks); wrist and finger corrections; head position with confidence when the arms cover the ears | Detection of an inverted body with a partly covered face in IMAGE mode (§3.4); whether pre-rotating the frame 180° helps; whether a continuous VIDEO-mode pass from the kick-up helps; MoveNet with no rotation step; a skill-aware `floorEdge` (a vertical trunk is the correct picture here) | `unseen` for form; timer plus self-rating; replay for the athlete's own review |
| **Handstand push-up / pike push-up** (dynamic) | Perpendicular side view as for the handstand (pike push-up: lens lower, about hip height at the bottom of the rep) | Rep count for slow reps; tempo; top lockout and bottom depth **only after** the sampling study (§7.3–7.4); body line through the rep (hip angle); head height relative to the hands as a second depth measure | Elbow flare (toward the camera); whether the head touched (contact is not observable, only proximity); scapular movement; depth to better than about 6–15° at the present 3 samples a second | Subsampling study on the app's own 30 fps footage (count, depth, lockout at 3 / 5 / 10 / 15 per second); depth by elbow angle versus by head height against hand-drawn landmarks; detection through the fast phase; MoveNet crop persistence across samples; Wang et al.'s flattening at deep elbow flexion on phone footage | Count only, with depth self-reported; or no count and a replay stepped to each turning point for the athlete to confirm |
| **90° hold** (bent-arm planche) | Perpendicular side view, as the planche today | Hold time; torso angle to horizontal; hip and knee line; near-arm elbow angle (target about 90°, in the picture plane); forearm angle to vertical; shoulder position relative to the hands; feet clear of the floor; drift | Far arm (fully hidden by the torso); whether the elbows are resting on the trunk (contact is not observable); wrist turn-out; scapular position | Elbow-angle error at about 90° with the upper arm overlapping the torso — the existing signed-bend tolerances were measured near lockout and need re-measuring here; how often the far arm is `unseen` and whether single-arm grading is acceptable for this skill | `unseen` elbows block credit as now; timer plus self-rating |
