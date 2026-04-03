import {
  useState,
  useMemo,
  useCallback,
  useEffect,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  DEFAULT_CAS_SYSTEMS,
  DEFAULT_SYSTEM,
  getPart1Label,
  getPart2Label,
  guideToCsv,
  normalizeImportedGuideRows,
  sanitizeDnaSequence,
} from "./crisprGuideCore";

type PamSide = "5prime" | "3prime";
type Orientation = "repeat_first" | "spacer_first";
type ModificationId =
  | "biotin"
  | "thiol"
  | "alkynes"
  | "5_prime_phosphorylation"
  | "3_prime_phosphorylation";

type CasSystem = {
  name: string;
  short: string;
  pam: string;
  pamSide: PamSide;
  scaffold: string;
  orientation: Orientation;
  spacerLen: number;
  builtIn: boolean;
};

type CasSystems = Record<string, CasSystem>;

type ModificationOption = {
  id: ModificationId;
  category: string;
  label: string;
  applications: string[];
  colors: {
    overlay: string;
    badge: string;
  };
  classes: {
    button: string;
    text: string;
  };
};

type PatternAssignment = [number, ModificationId];

type SavedPattern = {
  name: string;
  systemKey: string | null;
  systemName: string;
  orientation: Orientation | null;
  part1Label: string;
  part2Label: string;
  part1Len: number;
  totalLen: number;
  dnaPositions: number[];
  assignments: PatternAssignment[];
};

type SavedGuide = {
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

type SpreadsheetRow = Record<string, unknown>;
type XlsxModule = typeof import("xlsx");

type CasSystemForm = {
  name: string;
  short: string;
  pam: string;
  pamSide: PamSide;
  scaffold: string;
  orientation: Orientation;
  spacerLen: number;
};

type PositionButtonProps = {
  index: number;
  base: string;
  isDna: boolean;
  modificationId?: ModificationId;
  label: string;
  onToggleDna: (index: number) => void;
  onToggleMod: (index: number) => void;
};

type EditableCellProps = {
  value: string;
  placeholder: string;
  onSave: (value: string) => void;
  textClass: string;
  disabled?: boolean;
};

type SavedPositionCellProps = {
  index: number;
  base: string;
  isDna: boolean;
  modificationId?: ModificationId;
};

type PositionTileProps = SavedPositionCellProps & {
  title?: string;
  onClick?: () => void;
  onContextMenu?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
};

type CasSystemEditorProps = {
  systems: CasSystems;
  onUpdate: (systems: CasSystems) => void;
  onClose: () => void;
};

// %% --- Base conversion ---
const DNA_TO_RNA = { A: "A", T: "U", C: "C", G: "G" };
const RNA_TO_DNA = { A: "A", U: "T", C: "C", G: "G" };
function dnaToRnaBase(b: string) {
  const mapped = DNA_TO_RNA[b.toUpperCase()];
  if (!mapped) throw new Error(`Invalid DNA base: "${b}"`);
  return mapped;
}

function rnaToDnaBase(b: string) {
  const mapped = RNA_TO_DNA[b.toUpperCase()];
  if (!mapped) throw new Error(`Invalid RNA base: "${b}"`);
  return mapped;
}

const DEFAULT_GENE_NAME = "funny_gene";
const DEFAULT_SPACER = "ATGCCGTAGTACGTTACGGA";

// %% --- Modification definitions ---
// Color lookup map replaces the deeply-nested ternaries
const MODIFICATION_OPTIONS: ModificationOption[] = [
  {
    id: "biotin",
    category: "Attachment chemistry and linkers",
    label: "Biotin",
    applications: ["DNA arrays", "solid-phase PCR", "NGS"],
    colors: { overlay: "bg-lime-300/70", badge: "bg-lime-300 border-lime-100" },
    classes: {
      button: "bg-lime-500/15 border-lime-400 text-lime-200",
      text: "text-lime-300 font-bold",
    },
  },
  {
    id: "thiol",
    category: "Attachment chemistry and linkers",
    label: "Thiol",
    applications: ["DNA arrays", "solid-phase PCR", "NGS"],
    colors: { overlay: "bg-fuchsia-300/70", badge: "bg-fuchsia-300 border-fuchsia-100" },
    classes: {
      button: "bg-fuchsia-500/15 border-fuchsia-400 text-fuchsia-200",
      text: "text-fuchsia-300 font-bold",
    },
  },
  {
    id: "alkynes",
    category: "Attachment chemistry and linkers",
    label: "Alkynes",
    applications: ["DNA arrays", "solid-phase PCR", "NGS"],
    colors: { overlay: "bg-amber-300/70", badge: "bg-amber-300 border-amber-100" },
    classes: {
      button: "bg-amber-500/15 border-amber-400 text-amber-200",
      text: "text-amber-300 font-bold",
    },
  },
  {
    id: "5_prime_phosphorylation",
    category: "Phosphorylation",
    label: "5' Phosphorylation",
    applications: ["qPCR", "dPCR", "genotyping", "synthetic biology", "NGS"],
    colors: { overlay: "bg-emerald-300/70", badge: "bg-emerald-300 border-emerald-100" },
    classes: {
      button: "bg-emerald-500/15 border-emerald-400 text-emerald-200",
      text: "text-emerald-300 font-bold",
    },
  },
  {
    id: "3_prime_phosphorylation",
    category: "Phosphorylation",
    label: "3' Phosphorylation",
    applications: ["qPCR", "dPCR", "genotyping", "synthetic biology", "NGS"],
    colors: { overlay: "bg-rose-300/70", badge: "bg-rose-300 border-rose-100" },
    classes: {
      button: "bg-rose-500/15 border-rose-400 text-rose-200",
      text: "text-rose-300 font-bold",
    },
  },
];

const MODIFICATION_OPTION_MAP = Object.fromEntries(
  MODIFICATION_OPTIONS.map((option) => [option.id, option])
) as Record<ModificationId, ModificationOption>;

// Default fallback colors when no modification option matches
const FALLBACK_MOD_COLORS = {
  overlay: "bg-sky-300/70",
  badge: "bg-sky-300 border-sky-100",
};

const DNA_OVERLAY_COLORS = {
  overlay: "bg-orange-400/60",
  badge: "bg-orange-300 border-orange-100",
};

const BASE_IDENTITY_THEMES = {
  A: {
    cell: "bg-emerald-950/85 border-emerald-500/45 text-emerald-100",
    text: "text-emerald-300",
  },
  C: {
    cell: "bg-sky-950/85 border-sky-500/45 text-sky-100",
    text: "text-sky-300",
  },
  G: {
    cell: "bg-violet-950/85 border-violet-500/45 text-violet-100",
    text: "text-violet-300",
  },
  T: {
    cell: "bg-rose-950/85 border-rose-500/45 text-rose-100",
    text: "text-rose-300",
  },
  U: {
    cell: "bg-rose-950/85 border-rose-500/45 text-rose-100",
    text: "text-rose-300",
  },
  N: {
    cell: "bg-gray-900/85 border-gray-700 text-gray-100",
    text: "text-gray-300",
  },
} as const;

// %% --- Guide generation ---
function generateGuide(part1Dna: string, part2Dna: string, dnaPositions: number[]) {
  const part1Rna = [...part1Dna.toUpperCase()].map(dnaToRnaBase);
  const part2Rna = [...part2Dna.toUpperCase()].map(dnaToRnaBase);
  const allRna = [...part1Rna, ...part2Rna];
  const dnaSet = new Set(dnaPositions);

  return allRna.map((rnaBase, i) => {
    if (dnaSet.has(i)) return rnaToDnaBase(rnaBase);
    return `r${rnaBase}`;
  });
}

// %% --- Color helpers (replaces nested ternaries) ---
function getModificationColors(modificationId?: ModificationId) {
  if (!modificationId) return null;
  const option = MODIFICATION_OPTION_MAP[modificationId];
  return option?.colors ?? FALLBACK_MOD_COLORS;
}

function getBaseIdentity(base: string) {
  const normalized = String(base ?? "")
    .replace(/^r/i, "")
    .trim()
    .toUpperCase();
  const key = normalized[normalized.length - 1] as keyof typeof BASE_IDENTITY_THEMES | undefined;
  return key && BASE_IDENTITY_THEMES[key] ? key : "N";
}

function getPositionColorClasses(
  base: string,
  modificationId: ModificationId | undefined,
  isDna: boolean
) {
  const baseIdentity = getBaseIdentity(base);
  const baseTheme = BASE_IDENTITY_THEMES[baseIdentity];
  const modColors = getModificationColors(modificationId);

  return {
    cell: `${baseTheme.cell} border`,
    dnaOverlay: isDna ? DNA_OVERLAY_COLORS.overlay : "",
    dnaBadge: isDna ? DNA_OVERLAY_COLORS.badge : "",
    overlay: modColors?.overlay ?? "",
    badge: modColors?.badge ?? "",
    text: [
      baseTheme.text,
      "font-semibold",
      isDna ? "rounded px-0.5 bg-orange-500/16 ring-1 ring-orange-400/35" : "",
      modificationId ? "underline decoration-2 underline-offset-2" : "",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

// %% --- Helpers for computing labels ---
function getDisplayPartLabel(label: string) {
  return label === "Scaffold" ? "Repeat" : label;
}

function getSegmentThemeClasses(label: string) {
  const displayLabel = getDisplayPartLabel(label);

  if (displayLabel === "Repeat") {
    return {
      badge: "bg-emerald-500/14 border border-emerald-400/60 text-emerald-200",
      panel:
        "bg-[linear-gradient(135deg,rgba(16,185,129,0.14),rgba(13,148,136,0.08))] border border-emerald-500/25",
      button:
        "bg-emerald-500/16 border border-emerald-400/65 text-emerald-200 hover:bg-emerald-500/24",
      ghostButton:
        "bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 hover:bg-emerald-500/18",
      accent: "text-emerald-200",
    };
  }

  return {
    badge: "bg-fuchsia-500/14 border border-fuchsia-400/60 text-fuchsia-200",
    panel:
      "bg-[linear-gradient(135deg,rgba(217,70,239,0.14),rgba(225,29,72,0.08))] border border-fuchsia-500/25",
    button:
      "bg-fuchsia-500/16 border border-fuchsia-400/65 text-fuchsia-200 hover:bg-fuchsia-500/24",
    ghostButton:
      "bg-fuchsia-500/10 border border-fuchsia-500/30 text-fuchsia-200 hover:bg-fuchsia-500/18",
    accent: "text-fuchsia-200",
  };
}

function getStoredPositionToken(position: number, part1Len: number) {
  return position < part1Len
    ? `P1-${position + 1}`
    : `P2-${position - part1Len + 1}`;
}

function getDisplayPositionLabel(
  position: number,
  part1Len: number,
  part1Label: string,
  part2Label: string
) {
  return position < part1Len
    ? `${getDisplayPartLabel(part1Label)}-${position + 1}`
    : `${getDisplayPartLabel(part2Label)}-${position - part1Len + 1}`;
}

function formatStoredPositionToken(
  token: string,
  part1Label: string,
  part2Label: string
) {
  const normalizedToken = token.trim().toUpperCase();
  const part1Match = normalizedToken.match(/^P1-(\d+)$/);
  const part2Match = normalizedToken.match(/^P2-(\d+)$/);

  if (part1Match) return `${getDisplayPartLabel(part1Label)}-${part1Match[1]}`;
  if (part2Match) return `${getDisplayPartLabel(part2Label)}-${part2Match[1]}`;

  return token;
}

function formatSavedModificationEntry(
  entry: string,
  part1Label: string,
  part2Label: string
) {
  const [positionToken, modificationLabel] = String(entry).split(":");
  if (!positionToken) return entry;

  const displayPosition = formatStoredPositionToken(positionToken, part1Label, part2Label);
  return modificationLabel ? `${displayPosition}:${modificationLabel}` : displayPosition;
}

function buildSavedGuideModificationMap(guide: SavedGuide) {
  const entries = (guide.positionModifications ?? [])
    .map((entry) => {
      const [positionLabel, modificationLabel] = String(entry).split(":");
      if (!positionLabel || !modificationLabel) return null;

      const modification = MODIFICATION_OPTIONS.find(
        (option) => option.label === modificationLabel
      );
      if (!modification) return null;

      let absoluteIndex = null;
      const normalizedLabel = positionLabel.trim().toUpperCase();

      const part1Match = normalizedLabel.match(/^P1-(\d+)$/);
      const part2Match = normalizedLabel.match(/^P2-(\d+)$/);

      if (part1Match) {
        absoluteIndex = Number.parseInt(part1Match[1], 10) - 1;
      } else if (part2Match) {
        absoluteIndex = guide.part1Len + Number.parseInt(part2Match[1], 10) - 1;
      } else {
        // Backward compatibility with older saved guides like "R3" or "S12".
        const segmentPrefix = positionLabel[0];
        const rawIndex = Number.parseInt(positionLabel.slice(1), 10);
        if (!Number.isInteger(rawIndex)) return null;
        if (guide.part1Label?.[0] === guide.part2Label?.[0]) return null;

        absoluteIndex =
          segmentPrefix === guide.part1Label?.[0]
            ? rawIndex - 1
            : guide.part1Len + rawIndex - 1;
      }

      if (!Number.isInteger(absoluteIndex) || absoluteIndex < 0) return null;
      return [absoluteIndex, modification.id];
    })
    .filter(Boolean);

  return new Map<number, ModificationId>(entries as PatternAssignment[]);
}

function patternsToJson(patterns: SavedPattern[]) {
  return JSON.stringify({ version: 1, patterns }, null, 2);
}

function guidesToJson(guides: SavedGuide[]) {
  return JSON.stringify({ version: 1, guides }, null, 2);
}

// %% --- File download helper (consolidates repeated blob logic) ---
function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Use setTimeout to revoke after the browser has started the download
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let xlsxModulePromise: Promise<XlsxModule> | null = null;

async function loadXlsxModule() {
  if (!xlsxModulePromise) {
    xlsxModulePromise = import("xlsx");
  }
  return xlsxModulePromise;
}

async function parseCsvLikeText(text: string): Promise<SpreadsheetRow[]> {
  const XLSX = await loadXlsxModule();
  const workbook = XLSX.read(text, { type: "string" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<SpreadsheetRow>(firstSheet, { defval: "" });
}

async function parseSpreadsheetRows(file: File): Promise<SpreadsheetRow[]> {
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith(".json")) {
    const text = await file.text();
    const parsed: unknown = JSON.parse(text);
    const parsedObject =
      parsed && typeof parsed === "object" ? (parsed as { spacers?: unknown }) : {};

    return Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsedObject.spacers)
        ? parsedObject.spacers
        : [];
  }

  if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
    const XLSX = await loadXlsxModule();
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json<SpreadsheetRow>(firstSheet, { defval: "" });
  }

  return parseCsvLikeText(await file.text());
}

function isSpacerLabel(label: string) {
  return label.trim().toLowerCase() === "spacer";
}

function getGuideSpacerSequence(guide: SavedGuide) {
  if (isSpacerLabel(guide.part1Label)) return guide.part1;
  if (isSpacerLabel(guide.part2Label)) return guide.part2;
  return guide.part2;
}

// %% --- Cas system key generator ---
function generateSystemKey(name: string) {
  return name
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function slugifyNamePart(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

function buildDefaultGuideDescriptor(guideNumber: number) {
  return `V${guideNumber}`;
}

function buildGuideName(geneName: string, descriptor: string, fallbackNumber: number) {
  const baseGeneName = slugifyNamePart(geneName) || "gene";
  const normalizedDescriptor = slugifyNamePart(descriptor) || buildDefaultGuideDescriptor(fallbackNumber);
  return `${baseGeneName}_${normalizedDescriptor}`;
}

function extractGuideDescriptor(name: string, geneName: string) {
  const normalizedName = slugifyNamePart(name);
  const normalizedGeneName = slugifyNamePart(geneName);

  if (!normalizedName) return "";
  if (!normalizedGeneName) return normalizedName;

  const prefix = `${normalizedGeneName}_`;
  if (normalizedName.startsWith(prefix)) {
    return normalizedName.slice(prefix.length) || normalizedName;
  }

  return normalizedName;
}

function PositionTile({
  index,
  base,
  isDna,
  modificationId,
  title,
  onClick,
  onContextMenu,
}: PositionTileProps) {
  const colorClasses = getPositionColorClasses(base, modificationId, isDna);
  const content = (
    <>
      {isDna && (
        <>
          <span className={`absolute inset-y-0 left-0 w-1/2 ${colorClasses.dnaOverlay}`} />
          <span className={`absolute top-0.5 left-0.5 h-2 w-2 rounded-full border ${colorClasses.dnaBadge}`} />
        </>
      )}
      {modificationId && (
        <>
          <span className={`absolute inset-y-0 right-0 w-1/2 ${colorClasses.overlay}`} />
          <span className={`absolute top-0.5 right-0.5 h-2 w-2 rounded-full border ${colorClasses.badge}`} />
        </>
      )}
      <span className="text-[9px] text-white/65">{(index % 1000) + 1}</span>
      <span className="relative z-10">{base}</span>
    </>
  );

  const baseClassName = `relative overflow-hidden w-8 h-10 rounded text-xs font-bold flex flex-col items-center justify-center ${colorClasses.cell}`;

  if (onClick || onContextMenu) {
    return (
      <button
        type="button"
        onClick={onClick}
        onContextMenu={onContextMenu}
        className={`${baseClassName} transition-all`}
        title={title}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={baseClassName} title={title}>
      {content}
    </div>
  );
}

// %% --- Position button sub-component (extracted from the monolith) ---
function PositionButton({
  index,
  base,
  isDna,
  modificationId,
  label,
  onToggleDna,
  onToggleMod,
}: PositionButtonProps) {
  return (
    <PositionTile
      index={index}
      base={base}
      isDna={isDna}
      modificationId={modificationId}
      onClick={() => onToggleDna(index)}
      onContextMenu={(event) => {
        event.preventDefault();
        onToggleMod(index);
      }}
      title={`Pos ${(index % 1000) + 1} (${label}) - ${isDna ? "DNA" : "RNA"}${modificationId ? ` | ${MODIFICATION_OPTION_MAP[modificationId]?.label}` : ""}`}
    />
  );
}

// %% --- Inline-editable text cell for the saved guides table ---
function EditableCell({ value, placeholder, onSave, textClass, disabled = false }: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== (value ?? "").trim()) {
      onSave(trimmed);
    }
  };

  if (editing) {
    return (
      <input
        autoFocus
        className="bg-gray-950 border border-cyan-500 rounded px-1.5 py-0.5 text-xs w-full min-w-[60px] focus:outline-none text-cyan-300"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <span
      className={`${textClass} ${disabled ? "" : "cursor-text hover:underline hover:decoration-dotted hover:underline-offset-2"}`}
      onMouseDown={
        disabled
          ? undefined
          : (e) => {
              e.stopPropagation();
            }
      }
      onClick={
        disabled
          ? undefined
          : (e) => {
              e.stopPropagation();
              setDraft(value ?? "");
              setEditing(true);
            }
      }
      title={disabled ? undefined : "Click to edit"}
    >
      {value || "\u2014"}
    </span>
  );
}

function SavedPositionCell({ index, base, isDna, modificationId }: SavedPositionCellProps) {
  return (
    <PositionTile
      index={index}
      base={base}
      isDna={isDna}
      modificationId={modificationId}
    />
  );
}

// %% --- Cas System Editor sub-component ---
function CasSystemEditor({ systems, onUpdate, onClose }: CasSystemEditorProps) {
  const [editKey, setEditKey] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [form, setForm] = useState<CasSystemForm>({
    name: "",
    short: "",
    pam: "",
    pamSide: "5prime",
    scaffold: "",
    orientation: "repeat_first",
    spacerLen: 20,
  });

  const startEdit = (key) => {
    const sys = systems[key];
    setForm({
      name: sys.name,
      short: sys.short,
      pam: sys.pam,
      pamSide: sys.pamSide,
      scaffold: sys.scaffold,
      orientation: sys.orientation,
      spacerLen: sys.spacerLen,
    });
    setEditKey(key);
    setAddMode(false);
  };

  const startAdd = () => {
    setForm({
      name: "",
      short: "",
      pam: "",
      pamSide: "5prime",
      scaffold: "",
      orientation: "repeat_first",
      spacerLen: 20,
    });
    setEditKey(null);
    setAddMode(true);
  };

  const handleSave = () => {
    if (!form.name.trim() || !form.pam.trim() || !form.scaffold.trim()) return;

    const normalizedPam = form.pam.toUpperCase().replace(/[^ATCGNRYWSMKVHDB]/g, "");
    const normalizedScaffold = form.scaffold.toUpperCase().replace(/[^ATCG]/g, "");
    const spacerLen = Math.max(10, Math.min(50, Number(form.spacerLen) || 20));

    const entry = {
      name: form.name.trim(),
      short: form.short.trim() || form.name.trim(),
      pam: normalizedPam,
      pamSide: form.pamSide,
      scaffold: normalizedScaffold,
      orientation: form.orientation,
      spacerLen,
      builtIn: false,
    };

    if (addMode) {
      const key = generateSystemKey(form.name);
      if (systems[key]) {
        alert(`A system with key "${key}" already exists. Choose a different name.`);
        return;
      }
      onUpdate({ ...systems, [key]: entry });
    } else if (editKey) {
      onUpdate({ ...systems, [editKey]: { ...entry, builtIn: systems[editKey]?.builtIn ?? false } });
    }

    setEditKey(null);
    setAddMode(false);
  };

  const handleDelete = (key) => {
    const next = { ...systems };
    delete next[key];
    onUpdate(next);
  };

  const handleReset = (key) => {
    if (DEFAULT_CAS_SYSTEMS[key]) {
      onUpdate({ ...systems, [key]: { ...DEFAULT_CAS_SYSTEMS[key] } });
    }
  };

  const isEditing = editKey !== null || addMode;

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-200">Cas System Manager</h3>
        <div className="flex gap-2">
          <button
            onClick={startAdd}
            className="px-3 py-1.5 bg-cyan-700 hover:bg-cyan-600 rounded text-xs font-medium"
          >
            + Add System
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs font-medium"
          >
            Close
          </button>
        </div>
      </div>

      {/* Existing systems list */}
      <div className="space-y-2 mb-4">
        {Object.entries(systems).map(([key, sys]) => (
          <div
            key={key}
            className={`flex items-center justify-between gap-3 flex-wrap bg-gray-950 border rounded-lg p-3 ${
              editKey === key ? "border-cyan-500" : "border-gray-800"
            }`}
          >
            <div className="min-w-0">
              <p className="text-sm text-cyan-300 truncate">{sys.name}</p>
              <p className="text-xs text-gray-500">
                PAM: {sys.pam} ({sys.pamSide === "5prime" ? "5'" : "3'"}) | Repeat: {sys.scaffold.length}nt |
                Spacer: {sys.spacerLen}nt
                {sys.builtIn ? " | Built-in" : " | Custom"}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => startEdit(key)}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs font-medium"
              >
                Edit
              </button>
              {sys.builtIn && DEFAULT_CAS_SYSTEMS[key] && (
                <button
                  onClick={() => handleReset(key)}
                  className="px-3 py-1.5 bg-yellow-700/50 hover:bg-yellow-700 rounded text-xs font-medium text-yellow-200"
                >
                  Reset
                </button>
              )}
              {!sys.builtIn && (
                <button
                  onClick={() => handleDelete(key)}
                  className="px-3 py-1.5 bg-rose-700 hover:bg-rose-600 rounded text-xs font-medium"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Edit / Add form */}
      {isEditing && (
        <div className="bg-gray-950 border border-gray-700 rounded-lg p-4 space-y-3">
          <h4 className="text-xs text-gray-400 font-semibold">
            {addMode ? "Add New System" : `Editing: ${editKey}`}
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Name</label>
              <input
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-cyan-300 focus:border-cyan-500 focus:outline-none"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. SpCas9 NGG"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Short Name</label>
              <input
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-cyan-300 focus:border-cyan-500 focus:outline-none"
                value={form.short}
                onChange={(e) => setForm({ ...form, short: e.target.value })}
                placeholder="e.g. SpCas9"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">PAM (IUPAC codes)</label>
              <input
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-yellow-300 focus:border-cyan-500 focus:outline-none font-mono"
                value={form.pam}
                onChange={(e) => setForm({ ...form, pam: e.target.value.toUpperCase() })}
                placeholder="e.g. NGG or TTTV"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Spacer Length (nt)</label>
              <input
                type="number"
                min={10}
                max={50}
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-cyan-300 focus:border-cyan-500 focus:outline-none"
                value={form.spacerLen}
                onChange={(e) => setForm({ ...form, spacerLen: Number(e.target.value) || 20 })}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">PAM Side</label>
              <select
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-cyan-300 focus:border-cyan-500 focus:outline-none"
                value={form.pamSide}
                onChange={(e) => setForm({ ...form, pamSide: e.target.value as PamSide })}
              >
                <option value="5prime">5' (Cas12a-style)</option>
                <option value="3prime">3' (Cas9-style)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Guide Orientation</label>
              <select
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-cyan-300 focus:border-cyan-500 focus:outline-none"
                value={form.orientation}
                onChange={(e) =>
                  setForm({ ...form, orientation: e.target.value as Orientation })
                }
              >
                <option value="repeat_first">Repeat + Spacer (Cas12a)</option>
                <option value="spacer_first">Spacer + Repeat (Cas9)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-1">
              Repeat / Direct Repeat Sequence (DNA)
            </label>
            <input
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-cyan-300 focus:border-cyan-500 focus:outline-none font-mono"
              value={form.scaffold}
              onChange={(e) =>
                setForm({ ...form, scaffold: sanitizeDnaSequence(e.target.value) })
              }
              placeholder="e.g. TAATTTCTACTAAGTGTAGA"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!form.name.trim() || !form.pam.trim() || !form.scaffold.trim()}
              className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:bg-gray-800 disabled:text-gray-500 rounded text-sm font-medium"
            >
              {addMode ? "Add System" : "Save Changes"}
            </button>
            <button
              onClick={() => {
                setEditKey(null);
                setAddMode(false);
              }}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// %% --- Main component ---
export default function CrisprGuideSelector() {
  // Cas systems are now mutable state
  const [casSystems, setCasSystems] = useState<CasSystems>(() => structuredClone(DEFAULT_CAS_SYSTEMS));
  const [showSystemEditor, setShowSystemEditor] = useState(false);

  const [systemKey, setSystemKey] = useState<string>(DEFAULT_SYSTEM);
  const [spacerDna, setSpacerDna] = useState<string>(DEFAULT_SPACER);
  const [dnaPositions, setDnaPositions] = useState<Set<number>>(new Set());
  const [positionModifications, setPositionModifications] = useState<Map<number, ModificationId>>(
    new Map()
  );
  const [savedGuides, setSavedGuides] = useState<SavedGuide[]>([]);
  const [savedPatterns, setSavedPatterns] = useState<SavedPattern[]>([]);
  const [selectedGuideIndex, setSelectedGuideIndex] = useState<number | null>(null);
  const [multiGuideUpdateMode, setMultiGuideUpdateMode] = useState(false);
  const [selectedGuideIndices, setSelectedGuideIndices] = useState<Set<number>>(new Set());
  const [dragGuideSelectionValue, setDragGuideSelectionValue] = useState<boolean | null>(null);
  const [geneName, setGeneName] = useState(DEFAULT_GENE_NAME);
  const [guideName, setGuideName] = useState(() => buildDefaultGuideDescriptor(1));
  const [patternName, setPatternName] = useState("");
  const [activeModification, setActiveModification] = useState<ModificationId>(
    MODIFICATION_OPTIONS[0].id
  );

  // Fallback: if the active systemKey was deleted, reset to first available
  const cas = casSystems[systemKey] ?? casSystems[Object.keys(casSystems)[0]];
  const effectiveSystemKey = casSystems[systemKey] ? systemKey : Object.keys(casSystems)[0];

  const isRepeatFirst = cas.orientation === "repeat_first";

  const part1Dna = isRepeatFirst ? cas.scaffold : spacerDna;
  const part2Dna = isRepeatFirst ? spacerDna : cas.scaffold;
  const part1Label = getPart1Label(cas.orientation);
  const part2Label = getPart2Label(cas.orientation);

  const part1Bases = [...part1Dna.toUpperCase()];
  const part2Bases = [...part2Dna.toUpperCase()];
  const part1Len = part1Bases.length;
  const totalLen = part1Len + part2Bases.length;
  const part1Theme = getSegmentThemeClasses(part1Label);
  const part2Theme = getSegmentThemeClasses(part2Label);

  const guideParts = useMemo(
    () => generateGuide(part1Dna, part2Dna, [...dnaPositions]),
    [part1Dna, part2Dna, dnaPositions]
  );
  const guideString = guideParts.join("");
  const isSpacerLengthValid = spacerDna.length === cas.spacerLen;

  const selectedModificationList = useMemo(() => {
    const ids = [...new Set(positionModifications.values())];
    return ids
      .map((id) => MODIFICATION_OPTION_MAP[id]?.label ?? id)
      .sort((a, b) => a.localeCompare(b));
  }, [positionModifications]);

  const positionModificationSummary = useMemo(
    () =>
      [...positionModifications.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([pos, modId]) => {
          const segmentLabel = getStoredPositionToken(pos, part1Len);
          return `${segmentLabel}:${MODIFICATION_OPTION_MAP[modId]?.label ?? modId}`;
        }),
    [positionModifications, part1Len]
  );
  const displayPositionModificationSummary = useMemo(
    () =>
      positionModificationSummary.map((entry) =>
        formatSavedModificationEntry(entry, part1Label, part2Label)
      ),
    [positionModificationSummary, part1Label, part2Label]
  );
  const displayDnaPositions = useMemo(
    () =>
      [...dnaPositions]
        .sort((a, b) => a - b)
        .map((position) => getDisplayPositionLabel(position, part1Len, part1Label, part2Label)),
    [dnaPositions, part1Len, part1Label, part2Label]
  );
  const selectedGuideCount = selectedGuideIndices.size;
  const currentGuideLayout = useMemo(
    () => ({
      systemKey: effectiveSystemKey,
      systemName: cas.short,
      pam: cas.pam,
      part1Label,
      part1: part1Dna,
      part2Label,
      part2: part2Dna,
      dnaPositions: [...dnaPositions].sort((a, b) => a - b),
      modifications: selectedModificationList,
      positionModifications: positionModificationSummary,
      guide: guideString,
      part1Len,
    }),
    [
      effectiveSystemKey,
      cas.short,
      cas.pam,
      part1Label,
      part1Dna,
      part2Label,
      part2Dna,
      dnaPositions,
      selectedModificationList,
      positionModificationSummary,
      guideString,
      part1Len,
    ]
  );
  const canRunMultiGuideAction = selectedGuideCount > 0 && isSpacerLengthValid;
  const isPatternCompatible = useCallback(
    (pattern: SavedPattern) =>
      pattern.systemKey === effectiveSystemKey &&
      pattern.orientation === cas.orientation &&
      pattern.part1Len === part1Len &&
      pattern.totalLen === totalLen,
    [effectiveSystemKey, cas.orientation, part1Len, totalLen]
  );

  // %% --- Handlers ---
  const togglePosition = useCallback((pos) => {
    setDnaPositions((prev) => {
      const next = new Set(prev);
      if (next.has(pos)) next.delete(pos);
      else next.add(pos);
      return next;
    });
  }, []);

  const clearAll = () => setDnaPositions(new Set());

  const toggleModificationAtPosition = useCallback(
    (pos) => {
      setPositionModifications((prev) => {
        const next = new Map(prev);
        if (next.get(pos) === activeModification) next.delete(pos);
        else next.set(pos, activeModification);
        return next;
      });
    },
    [activeModification]
  );

  const clearPositionModifications = () => setPositionModifications(new Map());
  const resetSelections = useCallback(() => {
    setDnaPositions(new Set());
    setPositionModifications(new Map());
  }, []);

  // BUG FIX: pattern names must be unique
  const savePattern = () => {
    if (!isSpacerLengthValid) return;

    const dnaEntries = [...dnaPositions].sort((a, b) => a - b);
    const entries = [...positionModifications.entries()].sort((a, b) => a[0] - b[0]) as PatternAssignment[];
    if (entries.length === 0 && dnaEntries.length === 0) return;

    let name = patternName.trim() || `pattern_${savedPatterns.length + 1}`;

    // Ensure uniqueness
    const existingNames = new Set(savedPatterns.map((p) => p.name));
    if (existingNames.has(name)) {
      let counter = 2;
      while (existingNames.has(`${name}_${counter}`)) counter++;
      name = `${name}_${counter}`;
    }

    setSavedPatterns((prev) => [
      ...prev,
      {
        name,
        systemKey: effectiveSystemKey,
        systemName: cas.short,
        orientation: cas.orientation,
        part1Label,
        part2Label,
        part1Len,
        totalLen,
        dnaPositions: dnaEntries,
        assignments: entries,
      },
    ]);
    setPatternName("");
  };

  const applyPattern = (pattern: SavedPattern) => {
    if (!isPatternCompatible(pattern)) return;

    setDnaPositions(new Set(pattern.dnaPositions ?? []));
    setPositionModifications(new Map(pattern.assignments));
  };

  // BUG FIX: remove by index instead of name to avoid deleting duplicates
  const removePattern = (indexToRemove: number) => {
    setSavedPatterns((prev) => prev.filter((_, i) => i !== indexToRemove));
  };

  const clearPart1 = () => {
    setDnaPositions((prev) => {
      const next = new Set(prev);
      for (let i = 0; i < part1Len; i++) next.delete(i);
      return next;
    });
  };

  const clearPart2 = () => {
    setDnaPositions((prev) => {
      const next = new Set(prev);
      for (let i = part1Len; i < totalLen; i++) next.delete(i);
      return next;
    });
  };

  // BUG FIX: also clear positionModifications on system change
  const handleSystemChange = (key: string) => {
    setSystemKey(key);
    resetSelections();
    const newCas = casSystems[key];
    if (newCas && spacerDna.length !== newCas.spacerLen) {
      setSpacerDna(spacerDna.slice(0, newCas.spacerLen));
    }
  };

  const handleCasSystemsUpdate = (updatedSystems: CasSystems) => {
    setCasSystems(updatedSystems);
    // If the current system was deleted, switch to the first available
    if (!updatedSystems[systemKey]) {
      const firstKey = Object.keys(updatedSystems)[0];
      if (firstKey) handleSystemChange(firstKey);
    }
  };

  const saveGuide = () => {
    if (!isSpacerLengthValid) return;

    const name = buildGuideName(geneName, guideName, savedGuides.length + 1);
    const newGuide = {
      name,
      geneName,
      systemKey: effectiveSystemKey,
      systemName: cas.short,
      pam: cas.pam,
      part1Label,
      part1: part1Dna,
      part2Label,
      part2: part2Dna,
      dnaPositions: [...dnaPositions].sort((a, b) => a - b),
      modifications: selectedModificationList,
      positionModifications: positionModificationSummary,
      guide: guideString,
      part1Len,
    };
    setSavedGuides((prev) => {
      const next = [newGuide, ...prev];
      setSelectedGuideIndex(0);
      setSelectedGuideIndices((prevSelected) =>
        prevSelected.size === 0
          ? prevSelected
          : new Set([...prevSelected].map((index) => index + 1))
      );
      return next;
    });
    setGuideName(buildDefaultGuideDescriptor(savedGuides.length + 2));
  };

  const removeGuide = (indexToRemove: number) => {
    setSavedGuides((prev) => prev.filter((_, index) => index !== indexToRemove));
    setSelectedGuideIndices((prev) => {
      const next = new Set<number>();
      prev.forEach((index) => {
        if (index === indexToRemove) return;
        next.add(index > indexToRemove ? index - 1 : index);
      });
      return next;
    });
    setSelectedGuideIndex((prev) => {
      if (prev === null) return null;
      if (prev === indexToRemove) return null;
      if (prev > indexToRemove) return prev - 1;
      return prev;
    });
  };

  const updateGuideField = useCallback((index: number, field: "name" | "geneName", value: string) => {
    setSavedGuides((prev) =>
      prev.map((g, i) => (i === index ? { ...g, [field]: value } : g))
    );
  }, []);
  const toggleMultiGuideUpdateMode = useCallback(() => {
    setMultiGuideUpdateMode((prev) => {
      if (prev) {
        setSelectedGuideIndices(new Set());
        setDragGuideSelectionValue(null);
      }
      return !prev;
    });
  }, []);
  const selectAllGuides = useCallback(() => {
    setSelectedGuideIndices(new Set(savedGuides.map((_, index) => index)));
  }, [savedGuides]);
  const clearSelectedGuides = useCallback(() => {
    setSelectedGuideIndices(new Set());
    setDragGuideSelectionValue(null);
  }, []);
  const getUniqueDuplicateGuideName = useCallback(
    (baseName: string, existingNames: Set<string>) => {
      let candidate = `${baseName}_V1`;
      let counter = 2;

      while (existingNames.has(candidate)) {
        candidate = `${baseName}_V${counter}`;
        counter += 1;
      }

      existingNames.add(candidate);
      return candidate;
    },
    []
  );
  const setGuideSelection = useCallback((index: number, isSelected: boolean) => {
    setSelectedGuideIndices((prev) => {
      const alreadySelected = prev.has(index);
      if (alreadySelected === isSelected) return prev;

      const next = new Set(prev);
      if (isSelected) next.add(index);
      else next.delete(index);
      return next;
    });
  }, []);
  const handleGuideRowMouseDown = useCallback(
    (index: number) => {
      if (!multiGuideUpdateMode) return;

      setSelectedGuideIndex(index);
      const nextSelected = !selectedGuideIndices.has(index);
      setGuideSelection(index, nextSelected);
      setDragGuideSelectionValue(nextSelected);
    },
    [multiGuideUpdateMode, selectedGuideIndices, setGuideSelection]
  );
  const handleGuideRowMouseEnter = useCallback(
    (index: number) => {
      if (!multiGuideUpdateMode || dragGuideSelectionValue === null) return;
      setGuideSelection(index, dragGuideSelectionValue);
    },
    [multiGuideUpdateMode, dragGuideSelectionValue, setGuideSelection]
  );
  const applyMultiGuideUpdate = useCallback(() => {
    if (!canRunMultiGuideAction) return;

    setSavedGuides((prev) =>
      prev.map((guide, index) => {
        if (!selectedGuideIndices.has(index)) return guide;

        // Only update DNA/RNA positions and modifications — keep each guide's own sequences and system
        const newGuide = generateGuide(guide.part1, guide.part2, currentGuideLayout.dnaPositions).join("");

        return {
          ...guide,
          dnaPositions: currentGuideLayout.dnaPositions,
          modifications: currentGuideLayout.modifications,
          positionModifications: currentGuideLayout.positionModifications,
          guide: newGuide,
        };
      })
    );
  }, [canRunMultiGuideAction, currentGuideLayout, selectedGuideIndices]);
  const duplicateSelectedGuides = useCallback(() => {
    if (!canRunMultiGuideAction) return;

    const selectedIndices = [...selectedGuideIndices].sort((a, b) => a - b);
    if (selectedIndices.length === 0) return;

    setSavedGuides((prev) => {
      const existingNames = new Set(prev.map((guide) => guide.name));
      const duplicates = selectedIndices
        .map((index) => prev[index])
        .filter(Boolean)
        .map((guide) => {
          const newGuide = generateGuide(guide.part1, guide.part2, currentGuideLayout.dnaPositions).join("");
          return {
            ...guide,
            name: getUniqueDuplicateGuideName(guide.name, existingNames),
            dnaPositions: currentGuideLayout.dnaPositions,
            modifications: currentGuideLayout.modifications,
            positionModifications: currentGuideLayout.positionModifications,
            guide: newGuide,
          };
        });

      if (duplicates.length === 0) return prev;

      setSelectedGuideIndex(0);
      setSelectedGuideIndices(new Set(duplicates.map((_, index) => index)));
      return [...duplicates, ...prev];
    });
  }, [
    canRunMultiGuideAction,
    currentGuideLayout,
    getUniqueDuplicateGuideName,
    selectedGuideIndices,
  ]);

  useEffect(() => {
    if (dragGuideSelectionValue === null) return undefined;

    const stopDragging = () => setDragGuideSelectionValue(null);
    window.addEventListener("mouseup", stopDragging);
    window.addEventListener("dragend", stopDragging);

    return () => {
      window.removeEventListener("mouseup", stopDragging);
      window.removeEventListener("dragend", stopDragging);
    };
  }, [dragGuideSelectionValue]);

  const loadGuideIntoEditor = useCallback(
    (guide: SavedGuide) => {
      const targetSystemKey = casSystems[guide.systemKey] ? guide.systemKey : effectiveSystemKey;
      const targetCas = casSystems[targetSystemKey] ?? cas;
      const targetPart1Label = getPart1Label(targetCas.orientation);
      const targetPart2Label = getPart2Label(targetCas.orientation);
      const expectedPart1Len =
        targetCas.orientation === "repeat_first" ? targetCas.scaffold.length : targetCas.spacerLen;
      const canRestoreSelections =
        guide.part1Label === targetPart1Label &&
        guide.part2Label === targetPart2Label &&
        guide.part1Len === expectedPart1Len;

      setSystemKey(targetSystemKey);
      setGeneName(guide.geneName);
      setGuideName(extractGuideDescriptor(guide.name, guide.geneName));
      setSpacerDna(sanitizeDnaSequence(getGuideSpacerSequence(guide)));

      if (canRestoreSelections) {
        setDnaPositions(new Set(guide.dnaPositions));
        setPositionModifications(buildSavedGuideModificationMap(guide));
        return;
      }

      resetSelections();
    },
    [casSystems, effectiveSystemKey, cas, resetSelections]
  );

  // Consolidated export handlers using downloadBlob helper
  const exportCsv = () => downloadBlob(guideToCsv(savedGuides), "crispr_guides.csv", "text/csv");
  const exportPatterns = () =>
    downloadBlob(patternsToJson(savedPatterns), "crispr_patterns.json", "application/json");
  const exportGuides = () =>
    downloadBlob(guidesToJson(savedGuides), "crispr_guides.json", "application/json");

  const importPatterns = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const parsedObject =
        parsed && typeof parsed === "object" ? (parsed as { patterns?: unknown }) : {};
      const importedPatterns = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsedObject.patterns)
          ? parsedObject.patterns
          : [];

      const normalizedPatterns = importedPatterns
        .filter((pattern) => pattern && typeof pattern.name === "string")
        .map((pattern, index) => {
          const typedPattern = pattern as Partial<SavedPattern> & Record<string, unknown>;
          const dnaPositions = Array.isArray(typedPattern.dnaPositions)
            ? typedPattern.dnaPositions.filter((value): value is number => Number.isInteger(value))
            : [];
          const assignments = Array.isArray(typedPattern.assignments)
            ? typedPattern.assignments.filter(
                (entry): entry is PatternAssignment =>
                  Array.isArray(entry) &&
                  entry.length === 2 &&
                  Number.isInteger(entry[0]) &&
                  typeof entry[1] === "string" &&
                  entry[1] in MODIFICATION_OPTION_MAP
              )
            : [];

          return {
            name: typedPattern.name || `pattern_${index + 1}`,
            systemKey: typeof typedPattern.systemKey === "string" ? typedPattern.systemKey : null,
            systemName:
              typeof typedPattern.systemName === "string"
                ? typedPattern.systemName
                : "Legacy Pattern",
            orientation:
              typedPattern.orientation === "repeat_first" ||
              typedPattern.orientation === "spacer_first"
                ? typedPattern.orientation
                : null,
            part1Label:
              typeof typedPattern.part1Label === "string" ? typedPattern.part1Label : "Part 1",
            part2Label:
              typeof typedPattern.part2Label === "string" ? typedPattern.part2Label : "Part 2",
            part1Len:
              typeof typedPattern.part1Len === "number" ? typedPattern.part1Len : 20,
            totalLen:
              typeof typedPattern.totalLen === "number" ? typedPattern.totalLen : 40,
            dnaPositions,
            assignments,
          };
        });

      setSavedPatterns(normalizedPatterns);
    } catch (error) {
      console.error("Failed to import patterns", error);
    } finally {
      event.target.value = "";
    }
  };

  const importGuides = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const lowerName = file.name.toLowerCase();
      let normalizedGuides: SavedGuide[] = [];
      let importedRowCount = 0;

      if (lowerName.endsWith(".json")) {
        const text = await file.text();
        const parsed: unknown = JSON.parse(text);
        const parsedObject =
          parsed && typeof parsed === "object" ? (parsed as { guides?: unknown }) : {};
        const importedGuides = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsedObject.guides)
            ? parsedObject.guides
            : [];
        importedRowCount = importedGuides.length;
        normalizedGuides = normalizeImportedGuideRows(
          importedGuides.filter(
            (guide): guide is SpreadsheetRow => guide !== null && typeof guide === "object"
          ),
          casSystems,
          effectiveSystemKey
        );
      } else {
        const parsedRows = await parseSpreadsheetRows(file);
        importedRowCount = parsedRows.length;
        normalizedGuides = normalizeImportedGuideRows(
          parsedRows,
          casSystems,
          effectiveSystemKey
        );
      }

      if (normalizedGuides.length === 0) return;
      if (normalizedGuides.length !== importedRowCount) {
        console.warn(
          `Imported ${normalizedGuides.length} of ${importedRowCount} guide rows. Some rows were skipped because they were incomplete or had the wrong spacer length for their system.`
        );
      }

      setSavedGuides((prev) => {
        const next = [...normalizedGuides, ...prev];
        setSelectedGuideIndex(0);
        setSelectedGuideIndices((prevSelected) =>
          prevSelected.size === 0
            ? prevSelected
            : new Set([...prevSelected].map((index) => index + normalizedGuides.length))
        );
        return next;
      });
    } catch (error) {
      console.error("Failed to import guides", error);
    } finally {
      event.target.value = "";
    }
  };

  // Group systems for the dropdown
  const cpf1Keys = Object.keys(casSystems).filter((k) => casSystems[k].pamSide === "5prime");
  const cas9Keys = Object.keys(casSystems).filter((k) => casSystems[k].pamSide === "3prime");

  const selectedGuide =
    selectedGuideIndex !== null &&
    selectedGuideIndex >= 0 &&
    selectedGuideIndex < savedGuides.length
      ? savedGuides[selectedGuideIndex]
      : null;

  const selectedGuideModificationMap = selectedGuide
    ? buildSavedGuideModificationMap(selectedGuide)
    : new Map();

  // BUG FIX: pre-compute a Set for O(1) lookups instead of O(n) array.includes
  const selectedGuideDnaSet = useMemo(
    () => new Set(selectedGuide?.dnaPositions ?? []),
    [selectedGuide]
  );

  // %% --- Render ---
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 font-mono">
      <div className="mb-6 rounded-[28px] border border-gray-800/80 bg-gray-950/70 px-5 py-5 shadow-[0_24px_80px_rgba(2,6,23,0.55)] backdrop-blur-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-gray-500 mb-2">
              Guide Design Workspace
            </p>
            <h1 className="text-3xl font-semibold text-white">CRISPR Guide RNA Designer</h1>
            <p className="text-gray-400 text-sm mt-2 max-w-3xl">
              Click positions to toggle DNA/RNA bases. RNA stays cyan, DNA stays orange, and repeat/spacer controls now carry their own section colors for faster scanning.
            </p>
          </div>
          <button
            onClick={() => setShowSystemEditor(!showSystemEditor)}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              showSystemEditor
                ? "bg-cyan-700 hover:bg-cyan-600 text-white shadow-[0_10px_30px_rgba(8,145,178,0.28)]"
                : "bg-gray-900 hover:bg-gray-800 text-gray-200 border border-gray-700"
            }`}
          >
            {showSystemEditor ? "Hide Enzyme Editor" : "Edit Cas Enzymes"}
          </button>
        </div>
      </div>

      {/* Cas System Editor */}
      {showSystemEditor && (
        <CasSystemEditor
          systems={casSystems}
          onUpdate={handleCasSystemsUpdate}
          onClose={() => setShowSystemEditor(false)}
        />
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
        <div className="rounded-[28px] border border-gray-800/80 bg-gray-950/65 p-5 shadow-[0_24px_80px_rgba(2,6,23,0.5)] backdrop-blur-sm">
          <div className="grid grid-cols-1 gap-3 mb-6 max-w-2xl">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Gene Name</label>
              <input
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-cyan-300 focus:border-cyan-500 focus:outline-none"
                value={geneName}
                onChange={(e) => setGeneName(e.target.value)}
                placeholder="TP53"
              />
            </div>

            <div>
              <label className="text-xs text-gray-400 block mb-1">
                Spacer (DNA, {cas.spacerLen}nt)
              </label>
              <input
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-cyan-300 focus:border-cyan-500 focus:outline-none"
                value={spacerDna}
                onChange={(e) => {
                  setSpacerDna(sanitizeDnaSequence(e.target.value));
                  resetSelections();
                }}
                maxLength={cas.spacerLen}
              />
              {spacerDna.length > 0 && spacerDna.length < cas.spacerLen && (
                <p className="text-xs text-yellow-400 mt-1">
                  Spacer is {spacerDna.length}nt — expected {cas.spacerLen}nt
                </p>
              )}
            </div>

            <div>
              <label className="text-xs text-gray-400 block mb-1">Cas System</label>
              <select
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-cyan-300 focus:border-cyan-500 focus:outline-none"
                value={effectiveSystemKey}
                onChange={(e) => handleSystemChange(e.target.value)}
              >
                {cpf1Keys.length > 0 && (
                  <optgroup label="Cas12a / Cpf1 (5' PAM, repeat + spacer)">
                    {cpf1Keys.map((k) => (
                      <option key={k} value={k}>
                        {casSystems[k].name} — PAM: {casSystems[k].pam}
                      </option>
                    ))}
                  </optgroup>
                )}
                {cas9Keys.length > 0 && (
                  <optgroup label="Cas9 (3' PAM, spacer + repeat)">
                    {cas9Keys.map((k) => (
                      <option key={k} value={k}>
                        {casSystems[k].name} — PAM: {casSystems[k].pam}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="text-xs px-2.5 py-1 bg-gray-900 border border-gray-700 rounded-full text-yellow-300">
                PAM: {cas.pam} ({cas.pamSide === "5prime" ? "5'" : "3'"})
              </span>
              <span className="text-xs px-2.5 py-1 bg-gray-900 border border-gray-700 rounded-full text-gray-300">
                Guide: {part1Label}({part1Len}) + {part2Label}({part2Bases.length})
              </span>
              <span className="text-xs px-2.5 py-1 bg-gray-900 border border-gray-700 rounded-full text-gray-300">
                Spacer: {cas.spacerLen}nt
              </span>
              <span className="text-xs px-2.5 py-1 bg-gray-900 border border-gray-700 rounded-full text-gray-300">
                Total: {totalLen}nt
              </span>
            </div>

            <div>
              <label className={`text-xs block mb-1 ${part1Theme.accent}`}>
                Repeat (from system — read only)
              </label>
                <div className={`w-full rounded-xl px-3 py-2 text-sm break-all ${part1Theme.panel} text-gray-100`}>
                  {cas.scaffold}
              </div>
            </div>
          </div>

          {/* Position grid */}
          <div className="mb-2">
            <div className="flex items-center gap-3 mb-4 flex-wrap rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
              <span className="text-[11px] uppercase tracking-[0.22em] text-gray-500">Quick actions</span>
              <button
                onClick={clearPart1}
                className={`text-xs px-3 py-1.5 rounded-full transition-colors ${part1Theme.button}`}
              >
                Clear {part1Label}
              </button>
              <button
                onClick={clearPart2}
                className={`text-xs px-3 py-1.5 rounded-full transition-colors ${part2Theme.button}`}
              >
                Clear {part2Label}
              </button>
              <button
                onClick={clearAll}
                className="text-xs px-3 py-1.5 bg-cyan-500/12 border border-cyan-500/35 rounded-full hover:bg-cyan-500/20 text-cyan-200 transition-colors"
              >
                Clear Entire Oligo
              </button>
              <button
                onClick={clearPositionModifications}
                className="text-xs px-3 py-1.5 bg-rose-500/12 border border-rose-500/35 rounded-full hover:bg-rose-500/20 text-rose-200 transition-colors"
              >
                Clear Modification Colors
              </button>
            </div>

            <div className="mb-4 bg-gray-900/75 border border-gray-800 rounded-2xl p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="text-[11px] uppercase tracking-[0.22em] text-gray-500">Active modification</span>
                {MODIFICATION_OPTIONS.map((option) => {
                  const isActive = activeModification === option.id;
                  return (
                    <button
                      key={option.id}
                      onClick={() => setActiveModification(option.id)}
                      className={`px-3 py-1.5 rounded-full border text-xs transition-colors ${
                        isActive
                          ? option.classes.button
                          : "bg-gray-950 border-gray-700 text-gray-300 hover:border-gray-500"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-3 flex-wrap text-xs text-gray-400">
                <span>Click = RNA/DNA</span>
                <span>Right-click = apply active modification color</span>
              </div>
            </div>

            {/* Part 1 positions */}
            <div className={`mb-3 rounded-2xl p-3 ${part1Theme.panel}`}>
              <div className="flex items-start gap-3">
                <span className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-medium ${part1Theme.badge}`}>
                  {part1Label}
                </span>
                <div className="inline-flex flex-wrap gap-0.5">
                  {part1Bases.map((base, i) => (
                    <PositionButton
                      key={`p1-${i}`}
                      index={i}
                      base={base}
                      isDna={dnaPositions.has(i)}
                      modificationId={positionModifications.get(i)}
                      label={part1Label}
                      onToggleDna={togglePosition}
                      onToggleMod={toggleModificationAtPosition}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Part 2 positions */}
            <div className={`rounded-2xl p-3 ${part2Theme.panel}`}>
              <div className="flex items-start gap-3">
                <span className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-medium ${part2Theme.badge}`}>
                  {part2Label}
                </span>
                <div className="inline-flex flex-wrap gap-0.5">
                  {part2Bases.map((base, i) => {
                    const pos = part1Len + i;
                    return (
                      <PositionButton
                        key={`p2-${i}`}
                        index={pos}
                        base={base}
                        isDna={dnaPositions.has(pos)}
                        modificationId={positionModifications.get(pos)}
                        label={part2Label}
                        onToggleDna={togglePosition}
                        onToggleMod={toggleModificationAtPosition}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Generated guide sequence */}
          <div className="mt-6 mb-6">
            <h2 className="text-sm text-gray-300 mb-2">Generated Guide Sequence</h2>
            <div className="bg-gray-900/85 border border-gray-700 rounded-2xl p-4 text-sm break-all leading-relaxed shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
              {guideParts.map((part, i) => {
                const isDna = dnaPositions.has(i);
                const modificationId = positionModifications.get(i);
                const colorClasses = getPositionColorClasses(part, modificationId, isDna);
                return (
                  <span key={i} className={colorClasses.text}>
                    {part}
                  </span>
                );
              })}
            </div>
            <div className="flex items-center gap-2 mt-2 text-xs text-gray-500 flex-wrap">
              <span>
                DNA positions ({dnaPositions.size}):{" "}
                {displayDnaPositions.join(", ") || "none"}
              </span>
              <span>
                Modified positions ({positionModifications.size}):{" "}
                {displayPositionModificationSummary.join(", ") || "none"}
              </span>
            </div>
          </div>
        </div>

        {/* Sidebar: Saved patterns */}
        <aside className="xl:sticky xl:top-6">
          <div className="bg-gray-950/70 border border-gray-800 rounded-[28px] p-4 shadow-[0_24px_80px_rgba(2,6,23,0.45)] backdrop-blur-sm">
            <h3 className="text-sm font-semibold text-gray-200 mb-3">Saved patterns</h3>
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <input
                className="bg-gray-950 border border-gray-700 rounded px-3 py-2 text-sm w-48 focus:border-cyan-500 focus:outline-none"
                placeholder="Pattern name..."
                value={patternName}
                onChange={(e) => setPatternName(e.target.value)}
              />
              <button
                onClick={savePattern}
                disabled={!isSpacerLengthValid}
                className="px-4 py-2 bg-cyan-700 hover:bg-cyan-600 disabled:bg-gray-800 disabled:text-gray-500 rounded text-sm font-medium"
              >
                Create Pattern
              </button>
            </div>
            {!isSpacerLengthValid && (
              <p className="text-xs text-yellow-400 mb-3">
                Enter a full {cas.spacerLen}nt spacer before creating a pattern.
              </p>
            )}
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <button
                onClick={exportPatterns}
                disabled={savedPatterns.length === 0}
                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:bg-gray-800 disabled:text-gray-500 rounded text-sm font-medium"
              >
                Export Patterns
              </button>
              <label className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm font-medium cursor-pointer">
                Upload Patterns
                <input
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={importPatterns}
                />
              </label>
            </div>
            {savedPatterns.length > 0 ? (
              <div className="space-y-3">
                {savedPatterns.map((pattern, patternIndex) => (
                  <div
                    key={`${pattern.name}-${patternIndex}`}
                    className="flex items-center justify-between gap-3 flex-wrap bg-gray-950 border border-gray-800 rounded-lg p-3"
                  >
                    <div>
                      <p className="text-sm text-cyan-300">{pattern.name}</p>
                      <p className="text-xs text-gray-600">
                        {pattern.systemName}
                        {pattern.systemKey ? ` | ${getDisplayPartLabel(pattern.part1Label)} + ${getDisplayPartLabel(pattern.part2Label)}` : " | Legacy pattern"}
                      </p>
                      <p className="text-xs text-gray-500">
                        {pattern.assignments
                          .map(([pos, modId]) => {
                            const segmentLabel = getDisplayPositionLabel(
                              pos,
                              pattern.part1Len,
                              pattern.part1Label,
                              pattern.part2Label
                            );
                            return `${segmentLabel}:${MODIFICATION_OPTION_MAP[modId]?.label ?? modId}`;
                          })
                          .join(", ") || "No modification colors"}
                        {" | "}
                        DNA:{" "}
                        {(pattern.dnaPositions ?? [])
                          .map((pos) =>
                            getDisplayPositionLabel(
                              pos,
                              pattern.part1Len,
                              pattern.part1Label,
                              pattern.part2Label
                            )
                          )
                          .join(", ") || "none"}
                      </p>
                      {!isPatternCompatible(pattern) && (
                        <p className="text-xs text-yellow-400 mt-1">
                          Compatible only with {pattern.systemKey ? pattern.systemName : "the original system this legacy pattern was created on"}.
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => applyPattern(pattern)}
                        disabled={!isPatternCompatible(pattern)}
                        className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-gray-800 disabled:text-gray-500 rounded text-xs font-medium"
                      >
                        Add Pattern
                      </button>
                      <button
                        onClick={() => removePattern(patternIndex)}
                        className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs font-medium"
                      >
                        Remove Pattern
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                Create a reusable repeat/spacer pattern on the right and apply it anytime.
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* Save guide */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="flex items-center rounded-xl border border-gray-700 bg-gray-900/90 overflow-hidden">
          <span className="px-3 py-2 text-xs uppercase tracking-[0.18em] text-gray-400 bg-gray-950/80 border-r border-gray-700">
            {slugifyNamePart(geneName) || "gene"}_
          </span>
          <input
            className="bg-transparent px-3 py-2 text-sm w-48 focus:outline-none text-cyan-200"
            placeholder="variant_1"
            value={guideName}
            onChange={(e) => setGuideName(e.target.value)}
          />
        </div>
        <button
          onClick={saveGuide}
          disabled={!isSpacerLengthValid}
          className="px-4 py-2 bg-cyan-700 hover:bg-cyan-600 disabled:bg-gray-800 disabled:text-gray-500 rounded text-sm font-medium"
        >
          Save Guide
        </button>
        {!isSpacerLengthValid && (
          <span className="text-xs text-yellow-400">
            Spacer must be exactly {cas.spacerLen}nt before saving.
          </span>
        )}
        {savedGuides.length > 0 && (
          <>
            <button
              onClick={exportCsv}
              className="px-4 py-2 bg-green-700 hover:bg-green-600 rounded text-sm font-medium"
            >
              Export CSV ({savedGuides.length})
            </button>
            <button
              onClick={exportGuides}
              className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 rounded text-sm font-medium"
            >
              Export JSON ({savedGuides.length})
            </button>
          </>
        )}
        <label className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm font-medium cursor-pointer">
          Upload Guides / CSV
          <input
            type="file"
            accept=".json,.csv,.tsv,.xls,.xlsx,application/json,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={importGuides}
          />
        </label>
        <span className="text-xs text-gray-500">
          Accepts saved guide JSON and spacer/guide CSV, TSV, or Excel files.
        </span>
      </div>

      {/* Saved guides table */}
      {savedGuides.length > 0 && (
        <div>
          <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
            <h2 className="text-sm text-gray-400">Saved Guides</h2>
            <div className="flex items-center gap-2 flex-wrap">
              {multiGuideUpdateMode && (
                <>
                  <span className="text-xs px-2 py-1 rounded bg-gray-900 border border-gray-700 text-cyan-300">
                    {selectedGuideCount} selected
                  </span>
                  <button
                    onClick={selectAllGuides}
                    className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs font-medium"
                  >
                    Select All
                  </button>
                  <button
                    onClick={clearSelectedGuides}
                    className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs font-medium"
                  >
                    Clear Selected
                  </button>
                </>
              )}
              <button
                onClick={toggleMultiGuideUpdateMode}
                className={`px-3 py-1.5 rounded text-xs font-medium ${
                  multiGuideUpdateMode
                    ? "bg-cyan-700 hover:bg-cyan-600 text-white"
                    : "bg-gray-800 hover:bg-gray-700 text-gray-300"
                }`}
              >
                {multiGuideUpdateMode ? "Multi-Guide Update: On" : "Multi-Guide Update: Off"}
              </button>
            </div>
          </div>

          {multiGuideUpdateMode && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between gap-3 flex-wrap mt-3">
                <span className="text-xs text-gray-500">
                  Applies the current DNA/RNA positions and modifications to selected guides. Each guide keeps its own spacer sequence.
                </span>
                <span className="text-xs text-cyan-300">
                  Drag across rows to paint them selected or unselected.
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={applyMultiGuideUpdate}
                    disabled={!canRunMultiGuideAction}
                    className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:bg-gray-800 disabled:text-gray-500 rounded text-sm font-medium"
                  >
                    Apply
                  </button>
                  <button
                    onClick={duplicateSelectedGuides}
                    disabled={!canRunMultiGuideAction}
                    className="px-4 py-2 bg-cyan-700 hover:bg-cyan-600 disabled:bg-gray-800 disabled:text-gray-500 rounded text-sm font-medium"
                  >
                    Duplicate
                  </button>
                </div>
              </div>
              {!isSpacerLengthValid && (
                <p className="text-xs text-yellow-400 mt-3">
                  Enter a full {cas.spacerLen}nt spacer before applying or duplicating selected guides.
                </p>
              )}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400">
                  <th className="text-left py-2 px-2">Name</th>
                  <th className="text-left py-2 px-2">Gene</th>
                  <th className="text-left py-2 px-2">System</th>
                  <th className="text-left py-2 px-2">PAM</th>
                  <th className="text-left py-2 px-2">Modifications</th>
                  <th className="text-left py-2 px-2">Modified Positions</th>
                  <th className="text-left py-2 px-2">DNA Positions</th>
                  <th className="text-left py-2 px-2">Sequence</th>
                  <th className="text-left py-2 px-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {savedGuides.map((g, idx) => (
                  <tr
                    key={idx}
                    className={`border-b border-gray-800 hover:bg-gray-900 cursor-pointer select-none ${
                      multiGuideUpdateMode && selectedGuideIndices.has(idx)
                        ? "bg-cyan-950/50 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.35)]"
                        : selectedGuideIndex === idx
                          ? "bg-gray-900/80"
                          : ""
                    }`}
                    onMouseDown={() => handleGuideRowMouseDown(idx)}
                    onMouseEnter={() => handleGuideRowMouseEnter(idx)}
                    onClick={() => setSelectedGuideIndex(idx)}
                  >
                    <td className="py-2 px-2 text-cyan-400">
                      <EditableCell
                        value={g.name}
                        placeholder="guide name..."
                        onSave={(val) => updateGuideField(idx, "name", val)}
                        textClass="text-cyan-400"
                        disabled={multiGuideUpdateMode}
                      />
                    </td>
                    <td className="py-2 px-2 text-gray-300">
                      <EditableCell
                        value={g.geneName}
                        placeholder="gene name..."
                        onSave={(val) => updateGuideField(idx, "geneName", val)}
                        textClass="text-gray-300"
                        disabled={multiGuideUpdateMode}
                      />
                    </td>
                    <td className="py-2 px-2 text-gray-300">{g.systemName}</td>
                    <td className="py-2 px-2 text-yellow-300">{g.pam}</td>
                    <td className="py-2 px-2 text-cyan-200 max-w-xs">
                      {g.modifications.length === 0 ? "none" : g.modifications.join(", ")}
                    </td>
                    <td className="py-2 px-2 text-gray-300 max-w-xs">
                      {g.positionModifications.length === 0
                        ? "none"
                        : g.positionModifications
                            .map((entry) =>
                              formatSavedModificationEntry(entry, g.part1Label, g.part2Label)
                            )
                            .join(", ")}
                    </td>
                    <td className="py-2 px-2 text-orange-400">
                      {g.dnaPositions.length === 0
                        ? "none"
                        : g.dnaPositions
                            .map((p) =>
                              getDisplayPositionLabel(
                                p,
                                g.part1Len,
                                g.part1Label,
                                g.part2Label
                              )
                            )
                            .join(", ")}
                    </td>
                    <td className="py-2 px-2 font-mono break-all max-w-md">{g.guide}</td>
                    <td className="py-2 px-2">
                      <div className="flex items-center gap-2">
                        <button
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedGuideIndex(idx);
                            loadGuideIntoEditor(g);
                          }}
                          className="px-3 py-1.5 bg-cyan-700 hover:bg-cyan-600 rounded text-xs font-medium"
                        >
                          Load
                        </button>
                        <button
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeGuide(idx);
                          }}
                          className="px-3 py-1.5 bg-rose-700 hover:bg-rose-600 rounded text-xs font-medium"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Selected saved guide detail */}
      {selectedGuide && (
        <div className="mt-6 mb-6">
          <h2 className="text-sm text-gray-400 mb-2">Selected Saved Guide</h2>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex flex-wrap gap-2 mb-4">
              <span className="text-xs px-2 py-0.5 bg-gray-950 border border-gray-700 rounded text-cyan-300">
                {selectedGuide.name}
              </span>
              <span className="text-xs px-2 py-0.5 bg-gray-950 border border-gray-700 rounded text-gray-300">
                Gene: {selectedGuide.geneName || "\u2014"}
              </span>
              <span className="text-xs px-2 py-0.5 bg-gray-950 border border-gray-700 rounded text-yellow-300">
                PAM: {selectedGuide.pam}
              </span>
              <span className="text-xs px-2 py-0.5 bg-gray-950 border border-gray-700 rounded text-gray-300">
                {selectedGuide.systemName}
              </span>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">
                  {getDisplayPartLabel(selectedGuide.part1Label)}
                </label>
                <div className="inline-flex flex-wrap gap-0.5">
                  {[...selectedGuide.part1].map((base, index) => (
                    <SavedPositionCell
                      key={`selected-part1-${index}`}
                      index={index}
                      base={base}
                      isDna={selectedGuideDnaSet.has(index)}
                      modificationId={selectedGuideModificationMap.get(index)}
                    />
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">
                  {getDisplayPartLabel(selectedGuide.part2Label)}
                </label>
                <div className="inline-flex flex-wrap gap-0.5">
                  {[...selectedGuide.part2].map((base, index) => {
                    const absoluteIndex = selectedGuide.part1Len + index;
                    return (
                      <SavedPositionCell
                        key={`selected-part2-${index}`}
                        index={index}
                        base={base}
                        isDna={selectedGuideDnaSet.has(absoluteIndex)}
                        modificationId={selectedGuideModificationMap.get(absoluteIndex)}
                      />
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Guide sequence</label>
                <div className="bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm break-all text-gray-100">
                  {selectedGuide.guide}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-8 border-t border-gray-800 pt-4 text-xs text-gray-500">
        <div className="flex gap-6 mb-2">
          <span>
            <span className="inline-block w-3 h-3 bg-cyan-900 border border-cyan-700 rounded mr-1" />
            RNA base (rN)
          </span>
          <span>
            <span className="inline-block w-3 h-3 bg-orange-900 border-2 border-orange-400 rounded mr-1" />
            DNA base (N)
          </span>
          <span className="text-gray-400">
            Right-click a base to apply the active modification color
          </span>
        </div>
        <p>
          {cas.short} | PAM: {cas.pam} (
          {cas.pamSide === "5prime" ? "5' of target" : "3' of target"}) | Guide: {part1Label} +{" "}
          {part2Label} = {totalLen}nt
        </p>
      </div>
    </div>
  );
}
