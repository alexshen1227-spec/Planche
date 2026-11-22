import type { Kp } from './poseBackend'
import type { JudgeInput } from './poseForm'

/**
 * Landmarks the real pose model produced from real photographs.
 *
 * Synthetic poses prove the judge's reasoning is sound; they cannot prove its
 * numbers describe actual human beings. These do. Each entry is what MediaPipe
 * BlazePose actually returned for a freely-licensed photograph of the position
 * named — captured once through the app's own pipeline (same model, same
 * rotation probe) and frozen here, so the whole thing replays in a unit test
 * with no camera, no network and no 9 MB download.
 *
 * Stills rather than clips on purpose: with no frame-to-frame movement, any
 * disagreement is systematic — a landmark the model places badly on a
 * horizontal body, or a threshold that was never true of real proportions —
 * rather than one unlucky frame. Real footage measured separately puts
 * frame-to-frame landmark jitter at roughly 1.5–2% of torso length, which is
 * what the synthetic eval's noise levels are set from.
 *
 * Sources, all Wikimedia Commons:
 *  - plancheLean:  "Planche.jpg"
 *  - plank:        "Girl doing push-ups from the side.jpg"
 *  - straddleOffAxis: "Straddle planche 2 doigts.jpg"
 *  - flagVertical: "Competición de Tensión.jpg"
 *  - weightedPullup: "Competición de Fuerza.jpg"
 *  - lsitCroppedHead: "Figura L-Sit na paraletkach.jpg"
 *
 * The last three are deliberate negative controls — none of them is a side-on
 * planche, and each was inspected by eye before being trusted as ground truth.
 * They exist to prove the judge refuses or at least never cleanly passes what
 * it cannot honestly grade, on photographs nobody tuned a threshold against.
 *
 * Handstand, flag and front lever, also Wikimedia Commons unless said:
 *  - handstandStraight: "Handstand (119653409).jpeg"
 *  - handstandOnWedge: "Incline handstand.jpg"
 *  - handstandSilhouette: "Handstand beach.jpg"
 *  - handstandArched: "Handstand with arch.jpg"
 *  - handstandFromBehind: "Guy doing handstand.jpg"
 *  - handstandStraddleFront: "Handstand-2.jpg"
 *  - flagLevel: "Human Flag von Sven Kohl (Calisthenic Movement), 2013.jpg"
 *  - flagAngledDown: "(the flag) - Flickr - mederndepe.jpg"
 *  - poleHoldUpright: "Вертикальний.jpg"
 *  - flagBentTopArm: "Flag3.jpg"
 *  - flagOnFrame: "Paralel flag.jpg"
 *  - flagOnBars: "5 human flag.jpg"
 *  - flagSlightlyLow: "Human Flag by Romans Janovics in Daugavpils, Latvia.jpg"
 *  - flagOblique: "Human Flag on a Tree.jpeg"
 *  - flagFoldedArms: "Nan Palmero Human Flag", by nan palmero on Flickr (CC BY 2.0)
 *  - flagFeetHigh: "Human Flag - Calisthenics", by BUSY PARENT FITNESS on Flickr (CC BY 2.0)
 *  - frontLeverRings: "Donauinsel Hangwaage.jpg"
 *  - frontLeverThreeQuarter: "Front lever - Serhii Solodkyi 18280.jpg"
 *  - frontLeverFromBelow: "John Gill - Front Lever - 1962.JPG"
 *
 * Only the landmark numbers the model produced are kept — no image, no face
 * points. Each truth below was written by looking at the photograph with those
 * landmarks drawn over it, and says so where the eye could not settle
 * something (the silhouette's arms). Side-on front levers are scarce among
 * freely-licensed photographs: there is one, and the thresholds that rest on
 * it are set well clear of it for that reason.
 */

interface RealPose {
  /** What the photograph actually shows, established by looking at it. */
  truth: string
  width: number
  height: number
  /** Orientation the model's own probe chose for this frame. */
  rotation: 0 | 90 | 270
  points: [name: string, x: number, y: number, score: number][]
}

export const REAL_POSES: Record<string, RealPose> = {
  // Real BlazePose landmarks from a real photo of a clean full planche:
  // Wikimedia Commons, File:Planche.jpg, by Jonathanfv, CC BY 3.0
  // (https://commons.wikimedia.org/wiki/File:Planche.jpg). Landmark numbers
  // only, from the 1280px rendition; no image is stored.
  fullPlancheCommons: {
    truth:
      'Full planche on the floor, side-on, arms locked, body level and held clean (Wikimedia Commons File:Planche.jpg by Jonathanfv, CC BY 3.0).',
    width: 1280,
    height: 790,
    rotation: 0,
    points: [
      ['left_ear', 122.5, 332.7, 1],
      ['right_ear', 122.2, 326.4, 1],
      ['left_shoulder', 240.8, 355.9, 1],
      ['right_shoulder', 268.1, 306.1, 1],
      ['left_elbow', 380.4, 498.5, 0.995],
      ['right_elbow', 434, 450.3, 0.377],
      ['left_wrist', 519, 650.1, 0.992],
      ['right_wrist', 548, 595.1, 0.437],
      ['left_hip', 580.3, 324, 0.999],
      ['right_hip', 590.4, 296.3, 0.999],
      ['left_knee', 859.7, 330.4, 0.891],
      ['right_knee', 857.2, 314.7, 0.163],
      ['left_ankle', 1135.2, 333.9, 0.895],
      ['right_ankle', 1116.7, 315.8, 0.352],
    ],
  },
  plancheLean: {
    truth:
      'Side-on, arms locked, legs straight, body level, shoulders far past the hands. Nothing to correct.',
    width: 1280,
    height: 790,
    rotation: 0,
    points: [
      ['left_ear', 122.5, 332.7, 1],
      ['right_ear', 122.2, 326.4, 1],
      ['left_shoulder', 240.8, 355.9, 1],
      ['right_shoulder', 268.1, 306.1, 1],
      ['left_elbow', 380.4, 498.5, 0.995],
      ['right_elbow', 434, 450.3, 0.377],
      ['left_wrist', 519, 650.1, 0.992],
      ['right_wrist', 548, 595.1, 0.437],
      ['left_hip', 580.3, 324, 0.999],
      ['right_hip', 590.4, 296.3, 0.999],
      ['left_knee', 859.7, 330.4, 0.891],
      ['right_knee', 857.2, 314.7, 0.163],
      ['left_ankle', 1135.2, 333.9, 0.895],
      ['right_ankle', 1116.7, 315.8, 0.352],
    ],
  },
  plank: {
    truth:
      'Side-on plank on push-up handles: straight body, shoulders stacked over the hands rather than leaning past them.',
    width: 1280,
    height: 853,
    rotation: 270,
    points: [
      ['left_ear', 1115.4, 199.5, 1],
      ['right_ear', 1115.1, 199.6, 1],
      ['left_shoulder', 993.7, 273.6, 0.999],
      ['right_shoulder', 993.3, 270.7, 1],
      ['left_elbow', 912.6, 394.8, 0.238],
      ['right_elbow', 875.9, 383.4, 0.973],
      ['left_wrist', 966.1, 502.6, 0.263],
      ['right_wrist', 951.2, 530.3, 0.94],
      ['left_hip', 693.1, 375, 0.998],
      ['right_hip', 676.7, 372.5, 1],
      ['left_knee', 657.9, 430.7, 0.344],
      ['right_knee', 401.1, 458, 0.981],
      ['left_ankle', 564, 473.9, 0.48],
      ['right_ankle', 124.3, 494.4, 0.978],
    ],
  },
  flagVertical: {
    truth:
      'A human flag on a vertical ladder: body horizontal but supported sideways, chest square to the camera. Not a planche and not a side view — it must be refused, not graded.',
    width: 640,
    height: 960,
    rotation: 270,
    points: [
      ['left_ear', 487.2, 562.9, 1],
      ['right_ear', 493.9, 626, 1],
      ['left_shoulder', 424.5, 500.8, 0.999],
      ['right_shoulder', 438, 680.7, 0.999],
      ['left_elbow', 491.8, 361.6, 1],
      ['right_elbow', 522, 790.7, 0.995],
      ['left_wrist', 567.7, 234.5, 0.999],
      ['right_wrist', 617, 881.8, 0.954],
      ['left_hip', 247.8, 574.8, 0.998],
      ['right_hip', 258.2, 653.5, 0.997],
      ['left_knee', 194.8, 586.1, 0.417],
      ['right_knee', 198, 645, 0.175],
      ['left_ankle', 125.4, 596.7, 0.729],
      ['right_ankle', 152.9, 638, 0.352],
    ],
  },
  weightedPullup: {
    truth:
      'An upright weighted pull-up at a bar, filmed from the front-quarter. An upright body with visible bilateral depth — nothing here is a side-on planche.',
    width: 640,
    height: 960,
    rotation: 0,
    points: [
      ['left_ear', 408.4, 487.5, 1],
      ['right_ear', 385, 489, 1],
      ['left_shoulder', 430.8, 516.7, 1],
      ['right_shoulder', 368.4, 537.8, 0.998],
      ['left_elbow', 475.3, 524.2, 0.993],
      ['right_elbow', 345.5, 563, 0.784],
      ['left_wrist', 448.8, 475.7, 0.965],
      ['right_wrist', 328.6, 508, 0.907],
      ['left_hip', 428.2, 635.8, 1],
      ['right_hip', 391, 646.5, 0.999],
      ['left_knee', 428.3, 735.8, 0.967],
      ['right_knee', 394.7, 741.9, 0.603],
      ['left_ankle', 436.3, 844.4, 0.938],
      ['right_ankle', 414.7, 846.7, 0.736],
    ],
  },
  lsitCroppedHead: {
    truth:
      'An L-sit on low parallettes with the head and shoulders cropped out of the top of the frame. BlazePose hallucinates a coherent skeleton on the hand and bar — ears and "shoulders" at visibility 1.0 on the fist — so every landmark is confidently wrong. The one thing the judge must never do with this is return a clean, high-scoring planche verdict.',
    width: 760,
    height: 784,
    rotation: 0,
    points: [
      ['left_ear', 255.8, 571.5, 0.997],
      ['right_ear', 250.6, 571.3, 0.998],
      ['left_shoulder', 289, 573.4, 0.994],
      ['right_shoulder', 288.5, 579.2, 1],
      ['left_elbow', 333.4, 562.2, 0.368],
      ['right_elbow', 365.1, 572.3, 0.827],
      ['left_wrist', 387.9, 561.7, 0.369],
      ['right_wrist', 416.8, 566.5, 0.914],
      ['left_hip', 315.3, 464.8, 1],
      ['right_hip', 312.3, 465.2, 1],
      ['left_knee', 252.2, 474.2, 0.081],
      ['right_knee', 241, 459.4, 0.904],
      ['left_ankle', 268.7, 428, 0.272],
      ['right_ankle', 252.5, 397.9, 0.809],
    ],
  },
  straddleOffAxis: {
    truth:
      'A real straddle planche, but filmed from a strong three-quarter angle. Every sagittal angle in it is foreshortened, so it must not be graded at all.',
    width: 1280,
    height: 853,
    rotation: 90,
    points: [
      ['left_ear', 1124.3, 355.9, 1],
      ['right_ear', 1110.1, 338.5, 1],
      ['left_shoulder', 999.8, 394.2, 1],
      ['right_shoulder', 916.2, 305.6, 1],
      ['left_elbow', 898.9, 496.4, 0.717],
      ['right_elbow', 752.2, 424.5, 0.993],
      ['left_wrist', 843.2, 632.1, 0.905],
      ['right_wrist', 651.3, 591.1, 0.985],
      ['left_hip', 723.7, 371.7, 0.997],
      ['right_hip', 664.2, 282.3, 0.999],
      ['left_knee', 756.6, 502.9, 0.631],
      ['right_knee', 429.4, 274.8, 0.978],
      ['left_ankle', 630.9, 639.8, 0.637],
      ['right_ankle', 150.8, 275.4, 0.971],
    ],
  },

  // ————— Handstand, flag and front lever (2026-11) —————
  // The same pipeline, pointed at the positions the planche judge never saw.
  // These photographs are what set POSTURE_TOLERANCE and found three faults no
  // synthetic sweep could: straight handstands whose shoulders came back
  // unseen, a real front lever accused of bent arms and knees, and an upright
  // hold on a pole read as a perfectly level flag.
  handstandStraight: {
    truth:
      'Side-on freestanding handstand: arms locked, shoulders open, hips and legs in one straight line over the hands. Nothing to correct.',
    width: 1280,
    height: 1656,
    rotation: 270,
    points: [
      ['left_ear', 649.3, 1281.3, 0.998],
      ['right_ear', 655, 1280.1, 0.998],
      ['left_shoulder', 646.1, 1168.4, 0.987],
      ['right_shoulder', 663.3, 1189.2, 0.999],
      ['left_elbow', 654.6, 1324.2, 0.218],
      ['right_elbow', 666.3, 1356.8, 0.988],
      ['left_wrist', 684.8, 1450.8, 0.458],
      ['right_wrist', 683.3, 1528.7, 0.984],
      ['left_hip', 635.4, 773.6, 0.998],
      ['right_hip', 658.5, 782.7, 0.998],
      ['left_knee', 622.5, 496.4, 0.273],
      ['right_knee', 643.7, 484.7, 0.951],
      ['left_ankle', 633.1, 230.5, 0.432],
      ['right_ankle', 638.2, 198.8, 0.922],
    ],
  },
  handstandOnWedge: {
    truth:
      'Side-on handstand with the hands on a low wedge mat: straight arms, open shoulders, a straight line to pointed toes.',
    width: 1280,
    height: 1705,
    rotation: 0,
    points: [
      ['left_ear', 367.3, 1032.9, 0.992],
      ['right_ear', 354.2, 1033.9, 0.987],
      ['left_shoulder', 367.9, 980.1, 0.995],
      ['right_shoulder', 312, 989.8, 0.998],
      ['left_elbow', 352.4, 1086.1, 0.594],
      ['right_elbow', 291.3, 1086.5, 0.991],
      ['left_wrist', 353.3, 1184, 0.783],
      ['right_wrist', 290.2, 1196.4, 0.994],
      ['left_hip', 356, 750, 0.998],
      ['right_hip', 311.5, 749.7, 0.997],
      ['left_knee', 335.1, 578.8, 0.328],
      ['right_knee', 320.3, 578.2, 0.898],
      ['left_ankle', 341.5, 399.6, 0.395],
      ['right_ankle', 337.4, 399.5, 0.908],
    ],
  },
  handstandSilhouette: {
    truth:
      'A handstand in silhouette at dusk. The legs and trunk read clearly; the arms merge with the dark rocks behind them and cannot be made out by eye, so nothing about the elbows can be established from it.',
    width: 720,
    height: 1280,
    rotation: 270,
    points: [
      ['left_ear', 280.4, 784.4, 0.999],
      ['right_ear', 276.7, 781.9, 0.998],
      ['left_shoulder', 325.6, 764.9, 1],
      ['right_shoulder', 314.1, 746.9, 0.987],
      ['left_elbow', 356.4, 838.8, 0.995],
      ['right_elbow', 344.2, 816.4, 0.168],
      ['left_wrist', 352.6, 918.7, 0.976],
      ['right_wrist', 348.7, 888.4, 0.489],
      ['left_hip', 323.6, 585.6, 1],
      ['right_hip', 315.2, 581.6, 0.998],
      ['left_knee', 306.6, 443.3, 0.956],
      ['right_knee', 305.8, 456.6, 0.104],
      ['left_ankle', 285.4, 308.5, 0.967],
      ['right_ankle', 291.6, 345.5, 0.323],
    ],
  },
  handstandArched: {
    truth:
      'Side-on handstand with the feet resting on lockers: arms straight, but the chest is pushed through, the shoulders are closed and the back is clearly arched.',
    width: 750,
    height: 1334,
    rotation: 90,
    points: [
      ['left_ear', 690, 750.8, 1],
      ['right_ear', 686.1, 754.5, 1],
      ['left_shoulder', 595, 733.8, 0.999],
      ['right_shoulder', 592.4, 765.4, 1],
      ['left_elbow', 561.3, 857.1, 0.373],
      ['right_elbow', 556.7, 910.6, 0.998],
      ['left_wrist', 560.7, 972.3, 0.682],
      ['right_wrist', 555.8, 1062.3, 0.993],
      ['left_hip', 378.6, 617, 0.999],
      ['right_hip', 361.6, 619.9, 0.999],
      ['left_knee', 302.6, 421.5, 0.479],
      ['right_knee', 293.2, 413.3, 0.969],
      ['left_ankle', 272.4, 220.5, 0.552],
      ['right_ankle', 255.5, 195.3, 0.985],
    ],
  },
  handstandFromBehind: {
    truth:
      'A handstand photographed from behind. No sagittal angle can be read from it.',
    width: 966,
    height: 2051,
    rotation: 90,
    points: [
      ['left_ear', 276.8, 1677.1, 0.998],
      ['right_ear', 261.6, 1673.3, 0.999],
      ['left_shoulder', 413.9, 1600.9, 0.999],
      ['right_shoulder', 253.4, 1521.8, 0.994],
      ['left_elbow', 519.2, 1830.8, 0.994],
      ['right_elbow', 225.1, 1719.3, 0.627],
      ['left_wrist', 563.2, 2116.4, 0.985],
      ['right_wrist', 200, 1903.7, 0.82],
      ['left_hip', 472.9, 1063.1, 0.999],
      ['right_hip', 371.6, 1052.8, 0.998],
      ['left_knee', 530.5, 638.6, 0.95],
      ['right_knee', 451.9, 663.5, 0.353],
      ['left_ankle', 521.2, 235.6, 0.946],
      ['right_ankle', 453.3, 295.9, 0.552],
    ],
  },
  handstandStraddleFront: {
    truth:
      'A straddle handstand on a slackline, photographed from the front.',
    width: 1280,
    height: 2276,
    rotation: 270,
    points: [
      ['left_ear', 634.8, 1788, 1],
      ['right_ear', 545.9, 1774.5, 1],
      ['left_shoulder', 737.2, 1671.5, 1],
      ['right_shoulder', 488, 1655.7, 1],
      ['left_elbow', 801, 1826.7, 0.992],
      ['right_elbow', 443, 1798.8, 0.982],
      ['left_wrist', 833.5, 1998.5, 0.995],
      ['right_wrist', 435.5, 1946.3, 0.995],
      ['left_hip', 707.7, 1227, 1],
      ['right_hip', 568.3, 1217.9, 1],
      ['left_knee', 881.6, 1100.3, 0.998],
      ['right_knee', 385.1, 981.6, 0.998],
      ['left_ankle', 1078.7, 946.1, 0.997],
      ['right_ankle', 161.7, 719.9, 0.998],
    ],
  },
  flagLevel: {
    truth:
      'Front-on human flag on a ladder: both arms straight, the body level and straight from shoulders to feet. Nothing to correct.',
    width: 1280,
    height: 886,
    rotation: 270,
    points: [
      ['left_ear', 464.5, 315.5, 0.999],
      ['right_ear', 471, 360.6, 0.999],
      ['left_shoulder', 527.9, 257.9, 0.997],
      ['right_shoulder', 547.2, 391.3, 0.997],
      ['left_elbow', 422.6, 197.4, 0.99],
      ['right_elbow', 505.3, 498.8, 0.951],
      ['left_wrist', 322.5, 155.6, 0.935],
      ['right_wrist', 452.8, 573.5, 0.846],
      ['left_hip', 783.1, 273.3, 0.999],
      ['right_hip', 788.4, 350.3, 0.998],
      ['left_knee', 933.2, 262.1, 0.959],
      ['right_knee', 948.7, 331.9, 0.939],
      ['left_ankle', 1078.3, 260.8, 0.933],
      ['right_ankle', 1068.2, 297, 0.923],
    ],
  },
  flagAngledDown: {
    truth:
      'A flag on a leaning tree trunk with the body pointing well below level — about 35° — and the legs scissored.',
    width: 1280,
    height: 857,
    rotation: 0,
    points: [
      ['left_ear', 413.1, 349.1, 0.999],
      ['right_ear', 396.7, 384.8, 1],
      ['left_shoulder', 490.5, 341.5, 0.998],
      ['right_shoulder', 451, 451.7, 0.998],
      ['left_elbow', 458.2, 241.5, 0.963],
      ['right_elbow', 357.4, 502.5, 0.976],
      ['left_wrist', 408.8, 133.9, 0.968],
      ['right_wrist', 246.4, 537, 0.903],
      ['left_hip', 672.7, 490.4, 0.999],
      ['right_hip', 643.5, 538.3, 1],
      ['left_knee', 717, 528.1, 0.842],
      ['right_knee', 702.3, 616.5, 0.965],
      ['left_ankle', 766.4, 567.1, 0.816],
      ['right_ankle', 780.5, 676.9, 0.943],
    ],
  },
  poleHoldUpright: {
    truth:
      'An inverted hold on a dance pole: the body runs straight up the pole, upside down. Not level in any sense, and not a flag.',
    width: 453,
    height: 604,
    rotation: 0,
    points: [
      ['left_ear', 169.5, 345.2, 1],
      ['right_ear', 164.9, 337.8, 1],
      ['left_shoulder', 212.4, 345.9, 1],
      ['right_shoulder', 170.7, 306.5, 1],
      ['left_elbow', 177.7, 400.5, 0.971],
      ['right_elbow', 152.3, 245.6, 0.99],
      ['left_wrist', 136.3, 446.3, 0.99],
      ['right_wrist', 136.2, 185, 0.895],
      ['left_hip', 217.8, 216.5, 0.999],
      ['right_hip', 193.1, 210.5, 1],
      ['left_knee', 207.5, 131.9, 0.565],
      ['right_knee', 187.6, 116.6, 0.974],
      ['left_ankle', 190, 52, 0.731],
      ['right_ankle', 183, 31.2, 0.948],
    ],
  },
  flagBentTopArm: {
    truth:
      'Front-on flag with the body close to level and the top arm visibly bent at the elbow.',
    width: 1280,
    height: 720,
    rotation: 0,
    points: [
      ['left_ear', 737.7, 231.1, 1],
      ['right_ear', 733.8, 251.5, 1],
      ['left_shoulder', 698.8, 185.2, 0.999],
      ['right_shoulder', 691.9, 293.2, 0.999],
      ['left_elbow', 739.7, 118.6, 0.987],
      ['right_elbow', 731, 352.3, 0.999],
      ['left_wrist', 801.9, 87.9, 0.979],
      ['right_wrist', 788.2, 402.9, 0.994],
      ['left_hip', 522.4, 202.7, 1],
      ['right_hip', 517.4, 252.2, 0.999],
      ['left_knee', 403.1, 168.9, 0.937],
      ['right_knee', 392, 206, 0.939],
      ['left_ankle', 291.1, 127, 0.925],
      ['right_ankle', 274.5, 167.2, 0.943],
    ],
  },
  flagOnFrame: {
    truth:
      'Front-on flag on a climbing frame: straight arms, body level, legs slightly apart.',
    width: 604,
    height: 338,
    rotation: 90,
    points: [
      ['left_ear', 223.5, 174.5, 0.998],
      ['right_ear', 222.4, 165.1, 0.998],
      ['left_shoulder', 246.8, 187.4, 1],
      ['right_shoulder', 247.7, 136.6, 1],
      ['left_elbow', 274.1, 214.6, 0.997],
      ['right_elbow', 269.4, 106.8, 0.996],
      ['left_wrist', 292.6, 248, 0.986],
      ['right_wrist', 285.3, 79.6, 0.823],
      ['left_hip', 319.8, 177.7, 0.998],
      ['right_hip', 319.1, 150.2, 0.998],
      ['left_knee', 388.1, 169.8, 0.927],
      ['right_knee', 383.2, 134.5, 0.994],
      ['left_ankle', 448.6, 159.2, 0.93],
      ['right_ankle', 446.4, 118.3, 0.979],
    ],
  },
  flagOnBars: {
    truth:
      'Front-on flag between upright bars: straight arms, level body, legs together.',
    width: 604,
    height: 400,
    rotation: 90,
    points: [
      ['left_ear', 295.4, 229.7, 1],
      ['right_ear', 294.6, 245.1, 1],
      ['left_shoulder', 276.7, 215.2, 0.999],
      ['right_shoulder', 275.7, 260.3, 0.999],
      ['left_elbow', 311.5, 200.8, 0.982],
      ['right_elbow', 310.7, 268.5, 0.992],
      ['left_wrist', 349, 190.8, 0.986],
      ['right_wrist', 348.3, 279.7, 0.992],
      ['left_hip', 177.9, 240.6, 0.999],
      ['right_hip', 183, 263.5, 0.999],
      ['left_knee', 113.8, 244.4, 0.956],
      ['right_knee', 121.2, 263.2, 0.569],
      ['left_ankle', 56.5, 253.7, 0.877],
      ['right_ankle', 63.1, 263, 0.619],
    ],
  },
  flagSlightlyLow: {
    truth:
      'Front-on flag with the feet a little below the shoulders and a slight fold at the hips; arms straight. A competent flag rather than a textbook one.',
    width: 1280,
    height: 719,
    rotation: 270,
    points: [
      ['left_ear', 485.8, 315.6, 1],
      ['right_ear', 486.4, 294.4, 1],
      ['left_shoulder', 531.5, 342.1, 1],
      ['right_shoulder', 521.4, 248.3, 1],
      ['left_elbow', 478.9, 398.1, 0.986],
      ['right_elbow', 468.9, 196.3, 0.996],
      ['left_wrist', 420.4, 446.2, 0.996],
      ['right_wrist', 398.5, 153.9, 0.997],
      ['left_hip', 701.5, 306.9, 1],
      ['right_hip', 687.6, 257.8, 1],
      ['left_knee', 769.5, 283.9, 0.965],
      ['right_knee', 761.5, 230.2, 0.947],
      ['left_ankle', 844.9, 239.3, 0.947],
      ['right_ankle', 841.9, 214.4, 0.932],
    ],
  },
  flagOblique: {
    truth:
      'A flag on a tree photographed from an angle: the body points partly toward the camera, so the trunk and legs are foreshortened. No leg or hip angle can be read from it.',
    width: 1280,
    height: 960,
    rotation: 0,
    points: [
      ['left_ear', 929.5, 638.7, 1],
      ['right_ear', 933.4, 576.4, 1],
      ['left_shoulder', 905.9, 691.6, 1],
      ['right_shoulder', 908.4, 525.9, 1],
      ['left_elbow', 930.9, 786.6, 0.995],
      ['right_elbow', 963.7, 432.8, 0.986],
      ['left_wrist', 990.3, 869.7, 0.987],
      ['right_wrist', 1045.6, 363.4, 0.983],
      ['left_hip', 715.1, 611.8, 0.999],
      ['right_hip', 731.3, 538.3, 1],
      ['left_knee', 641.9, 570.8, 0.815],
      ['right_knee', 663.3, 509.3, 0.881],
      ['left_ankle', 582.5, 532.9, 0.792],
      ['right_ankle', 589.4, 508.7, 0.822],
    ],
  },
  flagFoldedArms: {
    truth:
      'A casual low flag on a lamp post: body level, legs apart, and both arms bent — the top one folded tight, gripping the post beside the chest.',
    width: 600,
    height: 400,
    rotation: 270,
    points: [
      ['left_ear', 449.3, 224.7, 1],
      ['right_ear', 444.6, 201.6, 1],
      ['left_shoulder', 409.1, 242.1, 1],
      ['right_shoulder', 417, 192.1, 1],
      ['left_elbow', 367.6, 254.3, 0.825],
      ['right_elbow', 386.7, 179.9, 0.993],
      ['left_wrist', 390.2, 285, 0.983],
      ['right_wrist', 399.5, 215.2, 0.995],
      ['left_hip', 312.9, 242.7, 0.999],
      ['right_hip', 315.1, 209.3, 0.999],
      ['left_knee', 235, 241.5, 0.97],
      ['right_knee', 236.7, 194.2, 0.973],
      ['left_ankle', 166.6, 237.2, 0.914],
      ['right_ankle', 167.6, 176.4, 0.943],
    ],
  },
  flagFeetHigh: {
    truth:
      'Front-on flag on a garden post: straight arms, a straight body, the feet a little above level.',
    width: 600,
    height: 400,
    rotation: 0,
    points: [
      ['left_ear', 138, 182.8, 1],
      ['right_ear', 141.6, 210.5, 1],
      ['left_shoulder', 170.2, 156.9, 0.999],
      ['right_shoulder', 178, 227.6, 1],
      ['left_elbow', 128.6, 121.3, 0.995],
      ['right_elbow', 136.8, 253.5, 0.997],
      ['left_wrist', 80.1, 85.5, 0.983],
      ['right_wrist', 81.3, 277.3, 0.988],
      ['left_hip', 286.8, 158.3, 0.999],
      ['right_hip', 294.2, 198.1, 1],
      ['left_knee', 360.5, 140.2, 0.947],
      ['right_knee', 373.2, 173.8, 0.981],
      ['left_ankle', 432.8, 123.3, 0.952],
      ['right_ankle', 451.3, 150.2, 0.979],
    ],
  },
  frontLeverRings: {
    truth:
      'Side-on front lever on rings: both arms visibly straight, legs straight, the body level with the feet a touch high.',
    width: 1200,
    height: 1600,
    rotation: 270,
    points: [
      ['left_ear', 344.8, 832, 0.999],
      ['right_ear', 350.6, 837.6, 0.999],
      ['left_shoulder', 421.4, 858, 1],
      ['right_shoulder', 478.1, 914.3, 1],
      ['left_elbow', 536.1, 749.9, 0.872],
      ['right_elbow', 609.8, 780.3, 0.997],
      ['left_wrist', 594.9, 634.2, 0.935],
      ['right_wrist', 668.4, 617.3, 0.996],
      ['left_hip', 659.3, 863.2, 0.998],
      ['right_hip', 706, 900.9, 0.998],
      ['left_knee', 865.8, 834.5, 0.459],
      ['right_knee', 900.1, 836.4, 0.94],
      ['left_ankle', 1046.7, 820.3, 0.618],
      ['right_ankle', 1087.3, 816.9, 0.97],
    ],
  },
  frontLeverThreeQuarter: {
    truth:
      'A front lever on a bar photographed from a three-quarter angle, small in the frame.',
    width: 1218,
    height: 720,
    rotation: 0,
    points: [
      ['left_ear', 466.2, 207.7, 0.998],
      ['right_ear', 481.6, 198.3, 0.999],
      ['left_shoulder', 467.6, 256, 0.999],
      ['right_shoulder', 526.3, 227.8, 1],
      ['left_elbow', 497.6, 218.8, 0.074],
      ['right_elbow', 578.3, 203.8, 0.955],
      ['left_wrist', 520.6, 162.3, 0.304],
      ['right_wrist', 559.5, 156.5, 0.943],
      ['left_hip', 584.1, 318.8, 1],
      ['right_hip', 613.1, 301, 1],
      ['left_knee', 634.9, 329.4, 0.334],
      ['right_knee', 677.6, 318.2, 0.956],
      ['left_ankle', 677.1, 349.2, 0.664],
      ['right_ankle', 732.5, 357.7, 0.985],
    ],
  },
  frontLeverFromBelow: {
    truth:
      'A level front lever photographed from below and in front. Nothing sagittal can be read from this angle.',
    width: 433,
    height: 300,
    rotation: 90,
    points: [
      ['left_ear', 65.2, 163.3, 1],
      ['right_ear', 79.1, 173.3, 1],
      ['left_shoulder', 93.2, 174.2, 1],
      ['right_shoulder', 149, 196.5, 0.999],
      ['left_elbow', 128.3, 108.8, 0.912],
      ['right_elbow', 224.4, 124.8, 0.996],
      ['left_wrist', 156.9, 47, 0.985],
      ['right_wrist', 253.3, 41, 0.995],
      ['left_hip', 220, 191.7, 0.996],
      ['right_hip', 251.4, 205.7, 0.998],
      ['left_knee', 296.4, 197.3, 0.137],
      ['right_knee', 318.7, 203.4, 0.89],
      ['left_ankle', 351.3, 218.2, 0.245],
      ['right_ankle', 371.5, 219.1, 0.962],
    ],
  },
}

/**
 * Expand a captured frame into the clip the judge expects. Optional jitter
 * reproduces the frame-to-frame landmark wander measured on real video, so a
 * still can be asked the harder question: does this verdict survive a tracker
 * that never sits perfectly still?
 */
export function realClip(
  key: keyof typeof REAL_POSES,
  { frames = 24, seconds = 10, jitter = 0, seed = 1 } = {},
): JudgeInput {
  const pose = REAL_POSES[key]
  let state = seed >>> 0
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296 - 0.5
  }
  const torso = Math.hypot(
    pose.points.find((p) => p[0] === 'left_shoulder')![1] -
      pose.points.find((p) => p[0] === 'left_hip')![1],
    pose.points.find((p) => p[0] === 'left_shoulder')![2] -
      pose.points.find((p) => p[0] === 'left_hip')![2],
  )
  const times = Array.from({ length: frames }, (_, i) => (seconds * i) / (frames - 1))
  return {
    tracked: times.map((t) => ({
      t,
      kps: pose.points.map(
        ([name, x, y, score]): Kp => ({
          name,
          x: x + rand() * jitter * torso * 2,
          y: y + rand() * jitter * torso * 2,
          score,
        }),
      ),
    })),
    times,
    width: pose.width,
    height: pose.height,
    duration: seconds,
    creditedHoldSec: seconds,
    from: times[0],
    to: times[times.length - 1],
    holdWindow: seconds,
    backendId: 'mediapipe',
    rotation: pose.rotation,
  }
}
