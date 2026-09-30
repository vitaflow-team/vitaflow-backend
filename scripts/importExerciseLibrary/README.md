# Exercise Library import (one-time)

Seeds the `Exercise` table from the [exercemus/exercises](https://github.com/exercemus/exercises) dataset (ADR-001, ADR-002). It is a one-time production data migration: run it by hand once per database. It is not part of `prisma db seed`, `postinstall` or any setup step.

```bash
cd vitaflow-backend
DATABASE_URL=<target database> yarn exercises:import            # vendored dataset
DATABASE_URL=<target database> yarn exercises:import <path.json>  # another copy
```

The `Exercise` migration must already be applied to the target database.

## Dataset

`data/exercemusExercises.json` is `exercises.json` from exercemus/exercises at commit [`0ee5b742`](https://github.com/exercemus/exercises/blob/0ee5b742928b0c910883fa1c0c2cfaf26c4ee180/exercises.json), vendored byte for byte (it is listed in `.prettierignore`). It holds 872 exercises.

The real field shape, checked against the PRD research (ADR-003):

- `equipment` is a list of tags (not a single value) from 16 values: `none`, `barbell`, `dumbbell`, `ez curl bar`, `bench`, `incline bench`, `machine`, `cable`, `kettlebell`, `bands`, `exercise ball`, `medicine ball`, `foam roll`, `gym mat`, `pull-up bar`, `other`. `gym mat`, `pull-up bar` and `incline bench` are declared but unused.
- `primary_muscles`/`secondary_muscles` use the dataset's 21 muscle names. The file also has a `muscle_groups` map, which `muscleGroupMapping.ts` follows.
- `description` is on only 42 entries. Every entry has `instructions` (a list of steps), but five of those lists are empty.
- Per-record `license`/`license_author` appear on one entry only (`Dumbbell Skullcrusher`, CC-BY-SA 3 by wger.de). Upstream, the other entries come from wger.de and wrkout/exercises.json (Unlicense) without per-record terms. There are no `images`, and 24 entries have a `video`.
- Names are unique (case-insensitive). There is no contraindication or safety field, as ADR-003 expected.

## Mapping

| Exercise field                        | Source                                                                                                                                                                                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                                | `name` (English; translations are fixed later through curation, ADR-002)                                                                                                                                                                             |
| `description`                         | `description` (when present) followed by each `instructions` step, one per line                                                                                                                                                                      |
| `muscleGroup`                         | first `primary_muscles` entry, grouped and named in Portuguese (`muscleGroupMapping.ts`)                                                                                                                                                             |
| `primaryMuscles` / `secondaryMuscles` | copied as-is                                                                                                                                                                                                                                         |
| `equipment`                           | `equipmentMapping.ts` (see below)                                                                                                                                                                                                                    |
| `contraindications`                   | always `[]`; set only through curation (ADR-003)                                                                                                                                                                                                     |
| `imageUrl` / `videoUrl`               | `images[0]` / `video`                                                                                                                                                                                                                                |
| `difficulty`                          | null (not in the dataset)                                                                                                                                                                                                                            |
| `status`                              | `APPROVED`                                                                                                                                                                                                                                           |
| `sourceAttribution` / `sourceLicense` | the record's own `license_author`/`license.short_name` when present; otherwise `exercemus/exercises (wger.de, wrkout/exercises.json)` / `CC-BY-SA 3.0`. ADR-001 treats the dataset as a CC-BY-SA derivative, so the stricter license is the default. |

`equipmentMapping.ts` is the reviewable classification table (ADR-004). Tags map to `GYM`, `HOME_BASIC` or `BODYWEIGHT`, and an exercise with several tags gets the most demanding one. A per-name table overrides the tags. It covers all 121 exercises tagged `other` plus the `none` entries found to be mistagged. Two exercises (`Bicycling`, `Skating`) are excluded, because they need gear that none of the three categories describes. An unknown tag is never guessed: that exercise is skipped.

Skipped entries are logged with the reason. On the pinned dataset that is 7 entries: the 2 exclusions, plus 5 entries with neither a description nor instructions (`description` is required).

## Re-running

Re-running is safe. Before inserting, the script looks for an existing row with the same `name` and `sourceAttribution` and leaves it untouched (counted as "already imported"). If a run is interrupted, start it again. Rows are never updated. To apply a mapping fix to rows that were already imported, edit them through the backoffice.

## Completion log

The script logs the dataset size, the number imported (with a count per equipment value), the number already present, and each skipped entry with its reason. Run against the local development database (PostgreSQL 16 in Docker), 2026-09-29, with the final mapping:

```
Dataset entries: 872
Imported: 865 (GYM=413, HOME_BASIC=271, BODYWEIGHT=181)
Already imported, left untouched: 0
Skipped: 7
```

A second run against the same database logged `Imported: 0 (GYM=0, HOME_BASIC=0, BODYWEIGHT=0)` and `Already imported, left untouched: 865`. The remote Neon database in `.env` cannot be reached from the machine used for this run, so the production import is still to be done by an operator.

## Spot-check (2026-09-29)

The TechSpec flags this mapping as unverified until its first real run (Known Risks). Checks done on the first run:

1. **Random sample.** 20 imported rows (ordered by `md5(name)`) were compared with their source entries' tags and instructions. 18 were correct. `Body Tricep Press` is tagged `none` upstream but needs a bar set in a rack. `Seated Bent-Over Rear Delt Raise` (`dumbbell` → HOME_BASIC) also uses a flat bench; see the known limitation below.
2. **Sweep of `none` entries.** That miss led to a text search of every `none`-tagged entry's instructions for apparatus words. 22 entries tagged `none` actually need a pull-up bar, a gym bench, a rack or Smith machine, a plyo box, a V-bar handle, a dumbbell or an exercise ball. They now have per-name overrides, grouped at the top of the per-name table. Entries that only need a household object (a chair, a wall, a step, a mat that is "optional", or "a box or bench" used as a step) stay `BODYWEIGHT`, following the table's household-object rule.
3. **`other` entries.** All 121 were classified by reading their instructions (for example, `Tire Flip` → GYM, `Muscle Up` → HOME_BASIC, `Quad Stretch` → BODYWEIGHT).

**Known limitation:** 71 of the 119 `dumbbell`-only entries mention a bench, rack or similar apparatus in their instructions. In many of them the bench is incidental (for example, something to sit on). They stay `HOME_BASIC`; auditing them one by one is a curation task for the backoffice, not part of this import.

`importExerciseLibrary.spec.ts` checks these cases against the real dataset. `test/exercise-library-import.e2e-spec.ts` runs the import twice against a real database.
