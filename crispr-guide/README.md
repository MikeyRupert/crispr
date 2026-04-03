# CRISPR Guide RNA Designer

A frontend-only CRISPR guide design tool built with React, TypeScript, Vite, and Tailwind CSS.

The app is designed for fast manual guide construction and annotation. You can enter a gene name, edit a spacer, switch between supported CRISPR systems, toggle RNA/DNA bases position-by-position, apply oligo modifications, save reusable patterns, save finished guides, and import/export design data for reuse.

## What The App Does

- Supports two built-in CRISPR systems:
  - `Cas12a TTTV`
  - `Cas9 NGG`
- Lets you add custom Cas systems with editable PAM, orientation, scaffold/repeat sequence, and spacer length.
- Builds guides from two segments:
  - `Repeat + Spacer` for Cas12a-style systems
  - `Spacer + Scaffold` for Cas9-style systems
- Shows each position as an interactive tile:
  - Click toggles `RNA <-> DNA`
  - Right-click applies the active modification color
- Supports the current modification set:
  - `Biotin`
  - `Thiol`
  - `Alkynes`
  - `5' Phosphorylation`
  - `3' Phosphorylation`
- Generates a color-coded guide sequence preview.
- Saves reusable repeat/spacer patterns with system compatibility metadata.
- Saves guides with gene name, system, PAM, sequence, DNA positions, and modification annotations.
- Imports guides or spacer rows from `JSON`, `CSV/TSV`, and `Excel` through the saved-guides upload.
- Imports and exports guides and patterns as `JSON`.
- Exports saved guides as `CSV`.

The main application lives in [src/CrisprGuideSelector.tsx](/Users/mike/Developer/working/crispr-guide/src/CrisprGuideSelector.tsx).

## Tech Stack

- React 19
- TypeScript
- Vite 8
- Tailwind CSS 4
- ESLint 9
- `xlsx` for CSV/Excel spacer imports

Relevant config files:

- [package.json](/Users/mike/Developer/working/crispr-guide/package.json)
- [vite.config.ts](/Users/mike/Developer/working/crispr-guide/vite.config.ts)
- [tsconfig.json](/Users/mike/Developer/working/crispr-guide/tsconfig.json)
- [eslint.config.js](/Users/mike/Developer/working/crispr-guide/eslint.config.js)

## Getting Started

### Recommended: Bun

This project is configured with `packageManager: bun@1.3.11`.

```bash
bun install
bun run dev
```

### npm Also Works

```bash
npm install
npm run dev
```

Open the local Vite URL shown in the terminal, usually `http://127.0.0.1:5173/` or `http://localhost:5173/`.

## Available Scripts

From [package.json](/Users/mike/Developer/working/crispr-guide/package.json):

```bash
bun run dev
bun run typecheck
bun run lint
bun run build
bun run preview
```

`npm run ...` equivalents also work.

## Typical Workflow

1. Enter a `Gene Name`.
2. Enter or import a spacer sequence.
3. Select the active Cas system.
4. Click sequence tiles to toggle DNA positions.
5. Right-click tiles to apply the active modification.
6. Save the current layout as a reusable pattern if needed.
7. Save the finished guide, or upload guide/spacer files into the saved-guides section.
8. Load a saved guide back into the editor when you want to keep editing it.
9. Export guides or patterns for reuse.

Key UI areas are implemented in [src/CrisprGuideSelector.tsx](/Users/mike/Developer/working/crispr-guide/src/CrisprGuideSelector.tsx):

- Gene name and spacer input: [src/CrisprGuideSelector.tsx#L1377](/Users/mike/Developer/working/crispr-guide/src/CrisprGuideSelector.tsx#L1377)
- Position editor and modification controls: [src/CrisprGuideSelector.tsx#L1546](/Users/mike/Developer/working/crispr-guide/src/CrisprGuideSelector.tsx#L1546)
- Saved patterns: [src/CrisprGuideSelector.tsx#L1675](/Users/mike/Developer/working/crispr-guide/src/CrisprGuideSelector.tsx#L1675)
- Saved guides and bottom upload/import controls: [src/CrisprGuideSelector.tsx#L1835](/Users/mike/Developer/working/crispr-guide/src/CrisprGuideSelector.tsx#L1835)

## Supported Systems And Modifications

Built-in systems are defined in [src/CrisprGuideSelector.tsx#L154](/Users/mike/Developer/working/crispr-guide/src/CrisprGuideSelector.tsx#L154):

- `Cas12a TTTV`
- `Cas9 NGG`

Current modification options are defined in [src/CrisprGuideSelector.tsx#L184](/Users/mike/Developer/working/crispr-guide/src/CrisprGuideSelector.tsx#L184):

- Attachment chemistry and linkers
  - `Biotin`
  - `Thiol`
  - `Alkynes`
- Phosphorylation
  - `5' Phosphorylation`
  - `3' Phosphorylation`

Color behavior:

- RNA positions use cyan/blue styling.
- DNA positions use orange styling.
- Modifications add an overlay and badge color on the same tile.

## Import And Export

### Guide And Spacer Upload

The bottom saved-guides upload accepts:

- `.json`
- `.csv`
- `.tsv`
- `.xls`
- `.xlsx`

Parsing is handled in [src/CrisprGuideSelector.tsx#L435](/Users/mike/Developer/working/crispr-guide/src/CrisprGuideSelector.tsx#L435) and guide normalization is shared from [src/crisprGuideCore.ts](/Users/mike/Developer/working/crispr-guide/src/crisprGuideCore.ts).

Supported input columns:

- `gene`
- `geneName`
- `name`
- `spacer`
- `sequence`
- `target_gene`
- `target`
- `spacer_sequence`

Practical notes:

- Imported spacer rows are turned into saved guides using the active or requested system.
- Imported guide rows are skipped if required sequence data is missing or the spacer length does not match the resolved system.
- Uploaded guides can be loaded back into the editor for further modification.

### Guide Export

Saved guides can be exported as:

- `CSV`
- `JSON`

Guide export helpers:

- CSV: [src/CrisprGuideSelector.tsx#L401](/Users/mike/Developer/working/crispr-guide/src/CrisprGuideSelector.tsx#L401)
- JSON: [src/CrisprGuideSelector.tsx#L429](/Users/mike/Developer/working/crispr-guide/src/CrisprGuideSelector.tsx#L429)

Guide JSON shape is based on `SavedGuide` in [src/CrisprGuideSelector.tsx#L62](/Users/mike/Developer/working/crispr-guide/src/CrisprGuideSelector.tsx#L62):

```json
{
  "version": 1,
  "guides": [
    {
      "name": "guide_1",
      "geneName": "TP53",
      "systemKey": "Cas12a_TTTV",
      "systemName": "Cas12a",
      "pam": "TTTV",
      "part1Label": "Repeat",
      "part1": "TAATTTCTACTAAGTGTAGA",
      "part2Label": "Spacer",
      "part2": "GAGTCTCTCAGCTGGTACAC",
      "dnaPositions": [0, 3],
      "modifications": ["Biotin"],
      "positionModifications": ["P1-1:Biotin"],
      "guide": "rArAr...",
      "part1Len": 20
    }
  ]
}
```

### Pattern Export

Patterns are imported and exported as JSON only.

Pattern JSON shape is based on `SavedPattern` in [src/CrisprGuideSelector.tsx#L49](/Users/mike/Developer/working/crispr-guide/src/CrisprGuideSelector.tsx#L49):

```json
{
  "version": 1,
  "patterns": [
    {
      "name": "pattern_1",
      "systemKey": "Cas12a_TTTV",
      "systemName": "Cas12a",
      "orientation": "repeat_first",
      "part1Label": "Repeat",
      "part2Label": "Spacer",
      "part1Len": 20,
      "totalLen": 40,
      "dnaPositions": [2, 5],
      "assignments": [[0, "biotin"], [21, "3_prime_phosphorylation"]]
    }
  ]
}
```

Pattern export helper:

- JSON: [src/CrisprGuideSelector.tsx#L425](/Users/mike/Developer/working/crispr-guide/src/CrisprGuideSelector.tsx#L425)

## Data Model Notes

Important app types:

- `SavedPattern`: [src/CrisprGuideSelector.tsx#L49](/Users/mike/Developer/working/crispr-guide/src/CrisprGuideSelector.tsx#L49)
- `SavedGuide`: [src/CrisprGuideSelector.tsx#L62](/Users/mike/Developer/working/crispr-guide/src/CrisprGuideSelector.tsx#L62)
- `SpacerRecord`: [src/CrisprGuideSelector.tsx#L79](/Users/mike/Developer/working/crispr-guide/src/CrisprGuideSelector.tsx#L79)
- `CasSystem`: [src/CrisprGuideSelector.tsx#L19](/Users/mike/Developer/working/crispr-guide/src/CrisprGuideSelector.tsx#L19)

Position labels use stable stored tokens and readable display labels:

- Stored internally as `P1-#` / `P2-#`
- Displayed in the UI as `Repeat-#`, `Spacer-#`, or `Scaffold-#`

Label helpers live in [src/CrisprGuideSelector.tsx#L299](/Users/mike/Developer/working/crispr-guide/src/CrisprGuideSelector.tsx#L299).

Patterns are system-aware. A saved pattern can only be applied when system key, orientation, and lengths match the current editor state. Compatibility checks live in [src/CrisprGuideSelector.tsx#L1005](/Users/mike/Developer/working/crispr-guide/src/CrisprGuideSelector.tsx#L1005) and [src/CrisprGuideSelector.tsx#L1752](/Users/mike/Developer/working/crispr-guide/src/CrisprGuideSelector.tsx#L1752).

## Quality Checks

Current validation commands:

```bash
bun run typecheck
bun run lint
bun run build
```

Current status:

- TypeScript typecheck passes
- ESLint passes
- Production build passes

There is no automated unit or integration test runner configured yet. Validation is currently based on typecheck, lint, build, and manual app testing.

## Practical Notes And Known Limitations

- The app is frontend-only. There is no backend, database, or authentication layer.
- Saved guides and patterns are in-memory React state only. If you refresh the page without exporting, they are lost.
- Guide and pattern uploads accept JSON only. Bulk spacer import is the only path that accepts CSV/TSV/Excel.
- Gene filtering for imported spacers is case-insensitive but still exact-string matching.
- Invalid spacer lengths are blocked from guide saves and pattern creation.
- Legacy pattern/guide data may be less reliable than current exports if it predates the newer `P1/P2` position token format.
- This tool helps construct and annotate candidate guides. It does not perform off-target scoring, genome lookup, or experimental ranking.

## Project Structure

```text
src/
  App.tsx
  main.tsx
  CrisprGuideSelector.tsx
  index.css
public/
  favicon.svg
  icons.svg
```

Current architecture notes:

- [src/App.tsx](/Users/mike/Developer/working/crispr-guide/src/App.tsx) is a thin wrapper.
- [src/main.tsx](/Users/mike/Developer/working/crispr-guide/src/main.tsx) mounts the React app.
- [src/CrisprGuideSelector.tsx](/Users/mike/Developer/working/crispr-guide/src/CrisprGuideSelector.tsx) contains the main UI, state, import/export logic, and domain helpers.
- [src/index.css](/Users/mike/Developer/working/crispr-guide/src/index.css) imports Tailwind.

## Development Notes

- The project uses a single large main component today. That keeps the app easy to run, but the file is a candidate for future modularization.
- `xlsx` is lazy-loaded on demand for file imports, which keeps the primary app bundle smaller during normal startup.

## License

No project license file is currently present in the repository.
