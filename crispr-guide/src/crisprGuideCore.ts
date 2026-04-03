export type PamSide = "5prime" | "3prime";
export type Orientation = "repeat_first" | "spacer_first";

export type CasSystem = {
  name: string;
  short: string;
  pam: string;
  pamSide: PamSide;
  scaffold: string;
  orientation: Orientation;
  spacerLen: number;
  builtIn: boolean;
};

export type CasSystems = Record<string, CasSystem>;

export type SavedGuide = {
  name: string;
  geneName: string;
  systemKey: string;
  systemName: string;
  pam: string;
  part1Label: string;
  part1: string;
  part2Label: string;
  part2: string;
  dnaPositions: number[];
  modifications: string[];
  positionModifications: string[];
  guide: string;
  part1Len: number;
};

export type SpacerRecord = {
  id: string;
  name: string;
  geneName: string;
  spacer: string;
};

export type SpreadsheetRow = Record<string, unknown>;

const DNA_BASES_ONLY = /[^ATCG]/g;
const DNA_TO_RNA = { A: "A", T: "U", C: "C", G: "G" };
const RNA_TO_DNA = { A: "A", U: "T", C: "C", G: "G" };

export const DEFAULT_CAS_SYSTEMS: CasSystems = {
  Cas12a_TTTV: {
    name: "Cas12a TTTV",
    short: "Cas12a",
    pam: "TTTV",
    pamSide: "5prime",
    scaffold: "TAATTTCTACTAAGTGTAGA",
    orientation: "repeat_first",
    spacerLen: 20,
    builtIn: true,
  },
  Cas9_NGG: {
    name: "Cas9 NGG",
    short: "Cas9",
    pam: "NGG",
    pamSide: "3prime",
    scaffold: "GTTTTAGAGCTAGAAATAGC",
    orientation: "spacer_first",
    spacerLen: 20,
    builtIn: true,
  },
};

export const DEFAULT_SYSTEM = "Cas12a_TTTV";

function dnaToRnaBase(base: string) {
  const mapped = DNA_TO_RNA[base.toUpperCase() as keyof typeof DNA_TO_RNA];
  if (!mapped) throw new Error(`Invalid DNA base: "${base}"`);
  return mapped;
}

function rnaToDnaBase(base: string) {
  const mapped = RNA_TO_DNA[base.toUpperCase() as keyof typeof RNA_TO_DNA];
  if (!mapped) throw new Error(`Invalid RNA base: "${base}"`);
  return mapped;
}

export function sanitizeDnaSequence(value: unknown) {
  return String(value ?? "")
    .toUpperCase()
    .replace(DNA_BASES_ONLY, "");
}

function normalizeSpacerSequence(value: unknown) {
  return sanitizeDnaSequence(value);
}

export function getPart1Label(orientation: Orientation) {
  return orientation === "repeat_first" ? "Repeat" : "Spacer";
}

export function getPart2Label(orientation: Orientation) {
  return orientation === "repeat_first" ? "Spacer" : "Repeat";
}

function isSpacerLabel(label: string) {
  return label.trim().toLowerCase() === "spacer";
}

function getGuideSpacerSequence(guide: SavedGuide) {
  if (isSpacerLabel(guide.part1Label)) return guide.part1;
  if (isSpacerLabel(guide.part2Label)) return guide.part2;
  return guide.part2;
}

function generateGuide(part1Dna: string, part2Dna: string, dnaPositions: number[]) {
  const part1Rna = [...part1Dna.toUpperCase()].map(dnaToRnaBase);
  const part2Rna = [...part2Dna.toUpperCase()].map(dnaToRnaBase);
  const allRna = [...part1Rna, ...part2Rna];
  const dnaSet = new Set(dnaPositions);

  return allRna.map((rnaBase, index) => {
    if (dnaSet.has(index)) return rnaToDnaBase(rnaBase);
    return `r${rnaBase}`;
  });
}

function normalizeSpacerRecords(rows: SpreadsheetRow[], defaultGeneName = ""): SpacerRecord[] {
  return rows
    .map((row, index) => {
      const geneName = String(
        row.geneName ?? row.gene ?? row.target_gene ?? row.target ?? defaultGeneName ?? ""
      ).trim();
      const spacer = normalizeSpacerSequence(
        row.spacer ?? row.sequence ?? row.spacer_sequence ?? ""
      );
      const name = String(row.name ?? row.id ?? row.label ?? `spacer_${index + 1}`).trim();

      if (!spacer) return null;

      return {
        id: `${geneName || "gene"}-${name}-${index}`,
        name: name || `spacer_${index + 1}`,
        geneName,
        spacer,
      };
    })
    .filter(Boolean) as SpacerRecord[];
}

function parseDelimitedText(value: unknown) {
  return String(value ?? "")
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseOneBasedPositions(value: unknown) {
  return parseDelimitedText(value)
    .map((entry) => Number.parseInt(entry, 10) - 1)
    .filter((entry) => Number.isInteger(entry) && entry >= 0);
}

function parseIntegerField(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) ? parsed : null;
}

export function escapeCsvField(value: unknown) {
  const raw = String(value ?? "");
  const str = /^[=+\-@]/.test(raw) || /^\t/.test(raw) ? `'${raw}` : raw;

  if (str.includes('"') || str.includes(",") || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

export function guideToCsv(rows: SavedGuide[]) {
  const header =
    "name,geneName,systemKey,system,pam,part1_label,part1_seq,part2_label,part2_seq,part1Len,dna_positions,modifications,position_modifications,guide_sequence\n";
  const lines = rows
    .map((guide) =>
      [
        guide.name,
        guide.geneName,
        guide.systemKey,
        guide.systemName,
        guide.pam,
        guide.part1Label,
        guide.part1,
        guide.part2Label,
        guide.part2,
        guide.part1Len,
        guide.dnaPositions.map((position) => position + 1).join(";"),
        guide.modifications.join("; "),
        guide.positionModifications.join("; "),
        guide.guide,
      ]
        .map(escapeCsvField)
        .join(",")
    )
    .join("\n");

  return header + lines;
}

export function resolveImportedSystemKey(
  row: SpreadsheetRow,
  casSystems: CasSystems,
  fallbackSystemKey: string
) {
  const requestedKey = String(row.systemKey ?? "").trim();
  if (requestedKey && casSystems[requestedKey]) return requestedKey;

  const requestedSystem = String(row.system ?? row.systemName ?? "")
    .trim()
    .toLowerCase();
  if (!requestedSystem) return fallbackSystemKey;

  const match = Object.entries(casSystems).find(
    ([key, system]) =>
      key.toLowerCase() === requestedSystem ||
      system.name.toLowerCase() === requestedSystem ||
      system.short.toLowerCase() === requestedSystem
  );

  return match?.[0] ?? fallbackSystemKey;
}

export function normalizeImportedGuideRows(
  rows: SpreadsheetRow[],
  casSystems: CasSystems,
  fallbackSystemKey: string
) {
  const fallbackCas =
    casSystems[fallbackSystemKey] ?? casSystems[Object.keys(casSystems)[0]];

  return rows
    .map((row, index) => {
      const importedSystemKey = resolveImportedSystemKey(row, casSystems, fallbackSystemKey);
      const importedCas = casSystems[importedSystemKey] ?? fallbackCas;
      if (!importedCas) return null;

      const defaultPart1Label = getPart1Label(importedCas.orientation);
      const defaultPart2Label = getPart2Label(importedCas.orientation);
      const spacerRecord = normalizeSpacerRecords([row])[0];
      const spacer = spacerRecord?.spacer ?? "";
      const fallbackName = spacerRecord?.name ?? `guide_${index + 1}`;
      const fallbackGeneName = spacerRecord?.geneName ?? "";
      const part1Label =
        String(row.part1_label ?? row.part1Label ?? defaultPart1Label).trim() ||
        defaultPart1Label;
      const part2Label =
        String(row.part2_label ?? row.part2Label ?? defaultPart2Label).trim() ||
        defaultPart2Label;
      const part1FromRow = sanitizeDnaSequence(row.part1_seq ?? row.part1 ?? "");
      const part2FromRow = sanitizeDnaSequence(row.part2_seq ?? row.part2 ?? "");
      const part1 =
        part1FromRow || (isSpacerLabel(part1Label) ? spacer : importedCas.scaffold);
      const part2 =
        part2FromRow || (isSpacerLabel(part2Label) ? spacer : importedCas.scaffold);

      if (!part1 || !part2) return null;

      const dnaPositions = Array.isArray(row.dnaPositions)
        ? row.dnaPositions.filter((value): value is number => Number.isInteger(value))
        : parseOneBasedPositions(row.dna_positions ?? row.dnaPositions);
      const modifications = Array.isArray(row.modifications)
        ? row.modifications.filter((value): value is string => typeof value === "string")
        : parseDelimitedText(row.modifications);
      const positionModifications = Array.isArray(row.positionModifications)
        ? row.positionModifications.filter(
            (value): value is string => typeof value === "string"
          )
        : parseDelimitedText(row.positionModifications ?? row.position_modifications);
      const parsedPart1Len =
        parseIntegerField(row.part1Len ?? row.part1_len) ?? part1.length;
      const guideString =
        String(row.guide_sequence ?? row.guide ?? "").trim() ||
        generateGuide(part1, part2, dnaPositions).join("");

      const normalizedGuide: SavedGuide = {
        name: String(row.name ?? row.id ?? row.label ?? fallbackName).trim() || fallbackName,
        geneName:
          String(
            row.geneName ?? row.gene ?? row.target_gene ?? row.target ?? fallbackGeneName
          ).trim() || fallbackGeneName,
        systemKey: importedSystemKey,
        systemName:
          String(row.systemName ?? row.system ?? importedCas.short).trim() || importedCas.short,
        pam: String(row.pam ?? importedCas.pam).trim() || importedCas.pam,
        part1Label,
        part1,
        part2Label,
        part2,
        dnaPositions,
        modifications,
        positionModifications,
        guide: guideString,
        part1Len: parsedPart1Len,
      };

      const normalizedSpacer = sanitizeDnaSequence(getGuideSpacerSequence(normalizedGuide));
      if (normalizedSpacer.length !== importedCas.spacerLen) return null;

      return normalizedGuide;
    })
    .filter((guide): guide is SavedGuide => guide !== null);
}
