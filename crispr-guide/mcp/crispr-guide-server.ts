type JsonRpcId = string | number | null;
type ModificationId =
  | "biotin"
  | "thiol"
  | "alkynes"
  | "5_prime_phosphorylation"
  | "3_prime_phosphorylation";
type Orientation = "repeat_first" | "spacer_first";
type PamSide = "5prime" | "3prime";
type OutputFormat = "json" | "csv" | "both" | "structured";

type CasSystem = {
  key: string;
  name: string;
  short: string;
  pam: string;
  pamSide: PamSide;
  scaffold: string;
  orientation: Orientation;
  spacerLen: number;
};

type ModificationOption = {
  id: ModificationId;
  category: string;
  label: string;
};

type PositionModificationInput = {
  position: number;
  modification_id: ModificationId;
};

type GuideDesignInput = {
  gene_name: string;
  spacer: string;
  guide_name?: string;
  system_key?: string;
  dna_positions?: number[];
  position_modifications?: PositionModificationInput[];
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

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

const SERVER_NAME = "crispr-guide-mcp";
const SERVER_VERSION = "0.1.0";
const DNA_BASES_ONLY = /[^ATCG]/g;
const PROTOCOL_VERSION = "2024-11-05";
const DNA_TO_RNA: Record<string, string> = { A: "A", T: "U", C: "C", G: "G" };
const RNA_TO_DNA: Record<string, string> = { A: "A", U: "T", C: "C", G: "G" };

const CAS_SYSTEMS: Record<string, CasSystem> = {
  Cas12a_TTTV: {
    key: "Cas12a_TTTV",
    name: "Cas12a TTTV",
    short: "Cas12a",
    pam: "TTTV",
    pamSide: "5prime",
    scaffold: "TAATTTCTACTAAGTGTAGA",
    orientation: "repeat_first",
    spacerLen: 20,
  },
  Cas9_NGG: {
    key: "Cas9_NGG",
    name: "Cas9 NGG",
    short: "Cas9",
    pam: "NGG",
    pamSide: "3prime",
    scaffold: "GTTTTAGAGCTAGAAATAGC",
    orientation: "spacer_first",
    spacerLen: 20,
  },
};

const MODIFICATION_OPTIONS: ModificationOption[] = [
  { id: "biotin", category: "Attachment chemistry and linkers", label: "Biotin" },
  { id: "thiol", category: "Attachment chemistry and linkers", label: "Thiol" },
  { id: "alkynes", category: "Attachment chemistry and linkers", label: "Alkynes" },
  { id: "5_prime_phosphorylation", category: "Phosphorylation", label: "5' Phosphorylation" },
  { id: "3_prime_phosphorylation", category: "Phosphorylation", label: "3' Phosphorylation" },
];

const MODIFICATION_MAP = Object.fromEntries(
  MODIFICATION_OPTIONS.map((option) => [option.id, option])
) as Record<ModificationId, ModificationOption>;

const TOOL_DEFINITIONS = [
  {
    name: "list_design_options",
    description:
      "List the currently supported CRISPR systems, active oligo modifications, and DNA/RNA design rules used by the app.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: "build_testable_guides",
    description:
      "Build JSON and/or CSV-ready CRISPR guide designs from known spacer sequences using the app's current systems, DNA/RNA positions, and active modification set.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["designs"],
      properties: {
        output_format: {
          type: "string",
          enum: ["json", "csv", "both", "structured"],
          description: "How to return the generated designs.",
        },
        designs: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["gene_name", "spacer"],
            properties: {
              gene_name: { type: "string" },
              spacer: { type: "string" },
              guide_name: { type: "string" },
              system_key: { type: "string", enum: Object.keys(CAS_SYSTEMS) },
              dna_positions: {
                type: "array",
                items: { type: "integer", minimum: 1 },
                description: "1-based positions across the full guide that should be DNA.",
              },
              position_modifications: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["position", "modification_id"],
                  properties: {
                    position: { type: "integer", minimum: 1 },
                    modification_id: {
                      type: "string",
                      enum: MODIFICATION_OPTIONS.map((option) => option.id),
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
];

function sanitizeDnaSequence(value: unknown) {
  return String(value ?? "")
    .toUpperCase()
    .replace(DNA_BASES_ONLY, "");
}

function getPart1Label(orientation: Orientation) {
  return orientation === "repeat_first" ? "Repeat" : "Spacer";
}

function getPart2Label(orientation: Orientation) {
  return orientation === "repeat_first" ? "Spacer" : "Scaffold";
}

function getStoredPositionToken(position: number, part1Len: number) {
  return position < part1Len
    ? `P1-${position + 1}`
    : `P2-${position - part1Len + 1}`;
}

function escapeCsvField(value: unknown) {
  const raw = String(value ?? "");
  const neutralized =
    /^[=+\-@]/.test(raw) || /^\t/.test(raw) ? `'${raw}` : raw;

  if (
    neutralized.includes('"') ||
    neutralized.includes(",") ||
    neutralized.includes("\n")
  ) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }

  return `"${neutralized}"`;
}

function guideToCsv(rows: SavedGuide[]) {
  const header = [
    "name",
    "geneName",
    "systemKey",
    "systemName",
    "pam",
    "part1_label",
    "part1_seq",
    "part2_label",
    "part2_seq",
    "part1Len",
    "dna_positions",
    "modifications",
    "position_modifications",
    "guide_sequence",
    "spacer",
  ].join(",");

  const lines = rows.map((row) =>
    [
      row.name,
      row.geneName,
      row.systemKey,
      row.systemName,
      row.pam,
      row.part1Label,
      row.part1,
      row.part2Label,
      row.part2,
      row.part1Len,
      row.dnaPositions.map((position) => position + 1).join(";"),
      row.modifications.join("; "),
      row.positionModifications.join("; "),
      row.guide,
      row.part1Label === "Spacer" ? row.part1 : row.part2,
    ]
      .map(escapeCsvField)
      .join(",")
  );

  return `${header}\n${lines.join("\n")}`;
}

function guidesToJson(guides: SavedGuide[]) {
  return JSON.stringify({ version: 1, guides }, null, 2);
}

function dnaToRnaBase(base: string) {
  const mapped = DNA_TO_RNA[base.toUpperCase()];
  if (!mapped) throw new Error(`Invalid DNA base: ${base}`);
  return mapped;
}

function rnaToDnaBase(base: string) {
  const mapped = RNA_TO_DNA[base.toUpperCase()];
  if (!mapped) throw new Error(`Invalid RNA base: ${base}`);
  return mapped;
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

function normalizeDnaPositions(input: unknown, totalLen: number) {
  if (!Array.isArray(input)) return [];

  const positions = [...new Set(input)]
    .map((value) => Number.parseInt(String(value), 10))
    .filter((value) => Number.isInteger(value))
    .map((value) => value - 1);

  for (const position of positions) {
    if (position < 0 || position >= totalLen) {
      throw new Error(`DNA position ${position + 1} is outside the guide length ${totalLen}.`);
    }
  }

  return positions.sort((a, b) => a - b);
}

function normalizePositionModifications(input: unknown, part1Len: number, totalLen: number) {
  if (!Array.isArray(input)) return [];

  return input
    .map((entry) => {
      const typedEntry = (entry ?? {}) as PositionModificationInput;
      const position = Number.parseInt(String(typedEntry.position), 10);
      const modificationId = String(typedEntry.modification_id) as ModificationId;

      if (!Number.isInteger(position) || position < 1 || position > totalLen) {
        throw new Error(
          `Modification position ${typedEntry.position} is outside the guide length ${totalLen}.`
        );
      }

      if (!(modificationId in MODIFICATION_MAP)) {
        throw new Error(`Unsupported modification_id: ${typedEntry.modification_id}`);
      }

      return {
        absoluteIndex: position - 1,
        modificationId,
        label: `${getStoredPositionToken(position - 1, part1Len)}:${MODIFICATION_MAP[modificationId].label}`,
      };
    })
    .sort((a, b) => a.absoluteIndex - b.absoluteIndex);
}

function buildGuide(design: GuideDesignInput, index: number): SavedGuide {
  const systemKey = design.system_key ?? "Cas12a_TTTV";
  const casSystem = CAS_SYSTEMS[systemKey];
  if (!casSystem) throw new Error(`Unsupported system_key: ${systemKey}`);

  const spacer = sanitizeDnaSequence(design.spacer);
  if (spacer.length !== casSystem.spacerLen) {
    throw new Error(
      `Spacer for ${design.gene_name || `design ${index + 1}`} must be exactly ${casSystem.spacerLen} nt for ${casSystem.name}; received ${spacer.length}.`
    );
  }

  const part1Label = getPart1Label(casSystem.orientation);
  const part2Label = getPart2Label(casSystem.orientation);
  const part1 = casSystem.orientation === "repeat_first" ? casSystem.scaffold : spacer;
  const part2 = casSystem.orientation === "repeat_first" ? spacer : casSystem.scaffold;
  const part1Len = part1.length;
  const totalLen = part1.length + part2.length;
  const dnaPositions = normalizeDnaPositions(design.dna_positions, totalLen);
  const positionModifications = normalizePositionModifications(
    design.position_modifications,
    part1Len,
    totalLen
  );

  return {
    name: design.guide_name?.trim() || `${design.gene_name}_guide_${index + 1}`,
    geneName: design.gene_name.trim(),
    systemKey,
    systemName: casSystem.short,
    pam: casSystem.pam,
    part1Label,
    part1,
    part2Label,
    part2,
    dnaPositions,
    modifications: [...new Set(positionModifications.map((entry) => MODIFICATION_MAP[entry.modificationId].label))],
    positionModifications: positionModifications.map((entry) => entry.label),
    guide: generateGuide(part1, part2, dnaPositions).join(""),
    part1Len,
  };
}

function buildToolResult(payload: Record<string, unknown>, summary: string) {
  return {
    content: [{ type: "text", text: summary }],
    structuredContent: payload,
  };
}

function buildErrorResult(message: string) {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

async function handleToolCall(name: string, params: Record<string, unknown> = {}) {
  if (name === "list_design_options") {
    return buildToolResult(
      {
        systems: Object.values(CAS_SYSTEMS).map((system) => ({
          key: system.key,
          name: system.name,
          short: system.short,
          pam: system.pam,
          pam_side: system.pamSide,
          orientation: system.orientation,
          spacer_length: system.spacerLen,
          scaffold_or_repeat: system.scaffold,
        })),
        modifications: MODIFICATION_OPTIONS,
        dna_rna_rules: {
          default_state: "RNA",
          dna_positions_are_1_based_across_full_guide: true,
          storage_tokens: ["P1-#", "P2-#"],
        },
        notes: [
          "This MCP starts with the current active modifications and DNA/RNA design behavior from the app.",
          "It builds designs from known spacer sequences. It does not query external guide databases yet.",
        ],
      },
      "Returned the current CRISPR systems, active modifications, and DNA/RNA design rules."
    );
  }

  if (name === "build_testable_guides") {
    const designs = Array.isArray(params.designs) ? (params.designs as GuideDesignInput[]) : [];
    if (designs.length === 0) {
      return buildErrorResult("build_testable_guides requires a non-empty designs array.");
    }

    const outputFormat = (params.output_format as OutputFormat | undefined) ?? "both";
    const guides = designs.map((design, index) => buildGuide(design, index));
    const response: Record<string, unknown> = {
      guides,
      supported_modifications: MODIFICATION_OPTIONS.map((option) => option.id),
    };

    if (outputFormat === "json" || outputFormat === "both") {
      response.json = {
        filename: "crispr-guide-designs.json",
        content: guidesToJson(guides),
      };
    }

    if (outputFormat === "csv" || outputFormat === "both") {
      response.csv = {
        filename: "crispr-guide-designs.csv",
        content: guideToCsv(guides),
      };
    }

    return buildToolResult(
      response,
      `Built ${guides.length} testable guide design${guides.length === 1 ? "" : "s"} using the current app systems, DNA/RNA positions, and active modifications.`
    );
  }

  return buildErrorResult(`Unknown tool: ${name}`);
}

function writeMessage(message: Record<string, unknown>) {
  const json = JSON.stringify(message);
  const contentLength = Buffer.byteLength(json, "utf8");
  process.stdout.write(
    `Content-Length: ${contentLength}\r\nContent-Type: application/json\r\n\r\n${json}`
  );
}

function sendResponse(id: JsonRpcId, result: Record<string, unknown>) {
  writeMessage({
    jsonrpc: "2.0",
    id,
    result,
  });
}

function sendError(id: JsonRpcId, code: number, message: string) {
  writeMessage({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  });
}

async function handleMessage(message: JsonRpcRequest) {
  if (message.method === "initialize") {
    sendResponse(message.id ?? null, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: SERVER_NAME,
        version: SERVER_VERSION,
      },
    });
    return;
  }

  if (message.method === "notifications/initialized") {
    return;
  }

  if (message.method === "tools/list") {
    sendResponse(message.id ?? null, { tools: TOOL_DEFINITIONS });
    return;
  }

  if (message.method === "tools/call") {
    const toolName = String(message.params?.name ?? "");
    try {
      const result = await handleToolCall(
        toolName,
        (message.params?.arguments as Record<string, unknown> | undefined) ?? {}
      );
      sendResponse(message.id ?? null, result);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      sendResponse(message.id ?? null, buildErrorResult(messageText));
    }
    return;
  }

  if (message.id !== undefined) {
    sendError(message.id, -32601, `Method not found: ${message.method}`);
  }
}

let buffer = Buffer.alloc(0);

process.stdin.on("data", async (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);

  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;

    const headerText = buffer.slice(0, headerEnd).toString("utf8");
    const contentLengthHeader = headerText
      .split("\r\n")
      .find((line) => line.toLowerCase().startsWith("content-length:"));

    if (!contentLengthHeader) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }

    const contentLength = Number.parseInt(contentLengthHeader.split(":")[1]?.trim() ?? "", 10);
    const messageStart = headerEnd + 4;
    const messageEnd = messageStart + contentLength;

    if (buffer.length < messageEnd) return;

    const body = buffer.slice(messageStart, messageEnd).toString("utf8");
    buffer = buffer.slice(messageEnd);

    try {
      const message = JSON.parse(body) as JsonRpcRequest;
      await handleMessage(message);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      sendError(null, -32700, `Parse error: ${messageText}`);
    }
  }
});

process.stdin.resume();
