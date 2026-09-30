import { ExerciseEquipment } from '@prisma/client';

const { GYM, HOME_BASIC, BODYWEIGHT } = ExerciseEquipment;

// Equipment classification for the one-time exercemus/exercises import
// (ADR-004). Every source exercise ends up with exactly one of the three
// values, or is skipped; nothing is imported with an ambiguous value.
//
// Classification rules:
// - GYM: gym-only, fixed or heavy apparatus (barbells and plates, benches,
//   machines, cables, sleds, plyo boxes, parallel bars, strongman implements).
// - HOME_BASIC: portable fitness gear bought for home use (dumbbells,
//   kettlebells, bands, balls, foam rollers, a pull-up bar, rings, suspension
//   straps, cones, a jump rope).
// - BODYWEIGHT: nothing, or only ordinary household objects (a chair, a belt,
//   a towel, a broomstick, a stair step) or a training partner.
//
// An exercise with several tags gets the most demanding one: GYM beats
// HOME_BASIC beats BODYWEIGHT (a dumbbell press on a bench still needs a gym).

export const EQUIPMENT_PRIORITY: ExerciseEquipment[] = [
  GYM,
  HOME_BASIC,
  BODYWEIGHT,
];

// Every value of the dataset's top-level `equipment` list. A tag missing from
// this table skips the exercise, so dataset drift is never guessed at.
// `other` has no single meaning and is resolved per exercise below.
export const EQUIPMENT_BY_TAG: Record<string, ExerciseEquipment | null> = {
  none: BODYWEIGHT,
  'gym mat': HOME_BASIC,
  dumbbell: HOME_BASIC,
  kettlebell: HOME_BASIC,
  bands: HOME_BASIC,
  'exercise ball': HOME_BASIC,
  'medicine ball': HOME_BASIC,
  'foam roll': HOME_BASIC,
  'pull-up bar': HOME_BASIC,
  barbell: GYM,
  'ez curl bar': GYM,
  bench: GYM,
  'incline bench': GYM,
  machine: GYM,
  cable: GYM,
  other: null,
};

// Per-exercise classification, read from each exercise's instructions. It
// wins over the tags and covers every exercise tagged `other`, plus the ones
// the import spot-check found mistagged `none` (see README.md). A null value
// excludes the exercise: it needs gear none of the three categories describes.
export const EQUIPMENT_BY_EXERCISE_NAME: Record<
  string,
  ExerciseEquipment | null
> = {
  // Tagged `none` upstream, but the instructions need a gym bench, rack,
  // Smith machine, lat pulldown pad, plyo box or V-bar handle.
  'Bench Jump': GYM,
  'Body Tricep Press': GYM,
  'Decline Oblique Crunch': GYM,
  'Decline Reverse Crunch': GYM,
  'Flat Bench Lying Leg Raise': GYM,
  'Flutter Kicks': GYM,
  'Hyperextensions With No Hyperextension Bench': GYM,
  'Inverted Row': GYM,
  'Natural Glute Ham Raise': GYM,
  'Seated Flat Bench Leg Pull-In': GYM,
  'Seated Leg Tucks': GYM,
  'V-Bar Pullup': GYM,

  // Tagged `none` upstream, but the instructions need a pull-up bar, a
  // dumbbell or an exercise ball.
  'Chin-Up': HOME_BASIC,
  'Close-Grip Push-Up off of a Dumbbell': HOME_BASIC,
  'Crunch - Legs On Exercise Ball': HOME_BASIC,
  'Gorilla Chin/Crunch': HOME_BASIC,
  'Hanging Leg Raise': HOME_BASIC,
  'Hanging Pike': HOME_BASIC,
  Pullups: HOME_BASIC,
  'Scapular Pull-Up': HOME_BASIC,
  'Wide-Grip Rear Pull-Up': HOME_BASIC,
  'Wind Sprints': HOME_BASIC,

  // Excluded: needs a vehicle, not training equipment.
  Bicycling: null,
  Skating: null,

  // Strongman implements.
  'Atlas Stone Trainer': GYM,
  'Atlas Stones': GYM,
  'Axle Deadlift': GYM,
  'Car Deadlift': GYM,
  'Circus Bell': GYM,
  "Conan's Wheel": GYM,
  Crucifix: GYM,
  "Farmer's Walk": GYM,
  'Keg Load': GYM,
  'Log Lift': GYM,
  'Power Stairs': GYM,
  'Rickshaw Carry': GYM,
  'Rickshaw Deadlift': GYM,
  'Sandbag Load': GYM,
  'Tire Flip': GYM,
  'Sledgehammer Swings': GYM,
  'Yoke Walk': GYM,

  // Sleds.
  'Backward Drag': GYM,
  'Bear Crawl Sled Drags': GYM,
  'Forward Drag with Press': GYM,
  'Prowler Sprint': GYM,
  'Sled Drag - Harness': GYM,
  'Sled Overhead Backward Walk': GYM,
  'Sled Overhead Triceps Extension': GYM,
  'Sled Push': GYM,
  'Sled Reverse Flye': GYM,
  'Sled Row': GYM,

  // Plyo boxes and benches.
  'Bench Sprint': GYM,
  'Box Jump (Multiple Response)': GYM,
  'Box Skip': GYM,
  'Depth Jump Leap': GYM,
  'Drop Push': GYM,
  'Front Box Jump': GYM,
  'Incline Push-Up Depth Jump': GYM,
  'Lateral Box Jump': GYM,
  'Linear Depth Jump': GYM,
  'Quick Leap': GYM,
  'Side to Side Box Shuffle': GYM,
  'Single-Leg High Box Squat': GYM,
  'Single-Leg Stride Jump': GYM,
  'Single Leg Push-off': GYM,
  'Stride Jump Crossover': GYM,

  // Weight plates.
  'Front Plate Raise': GYM,
  'Lying Face Down Plate Neck Resistance': GYM,
  'Lying Face Up Plate Neck Resistance': GYM,
  'Plate Pinch': GYM,
  'Plate Twist': GYM,
  'Reverse Plate Curls': GYM,
  'Standing Olympic Plate Hand Squeeze': GYM,
  'Svend Press': GYM,

  // Other gym apparatus.
  'Battling Ropes': GYM,
  'Chain Handle Extension': GYM,
  'Chain Press': GYM,
  'Dips (Chest Focus)': GYM,
  'Dips (Triceps Focus)': GYM,
  'Donkey Calf Raises': GYM,
  'Heavy Bag Thrust': GYM,
  'Hyperextensions (Back Extensions)': GYM,
  'Knee/Hip Raise On Parallel Bars': GYM,
  'London Bridges': GYM,
  'Rope Climb': GYM,
  'Seated Band Hamstring Curl': GYM,
  'Seated Head Harness Neck Resistance': GYM,
  'Trap Bar Deadlift': GYM,
  'Weighted Pull Ups': GYM,
  'Weighted Sit-Ups - With Bands': GYM,
  'Weighted Squat': GYM,

  // Pull-up bar, rings and suspension straps.
  'Band Assisted Pull-Up': HOME_BASIC,
  'Bodyweight Mid Row': HOME_BASIC,
  'Gironda Sternum Chins': HOME_BASIC,
  'Inverted Row with Straps': HOME_BASIC,
  'Kipping Muscle Up': HOME_BASIC,
  'Mixed Grip Chin': HOME_BASIC,
  'Muscle Up': HOME_BASIC,
  'One Arm Chin-Up': HOME_BASIC,
  'One Handed Hang': HOME_BASIC,
  'Ring Dips': HOME_BASIC,
  'Rocky Pull-Ups/Pulldowns': HOME_BASIC,
  'Side To Side Chins': HOME_BASIC,
  'Suspended Fallout': HOME_BASIC,
  'Suspended Push-Up': HOME_BASIC,
  'Suspended Reverse Crunch': HOME_BASIC,
  'Suspended Row': HOME_BASIC,
  'Suspended Split Squat': HOME_BASIC,

  // Cones and hurdles.
  'Front Cone Hops (or hurdle hops)': HOME_BASIC,
  'Hurdle Hops': HOME_BASIC,
  'Lateral Cone Hops': HOME_BASIC,
  'Side Hop-Sprint': HOME_BASIC,
  'Single-Cone Sprint Drill': HOME_BASIC,
  'Single-Leg Hop Progression': HOME_BASIC,
  'Single-Leg Lateral Hop': HOME_BASIC,

  // Small portable gear: ab wheel, balance board, muscle roller, a light
  // weight, jump rope, wrist roller.
  'Ab Roller': HOME_BASIC,
  'Anterior Tibialis-SMR': HOME_BASIC,
  'Balance Board': HOME_BASIC,
  'Foot-SMR': HOME_BASIC,
  'Neck-SMR': HOME_BASIC,
  'Otis-Up': HOME_BASIC,
  'Rope Jumping': HOME_BASIC,
  'Wrist Roller': HOME_BASIC,

  // Household objects (chair, belt, towel, broomstick, step) or a partner.
  'Behind Head Chest Stretch': BODYWEIGHT,
  'Chair Leg Extended Stretch': BODYWEIGHT,
  'Chair Upper Body Stretch': BODYWEIGHT,
  'Chest And Front Of Shoulder Stretch': BODYWEIGHT,
  'IT Band and Glute Stretch': BODYWEIGHT,
  'Intermediate Groin Stretch': BODYWEIGHT,
  'Intermediate Hip Flexor and Quad Stretch': BODYWEIGHT,
  'Lying Bent Leg Groin': BODYWEIGHT,
  'Lying Hamstring': BODYWEIGHT,
  'On-Your-Back Quad Stretch': BODYWEIGHT,
  'Overhead Lat': BODYWEIGHT,
  'Peroneals Stretch': BODYWEIGHT,
  'Platform Hamstring Slides': BODYWEIGHT,
  'Posterior Tibialis Stretch': BODYWEIGHT,
  'Quad Stretch': BODYWEIGHT,
  'Round The World Shoulder Stretch': BODYWEIGHT,
  'Seated Hamstring and Calf Stretch': BODYWEIGHT,
  'Standing Biceps Stretch': BODYWEIGHT,
  'Standing Elevated Quad Stretch': BODYWEIGHT,
  'Standing Hamstring and Calf Stretch': BODYWEIGHT,
};
