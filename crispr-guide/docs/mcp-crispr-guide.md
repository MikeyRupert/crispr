# CRISPR Guide MCP

This project includes a local MCP server that mirrors the app's current guide-design rules.

It starts with:

- the two active built-in systems:
  - `Cas12a_TTTV`
  - `Cas9_NGG`
- the active modification set:
  - `biotin`
  - `thiol`
  - `alkynes`
  - `5_prime_phosphorylation`
  - `3_prime_phosphorylation`
- DNA/RNA position design across the full guide

It does not query outside databases yet. The first version is intentionally focused on building testable designs from known spacer sequences.

## Run It

```bash
bun run mcp:crispr
```

## Tools

### `list_design_options`

Returns:

- supported systems
- supported modifications
- DNA/RNA design rules

### `build_testable_guides`

Builds saved-guide style outputs from known spacers.

Example arguments:

```json
{
  "output_format": "both",
  "designs": [
    {
      "gene_name": "TP53",
      "guide_name": "TP53_biotin_test",
      "system_key": "Cas12a_TTTV",
      "spacer": "GAGTCTCTCAGCTGGTACAC",
      "dna_positions": [1, 4, 22],
      "position_modifications": [
        { "position": 1, "modification_id": "biotin" },
        { "position": 40, "modification_id": "3_prime_phosphorylation" }
      ]
    }
  ]
}
```

Returns structured guide data and, depending on `output_format`, CSV and/or JSON content that can be saved for testing.

## Example MCP Config

Example `mcpServers` entry:

```json
{
  "mcpServers": {
    "crispr-guide": {
      "command": "bun",
      "args": ["run", "mcp:crispr"],
      "cwd": "/Users/mike/Developer/working/crispr-guide"
    }
  }
}
```

If `bun` is not on your `PATH`, replace `command` with the full Bun path.

## Notes

- Positions are 1-based across the full guide.
- CSV export is richer than the current app CSV and includes guide metadata needed for round-tripping.
- This MCP is a local design helper for agents. External guide discovery can be added later as a separate tool.
