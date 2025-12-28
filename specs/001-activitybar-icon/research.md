# Research: Activity Bar アイコン更新

## Decision
Update the Activity Bar container icon file at `media/todoex-activitybar.svg` with the provided SVG path while preserving `fill="currentColor"`.

## Rationale
The Activity Bar container already references this SVG path in `package.json`, so updating the existing file ensures the icon changes without altering extension contribution wiring.

## Alternatives considered
- Add a new SVG file and update `package.json` to point to it (rejected: unnecessary change to contributions for a simple asset replacement).
