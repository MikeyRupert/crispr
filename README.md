# CRISPR Guide Modifier

A simple, browser-based tool for designing and annotating CRISPR guide RNAs. Built for researchers who need hands-on control over guide construction — choose your Cas system, enter a spacer, toggle individual positions between RNA and DNA, and apply chemical modifications position-by-position.

## What It Does

This tool lets you manually build CRISPR guide RNA sequences with fine-grained control over base chemistry and modifications. Instead of relying on automated pipelines that output fixed guides, you interactively construct each guide and see the full annotated sequence in real time.

- **Cas system support** — Built-in presets for Cas12a (TTTV PAM) and Cas9 (NGG PAM), plus the ability to define custom systems with your own PAM, scaffold, orientation, and spacer length.
- **Position-level editing** — Click any base to toggle it between RNA and DNA. Right-click to apply a chemical modification (Biotin, Thiol, Alkynes, 5'/3' Phosphorylation).
- **Reusable patterns** — Save repeat/spacer modification layouts as patterns and apply them to new guides with matching system parameters.
- **Import & export** — Upload spacers from CSV, TSV, or Excel files. Export finished guides as CSV or JSON. Import/export patterns as JSON.
- **No backend required** — Runs entirely in the browser. No server, no database, no accounts.

## Project Structure

```
crispr/
  crispr-guide/          # Main application
    src/
      CrisprGuideSelector.tsx   # UI, state, and interaction logic
      crisprGuideCore.ts        # Shared types, guide generation, import/export helpers
      App.tsx                   # App shell
    mcp/                        # MCP server for CRISPR guide tools
    tests/                      # Regression tests
    docs/                       # Documentation and sample data
```

## Getting Started

```bash
cd crispr-guide
bun install
bun run dev
```

Or with npm:

```bash
cd crispr-guide
npm install
npm run dev
```

Open the URL shown in the terminal (usually `http://localhost:5173/`).

## Typical Workflow

1. Enter a gene name and spacer sequence (or import spacers from a file).
2. Select a Cas system — guides are assembled as Repeat + Spacer (Cas12a) or Spacer + Scaffold (Cas9).
3. Click individual bases to convert them to DNA where needed.
4. Right-click bases to apply chemical modifications.
5. Save the guide, or save the modification layout as a reusable pattern.
6. Export your finished guides as CSV or JSON for downstream use.

## Tech Stack

React 19, TypeScript, Vite, Tailwind CSS 4

## License

No license specified.
