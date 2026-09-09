import { rect as r, poly, wedge, arcPts } from '../lib/geometry.js';

/**
 * Geometry traced from the six source floor plan drawings. Coordinates are in
 * plan units (1 unit = 1/24 m, i.e. roughly the pixel grid of the drawings) so
 * they can be compared directly against the originals.
 */

export const PLAN_SCALE = 1 / 24; // metres per plan unit
export const WALL_HEIGHT = 70; // ~2.9 m
export const FLOOR_HEIGHT = 96; // ~4.0 m floor-to-floor
export const SLAB_THICKNESS = 7;
export const WALL_THICKNESS = 6;
export const DOOR_HEIGHT = 48;
export const DOOR_WIDTH = 22;

export const CATEGORIES = {
  lab: { label: 'Laboratories', color: 0x2f9e8f },
  teaching: { label: 'Lecture & tutorial', color: 0xf0b429 },
  office: { label: 'Offices & staff', color: 0x4a6fa5 },
  social: { label: 'Social spaces', color: 0x7cb342 },
  amenity: { label: 'Toilets & surau', color: 0xe4576b },
  circulation: { label: 'Circulation', color: 0x9aa5b4 },
  service: { label: 'Service & other', color: 0xa1887f },
};

const CATEGORY_RULES = [
  [/\bmakmal\b|\blab\b|laborator|ccna|ios/i, 'lab'],
  [/dewan kuliah|bilik kuliah|bilik tutorial|bilik seminar|seminar|meeting/i, 'teaching'],
  [/toilet|surau/i, 'amenity'],
  [/lounge|cube|landscape|taman|garden|pond/i, 'social'],
  [/office|lecturer/i, 'office'],
  [/lobby|foyer|stair|lift|void|bridge|entrance|corridor|landing|exit/i, 'circulation'],
  [/pondok|teknikal|store|unmarked/i, 'service'],
];

export function classify(name) {
  for (const [pattern, category] of CATEGORY_RULES) {
    if (pattern.test(name)) return category;
  }
  return 'service';
}

// --- Block B curved wing -----------------------------------------------------
// The arc of tutorial rooms wrapping the two lecture theatres.
const ARC = { cx: 400, cy: 300, inner: 245, outer: 300 };
const bt = (aStart, aEnd) => wedge(ARC.cx, ARC.cy, ARC.inner, ARC.outer, aStart, aEnd);
const arcInner = (aStart, aEnd, segs = 14) =>
  arcPts(ARC.cx, ARC.cy, ARC.inner, aStart, aEnd, segs);

// =============================================================================
// BLOCK A
// =============================================================================

const blockALevel1 = {
  id: 'A1',
  name: 'Level 1',
  outline: r(80, 268, 805, 1010),
  rooms: [
    { name: 'Office', poly: r(80, 268, 300, 560), doors: [[2, 0.78]] },
    { name: 'Office', poly: r(300, 268, 577, 440), doors: [[2, 0.12], [2, 0.9]] },
    { name: 'Office', poly: r(577, 268, 805, 560), doors: [[2, 0.22]] },
    { name: 'Lobby', poly: r(300, 445, 577, 738), open: true },
    { name: 'Bilik Kuliah 1', code: 'BK1', poly: r(80, 605, 300, 855), doors: [[0, 0.85], [1, 0.55]] },
    { name: 'The Cube', poly: r(577, 605, 805, 855), doors: [[0, 0.14], [3, 0.16]] },
    { name: 'Stairs', poly: r(330, 742, 550, 862) },
    { name: "Ladies' Toilet", poly: r(80, 862, 185, 1010), doors: [[0, 0.68]] },
    { name: "Men's Toilet", poly: r(185, 880, 300, 1010), doors: [[0, 0.3]] },
    { name: 'Main Entrance', poly: r(330, 875, 550, 1005), open: true },
  ],
};

const blockALevel2 = {
  id: 'A2',
  name: 'Level 2',
  outline: poly([
    [80, 262], [805, 262], [805, 490], [880, 490], [880, 625], [805, 625],
    [805, 1010], [80, 1010], [80, 690], [63, 690], [63, 600], [80, 600],
  ]),
  rooms: [
    { name: 'CCNA Lab', poly: r(85, 262, 305, 515), doors: [[1, 0.14], [2, 0.86]] },
    { name: 'Makmal Mikro 2', code: 'MM2', poly: r(350, 262, 452, 500), doors: [[0, 0.28], [2, 0.28]] },
    { name: 'Makmal Lanjutan', code: 'ML', poly: r(455, 262, 557, 500), doors: [[0, 0.72], [2, 0.72]] },
    { name: 'Makmal Mikro 1', code: 'MM1', poly: r(600, 262, 805, 510), doors: [[0, 0.08], [2, 0.08]] },
    { name: 'Bridge Landing', poly: r(90, 550, 305, 600), open: true, note: 'Bridge to Block B' },
    { name: 'Postgraduate Lounge', poly: r(105, 605, 305, 870), doors: [[0, 0.9], [1, 0.55]] },
    { name: 'Stairs', poly: r(63, 600, 105, 690) },
    { name: 'Stairs', poly: r(805, 490, 880, 625) },
    { name: 'Void', poly: r(357, 587, 548, 733) },
    { name: 'Stairs', poly: r(410, 780, 500, 878) },
    { name: 'Foyer', poly: r(355, 880, 550, 1005), open: true },
    { name: "Ladies' Toilet", poly: r(85, 872, 185, 930), doors: [[1, 0.5]] },
    { name: 'Surau (Ladies)', poly: r(85, 930, 235, 1010), doors: [[0, 0.9]] },
    { name: 'Computer Technology Research Lab', code: 'CTRL', poly: r(595, 605, 805, 1010), doors: [[3, 0.25], [3, 0.75]] },
  ],
};

const blockALevel3 = {
  id: 'A3',
  name: 'Level 3',
  outline: r(90, 262, 830, 1010),
  rooms: [
    { name: "Lecturer's Room", poly: r(90, 262, 830, 400), doors: [[2, 0.2], [2, 0.8]] },
    { name: "Lecturer's Room", poly: r(90, 400, 230, 880), doors: [[1, 0.9]] },
    { name: "Lecturer's Room", poly: r(665, 400, 830, 490), doors: [[3, 0.5]] },
    { name: 'Seminar Room 2', code: 'BS2', poly: r(665, 490, 780, 690), doors: [[3, 0.5]], note: 'Bilik Seminar 2' },
    { name: "Lecturer's Room", poly: r(780, 490, 830, 690) },
    { name: "Lecturer's Room", poly: r(665, 690, 830, 880), doors: [[3, 0.5]] },
    { name: 'Foyer', poly: r(235, 405, 660, 1005), open: true, labelAt: [447, 950] },
    { name: 'Void', poly: r(370, 565, 550, 715) },
    { name: 'Stairs', poly: r(415, 790, 500, 880) },
    { name: 'Seminar Room 1', code: 'BS1', poly: r(500, 790, 580, 880), doors: [[2, 0.5]], note: 'Bilik Seminar 1' },
    { name: "Men's Toilet", poly: r(95, 885, 190, 940), doors: [[1, 0.5]] },
    { name: 'Surau (Mens)', poly: r(95, 940, 250, 1010), doors: [[0, 0.9]] },
    { name: 'Bilik Kuliah 2', code: 'BK2', poly: r(640, 885, 805, 1010), doors: [[3, 0.3]] },
  ],
};

// =============================================================================
// BLOCK B  (sits one storey lower than Block A, so its level 3 meets the
// Block A level 2 bridge)
// =============================================================================

const blockBLevel1 = {
  id: 'B1',
  name: 'Level 1',
  outline: poly(
    [[200, 145], [415, 145], [415, 130], [790, 130], [790, 145], [1000, 145],
     [1000, 290], [980, 290], [980, 335], [1000, 335], [1000, 565],
     [845, 565], [845, 590], [322, 590]],
    arcPts(ARC.cx, ARC.cy, ARC.outer, 105, 195, 20),
    [[110, 222], [200, 222]],
  ),
  rooms: [
    { name: 'Makmal Mikro 4', code: 'MM4', poly: r(305, 210, 355, 292), doors: [[2, 0.5]] },
    { name: 'Makmal Mikro 3', code: 'MM3', poly: r(358, 210, 410, 292), doors: [[2, 0.5]] },
    { name: 'Stairs', poly: r(415, 130, 470, 185) },
    { name: 'Exit to Bus Stop KK8', poly: r(470, 130, 520, 185), open: true, note: 'Exit to Bus Stop KK8' },
    { name: 'Makmal Mikro 5', code: 'MM5', poly: r(520, 145, 652, 215), doors: [[3, 0.5]], note: 'MM5' },
    { name: "Men's Toilet", poly: r(520, 215, 652, 292), doors: [[3, 0.5]] },
    { name: "Ladies' Toilet", poly: r(485, 320, 640, 378), doors: [[1, 0.5]] },
    { name: 'Bilik Teknikal', poly: r(485, 378, 640, 432), doors: [[1, 0.5]] },
    { name: 'Lecturer Rooms', poly: r(780, 145, 1000, 218), doors: [[3, 0.5]] },
    { name: 'Makmal Mikro 6', code: 'MM6', poly: r(780, 218, 1000, 292), doors: [[3, 0.5]] },
    { name: 'Exit (to Block A)', poly: r(880, 292, 1000, 335), open: true, note: 'Exit to Block A' },
    { name: 'Lecturer Rooms', poly: r(845, 335, 1000, 450), doors: [[3, 0.5]] },
    { name: 'Meeting Room', code: 'MR', poly: r(845, 450, 1000, 565), doors: [[3, 0.5]], note: 'Bilik Mesyuarat' },
    {
      name: 'Landscape',
      poly: poly([[652, 215], [810, 215], [810, 515], [690, 515], [690, 290], [652, 290]]),
      open: true,
      color: 0x5cb85c,
      note: 'Landscape Courtyard',
      trees: [
        [670, 235],
        [790, 235],
        [790, 275],
        [790, 495],
        [705, 495],
        [700, 410],
        [795, 410],
      ],
    },
    {
      name: 'Pondok',
      poly: r(715, 445, 785, 495),
      doors: [[3, 0.5]],
      note: 'Pondok / Gazebo',
    },
    { name: 'Side Entrance', poly: r(415, 454, 470, 565), open: true, note: 'Side Entrance' },
    { name: 'Exit', poly: r(415, 565, 470, 590), open: true, note: 'Exit to Outside' },
    { name: 'Lift', poly: r(475, 518, 515, 556) },
    { name: 'Stairs', poly: r(520, 505, 580, 562) },
    {
      name: 'Dewan Kuliah 2',
      code: 'DK2',
      poly: poly([[150, 210], [302, 210], [302, 454]], arcInner(141, 198)),
      doors: [[2, 0.8]],
    },
    {
      name: 'Landscape',
      poly: r(415, 395, 470, 454),
      open: true,
      color: 0x5cb85c,
      note: 'Landscape Area',
    },
    {
      name: 'Dewan Kuliah 1',
      code: 'DK1',
      poly: poly([[415, 454]], arcInner(141, 105, 10), [[337, 590], [415, 590]]),
      doors: [[0, 0.9]],
    },
    { name: 'Bilik Tutorial 5', code: 'BT5', poly: bt(195, 177) },
    { name: 'Bilik Tutorial 4', code: 'BT4', poly: bt(177, 159) },
    { name: 'Bilik Tutorial 3', code: 'BT3', poly: bt(159, 141) },
    { name: 'Bilik Tutorial 2', code: 'BT2', poly: bt(141, 123) },
    { name: 'Bilik Tutorial 1', code: 'BT1', poly: bt(123, 105) },
    { name: 'Main Entrance', poly: r(650, 505, 840, 588), open: true },
  ],
};

const blockBLevel2 = {
  id: 'B2',
  name: 'Level 2',
  outline: r(70, 140, 940, 735),
  rooms: [
    { name: "Lecturer's Room", poly: r(70, 140, 170, 455), doors: [[1, 0.9]] },
    { name: 'Bilik Seminar 3', code: 'BS3', poly: r(70, 490, 170, 590), doors: [[1, 0.5]] },
    { name: "Lecturer's Room", poly: r(70, 590, 170, 735), doors: [[1, 0.2]] },
    { name: 'Toilet', poly: r(355, 255, 425, 340), doors: [[2, 0.5]] },
    { name: 'Student Lounge', poly: r(355, 385, 590, 535), doors: [[0, 0.5]] },
    { name: 'Stairs', poly: r(300, 155, 410, 225) },
    { name: 'Stairs', poly: r(300, 580, 410, 650) },
    { name: 'Stairs', poly: r(800, 555, 858, 622) },
    { name: 'Lift', poly: r(195, 665, 258, 735) },
    { name: 'Makmal Mikro 7', code: 'MM7', poly: r(450, 140, 940, 240), doors: [[3, 0.5]] },
    { name: 'Makmal Mikro 8', code: 'MM8', poly: r(780, 240, 940, 535), doors: [[3, 0.5]] },
  ],
};

const blockBLevel3 = {
  id: 'B3',
  name: 'Level 3',
  outline: r(70, 140, 885, 720),
  rooms: [
    { name: 'Toilet', poly: r(430, 205, 510, 305) },
    { name: 'Stroustrup Lab 2', code: 'SL2', poly: r(430, 305, 510, 450), doors: [[3, 0.5]] },
    { name: 'Stroustrup Lab 1', code: 'SL1', poly: r(430, 450, 650, 550), doors: [[3, 0.5]] },
    { name: 'Bridge to Block A', poly: r(670, 425, 880, 468), open: true },
    { name: 'Stairs', poly: r(172, 205, 288, 275) },
    { name: 'Stairs', poly: r(310, 650, 422, 715) },
    { name: 'Stairs', poly: r(738, 470, 880, 532) },
    { name: 'Lift', poly: r(170, 660, 282, 715) },
  ],
};

export const BUILDINGS = [
  {
    id: 'A',
    name: 'Block A',
    accent: '#e4576b',
    origin: [0, 0],
    baseElevation: 0,
    levels: [blockALevel1, blockALevel2, blockALevel3],
  },
  {
    id: 'B',
    name: 'Block B',
    accent: '#f0b429',
    origin: [-1040, 128],
    baseElevation: -FLOOR_HEIGHT,
    levels: [blockBLevel1, blockBLevel2, blockBLevel3],
  },
];

/** The covered link connecting Block A level 2 to Block B level 3. */
export const BRIDGE = {
  name: 'Bridge · Block A ↔ Block B',
  poly: r(-160, 553, 80, 596),
  elevation: FLOOR_HEIGHT,
};
