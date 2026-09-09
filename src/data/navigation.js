/**
 * Walkable network laid over the floor plans.
 *
 * Only the corridor skeleton is authored by hand. Room entry points are derived
 * automatically from the `doors` in `floorplans.js` and joined to the nearest
 * corridor node that can be reached without crossing a wall, so adding a room
 * to a plan usually needs no navigation data at all.
 *
 * Node coordinates are in each level's own plan units, except for the `OUT`
 * network which is authored in world plan units (Block A's frame).
 */

export const WALK_SPEED = 1.35; // metres per second
export const LEVEL_CHANGE_SECONDS = 25;

/** Vertical connectors. Nodes tagged with the same link id are joined floor to floor. */
export const VERTICAL_LINKS = {
  'A.core-stair': { kind: 'stairs', label: 'the main staircase' },
  'A.west-stair': { kind: 'stairs', label: 'the west staircase' },
  'A.east-stair': { kind: 'stairs', label: 'the east staircase' },
  'A.lift': { kind: 'lift', label: 'the lift' },
  'B.core-stair': { kind: 'stairs', label: 'the central staircase' },
  'B.nw-stair': { kind: 'stairs', label: 'the north-west staircase' },
  'B.east-stair': { kind: 'stairs', label: 'the east staircase' },
  'B.lift': { kind: 'lift', label: 'the lift' },
};

/** Horizontal connections between separate networks. */
export const LINKS = [
  { a: 'B3:bridge', b: 'A2:bridge', kind: 'bridge', label: 'the bridge to Block A' },
  { a: 'A1:entrance', b: 'OUT:a-south', kind: 'outdoor' },
  { a: 'B1:main-entrance', b: 'OUT:b-south', kind: 'outdoor' },
  { a: 'B1:side-entrance', b: 'OUT:b-west', kind: 'outdoor' },
  { a: 'B1:east-link', b: 'OUT:between', kind: 'outdoor' },
];

export const NAV = {
  // ---------------------------------------------------------------- Block A
  A1: {
    nodes: {
      'lobby-n': [438, 470],
      'lobby-c': [438, 590],
      'lobby-s': [438, 700],
      'west-corridor': [200, 582],
      'east-corridor': [690, 582],
      'west-of-stairs': [312, 800],
      'east-of-stairs': [564, 800],
      'toilet-lobby': [250, 868],
      'toilet-corner': [315, 868],
      vestibule: [450, 930],
      stairs: [455, 812, { link: 'A.core-stair' }],
      entrance: [450, 1000, { entrance: 'Block A · Main Entrance' }],
    },
    edges: [
      ['lobby-n', 'lobby-c'],
      ['lobby-c', 'lobby-s'],
      ['lobby-c', 'west-corridor'],
      ['lobby-c', 'east-corridor'],
      ['west-corridor', 'west-of-stairs'],
      ['east-corridor', 'east-of-stairs'],
      ['lobby-s', 'west-of-stairs'],
      ['lobby-s', 'east-of-stairs'],
      ['west-of-stairs', 'vestibule'],
      ['east-of-stairs', 'vestibule'],
      ['west-of-stairs', 'toilet-corner'],
      ['toilet-corner', 'toilet-lobby'],
      ['stairs', 'vestibule'],
      ['stairs', 'lobby-s'],
      ['vestibule', 'entrance'],
    ],
  },

  A2: {
    nodes: {
      bridge: [150, 573],
      'bridge-landing': [270, 573],
      'ccna-corridor': [325, 400],
      'west-corridor': [200, 556],
      'lab-corridor': [475, 556],
      'mm1-corridor': [575, 573],
      'ml-corridor': [575, 400],
      'east-corridor': [700, 556],
      'east-wing-n': [575, 700],
      'east-wing-s': [575, 850],
      'east-wing-end': [575, 950],
      'foyer-n': [475, 762],
      foyer: [450, 930],
      'surau-lobby': [300, 900],
      stairs: [455, 828, { link: 'A.core-stair' }],
      lift: [452, 660, { link: 'A.lift' }],
      'west-stairs': [84, 645, { link: 'A.west-stair' }],
      'east-stairs': [842, 557, { link: 'A.east-stair' }],
    },
    edges: [
      ['bridge', 'bridge-landing'],
      ['bridge', 'west-stairs'],
      ['bridge-landing', 'west-corridor'],
      ['bridge-landing', 'ccna-corridor'],
      ['bridge-landing', 'lab-corridor'],
      ['lab-corridor', 'mm1-corridor'],
      ['mm1-corridor', 'ml-corridor'],
      ['mm1-corridor', 'east-corridor'],
      ['east-corridor', 'east-stairs'],
      ['mm1-corridor', 'east-wing-n'],
      ['east-wing-n', 'east-wing-s'],
      ['east-wing-s', 'east-wing-end'],
      ['east-wing-n', 'foyer-n'],
      ['foyer-n', 'stairs'],
      ['stairs', 'foyer'],
      ['foyer', 'east-wing-end'],
      ['foyer', 'surau-lobby'],
      ['lift', 'lab-corridor'],
      ['lift', 'foyer-n'],
    ],
  },

  A3: {
    nodes: {
      'foyer-nw': [280, 440],
      'foyer-n': [447, 440],
      'foyer-ne': [620, 440],
      'foyer-w': [280, 640],
      'foyer-e': [620, 640],
      'foyer-sw': [280, 800],
      'foyer-s': [447, 782],
      'foyer-end': [447, 945],
      'surau-lobby': [300, 935],
      'bk2-lobby': [600, 945],
      stairs: [457, 838, { link: 'A.core-stair' }],
      lift: [460, 640, { link: 'A.lift' }],
      'west-stairs': [80, 555, { link: 'A.west-stair' }],
      'east-stairs': [845, 555, { link: 'A.east-stair' }],
    },
    edges: [
      ['foyer-nw', 'foyer-n'],
      ['foyer-n', 'foyer-ne'],
      ['foyer-nw', 'foyer-w'],
      ['foyer-ne', 'foyer-e'],
      ['foyer-w', 'foyer-sw'],
      ['foyer-sw', 'foyer-s'],
      ['foyer-e', 'foyer-s'],
      ['foyer-n', 'lift'],
      ['lift', 'foyer-s'],
      ['foyer-s', 'stairs'],
      ['stairs', 'foyer-end'],
      ['foyer-end', 'surau-lobby'],
      ['foyer-end', 'bk2-lobby'],
      ['west-stairs', 'foyer-w'],
      ['east-stairs', 'foyer-e'],
    ],
  },

  // ---------------------------------------------------------------- Block B
  B1: {
    nodes: {
      'lab-corridor': [330, 175],
      'concourse-n': [465, 180],
      'concourse-w': [465, 330],
      'concourse-sw': [465, 500],
      'concourse-c': [700, 380],
      'concourse-s': [760, 530],
      'lecturer-lobby': [740, 240],
      'east-notch': [900, 312],
      'dk2-floor': [300, 330],
      'dk1-floor': [330, 510],
      'main-entrance': [760, 586, { entrance: 'Block B · Main Entrance' }],
      'side-entrance': [344, 560, { entrance: 'Block B · Side Entrance' }],
      'east-link': [1008, 312, { entrance: 'Block B · Ground Link to Block A' }],
      stairs: [497, 533, { link: 'B.core-stair' }],
      lift: [442, 537, { link: 'B.lift' }],
      'nw-stairs': [224, 175, { link: 'B.nw-stair' }],
    },
    edges: [
      ['nw-stairs', 'lab-corridor'],
      ['lab-corridor', 'concourse-n'],
      ['concourse-n', 'concourse-w'],
      ['concourse-w', 'concourse-sw'],
      ['concourse-w', 'concourse-c'],
      ['concourse-c', 'lecturer-lobby'],
      ['concourse-c', 'east-notch'],
      ['east-notch', 'east-link'],
      ['concourse-c', 'concourse-s'],
      ['concourse-sw', 'concourse-s'],
      ['concourse-s', 'main-entrance'],
      ['concourse-sw', 'side-entrance'],
      ['concourse-sw', 'stairs'],
      ['concourse-sw', 'lift'],
      ['concourse-w', 'dk2-floor'],
      ['concourse-sw', 'dk1-floor'],
      ['dk2-floor', 'dk1-floor'],
    ],
  },

  B2: {
    nodes: {
      'west-corridor': [240, 300],
      'centre-n': [480, 300],
      'centre-e': [700, 400],
      'centre-s': [480, 620],
      'south-west': [240, 620],
      'north-stairs': [355, 190, { link: 'B.nw-stair' }],
      stairs: [355, 615, { link: 'B.core-stair' }],
      'east-stairs': [829, 588, { link: 'B.east-stair' }],
      lift: [226, 700, { link: 'B.lift' }],
    },
    edges: [
      ['west-corridor', 'centre-n'],
      ['centre-n', 'centre-e'],
      ['centre-n', 'north-stairs'],
      ['west-corridor', 'south-west'],
      ['south-west', 'centre-s'],
      ['centre-s', 'stairs'],
      ['centre-s', 'centre-e'],
      ['centre-e', 'east-stairs'],
      ['south-west', 'lift'],
    ],
  },

  B3: {
    nodes: {
      'corridor-nw': [300, 240],
      'corridor-n': [500, 240],
      'corridor-ne': [660, 240],
      'corridor-w': [240, 400],
      'corridor-c': [500, 400],
      'corridor-e': [760, 400],
      'corridor-sw': [280, 620],
      'corridor-s': [500, 600],
      bridge: [878, 446],
      'north-stairs': [230, 240, { link: 'B.nw-stair' }],
      stairs: [366, 682, { link: 'B.core-stair' }],
      'east-stairs': [809, 501, { link: 'B.east-stair' }],
      lift: [226, 687, { link: 'B.lift' }],
    },
    edges: [
      ['corridor-nw', 'corridor-n'],
      ['corridor-n', 'corridor-ne'],
      ['corridor-nw', 'corridor-w'],
      ['corridor-ne', 'corridor-e'],
      ['corridor-w', 'corridor-c'],
      ['corridor-c', 'corridor-e'],
      ['corridor-c', 'corridor-s'],
      ['corridor-w', 'corridor-sw'],
      ['corridor-sw', 'corridor-s'],
      ['corridor-sw', 'lift'],
      ['corridor-s', 'stairs'],
      ['corridor-e', 'east-stairs'],
      ['corridor-e', 'bridge'],
      ['corridor-nw', 'north-stairs'],
    ],
  },

  // ------------------------------------------------------- outdoor pathways
  // Authored in world plan units and drawn at Block A ground level.
  OUT: {
    world: true,
    elevationLevel: 'A1',
    nodes: {
      'a-south': [450, 1090],
      'south-west': [10, 1090],
      'b-south': [-280, 830],
      between: [40, 440],
      'b-west': [-700, 800],
      'b-south-west': [-500, 860],
    },
    edges: [
      ['a-south', 'south-west'],
      ['south-west', 'between'],
      ['south-west', 'b-south'],
      ['b-south', 'b-south-west'],
      ['b-south-west', 'b-west'],
    ],
  },
};
