"""
CRISPR Multi-System Guide RNA Pipeline
Generates mixed DNA/RNA guide sequences with selectable DNA base positions.

Supports Cas9 (SpCas9, SaCas9, NmeCas9, StCas9, TdCas9) and Cas12a (AsCpf1, LbCpf1)
with their respective PAMs, scaffolds/repeats, and guide orientations.

Cas9 systems:  guide = spacer + scaffold   (PAM on 3' side of target)
Cas12a systems: guide = repeat + spacer    (PAM on 5' side of target)

Each position is RNA by default (rN notation), but can be switched to DNA (N notation).
RNA uses U; DNA uses T for thymine.
"""

import csv
import re
from dataclasses import dataclass, field

# %% --- Constants ---

DNA_TO_RNA = {"A": "A", "T": "U", "C": "C", "G": "G"}
RNA_TO_DNA = {"A": "A", "U": "T", "C": "C", "G": "G"}

# IUPAC ambiguity codes -> set of matching DNA bases
IUPAC = {
    "A": {"A"}, "T": {"T"}, "C": {"C"}, "G": {"G"},
    "N": {"A", "T", "C", "G"},
    "R": {"A", "G"},        # puRine
    "Y": {"C", "T"},        # pYrimidine
    "W": {"A", "T"},        # Weak
    "S": {"G", "C"},        # Strong
    "M": {"A", "C"},        # aMino
    "K": {"G", "T"},        # Keto
    "V": {"A", "C", "G"},   # not T (V)
    "H": {"A", "C", "T"},   # not G (H)
    "D": {"A", "G", "T"},   # not C (D)
    "B": {"C", "G", "T"},   # not A (B)
}


# %% --- Cas system definitions ---

@dataclass
class CasSystem:
    """Definition of a CRISPR-Cas system."""
    name: str
    short_name: str
    pam: str                    # PAM using IUPAC codes
    pam_side: str               # "5prime" or "3prime" (relative to target DNA)
    scaffold_or_repeat: str     # scaffold (Cas9) or direct repeat (Cas12a) DNA sequence
    guide_orientation: str      # "spacer_first" (Cas9) or "repeat_first" (Cas12a)
    spacer_len: int = 20        # default spacer length
    notes: str = ""


# Well-established sequences from published literature
CAS_SYSTEMS = {
    # --- Cas9 systems (3' PAM, spacer + scaffold) ---
    "SpCas9_NGG": CasSystem(
        name="SpCas9 (S. pyogenes)",
        short_name="SpCas9",
        pam="NGG",
        pam_side="3prime",
        scaffold_or_repeat=(
            "GTTTTAGAGCTAGAAATAGCAAGTTAAAATAAGGCTAGTCCGTTATCAACTTGAAAAAGTGGCACCGAGTCGGTGC"
        ),
        guide_orientation="spacer_first",
        spacer_len=20,
        notes="Most widely used. Chen et al. 2013 optimized scaffold.",
    ),
    "SpCas9_NAG": CasSystem(
        name="SpCas9 NAG (S. pyogenes)",
        short_name="SpCas9-NAG",
        pam="NAG",
        pam_side="3prime",
        scaffold_or_repeat=(
            "GTTTTAGAGCTAGAAATAGCAAGTTAAAATAAGGCTAGTCCGTTATCAACTTGAAAAAGTGGCACCGAGTCGGTGC"
        ),
        guide_orientation="spacer_first",
        spacer_len=20,
        notes="Alternative PAM for SpCas9. Lower efficiency than NGG.",
    ),
    "SpCas9_NG": CasSystem(
        name="SpCas9-NG (engineered)",
        short_name="SpCas9-NG",
        pam="NG",
        pam_side="3prime",
        scaffold_or_repeat=(
            "GTTTTAGAGCTAGAAATAGCAAGTTAAAATAAGGCTAGTCCGTTATCAACTTGAAAAAGTGGCACCGAGTCGGTGC"
        ),
        guide_orientation="spacer_first",
        spacer_len=20,
        notes="Engineered SpCas9 variant with relaxed PAM. Nishimasu et al. 2018.",
    ),
    "SaCas9_NNGRRT": CasSystem(
        name="SaCas9 (S. aureus) NNGRRT",
        short_name="SaCas9",
        pam="NNGRRT",
        pam_side="3prime",
        scaffold_or_repeat=(
            "GTTTTAGTACTCTGGAAACAGAATCTACTAAAACAAGGCAAAATGCCGTGTTTATCTCGTCAACTTGTTGGCGAGA"
        ),
        guide_orientation="spacer_first",
        spacer_len=21,
        notes="Smaller Cas9, fits in AAV. Ran et al. 2015. Strict PAM.",
    ),
    "SaCas9_NNGRR": CasSystem(
        name="SaCas9 (S. aureus) NNGRR",
        short_name="SaCas9-relaxed",
        pam="NNGRR",
        pam_side="3prime",
        scaffold_or_repeat=(
            "GTTTTAGTACTCTGGAAACAGAATCTACTAAAACAAGGCAAAATGCCGTGTTTATCTCGTCAACTTGTTGGCGAGA"
        ),
        guide_orientation="spacer_first",
        spacer_len=21,
        notes="SaCas9 with relaxed PAM (NNGRR instead of NNGRRT).",
    ),
    "NmeCas9": CasSystem(
        name="NmeCas9 (N. meningitidis)",
        short_name="NmeCas9",
        pam="NNNNGATT",
        pam_side="3prime",
        scaffold_or_repeat=(
            "GTTGTAGCTCCCTTTCTCATTTCGGAAACGAAATGAGAACCGTTGCTACAATAAGGCCGTCTGAAAAGATGTGCCGCAACGCTCTGCCCCTTAAAGCTTCTGC"
        ),
        guide_orientation="spacer_first",
        spacer_len=24,
        notes="Small Cas9 (1082 aa). Longer spacer (24nt). Hou et al. 2013.",
    ),
    "St1Cas9": CasSystem(
        name="St1Cas9 (S. thermophilus CRISPR1)",
        short_name="St1Cas9",
        pam="NNAGAAW",
        pam_side="3prime",
        scaffold_or_repeat=(
            "GTTTTTGTACTCTCAAGATTTAAGTAACTGTACAACGAAACTTACACAGTTACTTAAATCTTGCAGAAGCTACAAAGATAAGGCTTCATGCCGAAATCAACACCCTGTCATTTTATGGCAGGGTGTTTTCGTTATTTAA"
        ),
        guide_orientation="spacer_first",
        spacer_len=20,
        notes="S. thermophilus CRISPR1. Muller et al. 2016.",
    ),
    "TdCas9": CasSystem(
        name="TdCas9",
        short_name="TdCas9",
        pam="NAAAAC",
        pam_side="3prime",
        scaffold_or_repeat=(
            "GTTTTAGAGCTATGCTGTTTTGAATGGTCCCAAAAC"
        ),
        guide_orientation="spacer_first",
        spacer_len=20,
        notes="Recognizes NAAAAC PAM. Less commonly used.",
    ),

    # --- Cas12a / Cpf1 systems (5' PAM, repeat + spacer) ---
    "AsCpf1_TTTN": CasSystem(
        name="AsCpf1 (Acidaminococcus sp.) TTTN",
        short_name="AsCpf1",
        pam="TTTN",
        pam_side="5prime",
        scaffold_or_repeat="TAATTTCTACTAAGTGTAGAT",
        guide_orientation="repeat_first",
        spacer_len=20,
        notes="Zetsche et al. 2015. Canonical Cpf1.",
    ),
    "LbCpf1_TTTN": CasSystem(
        name="LbCpf1 (Lachnospiraceae) TTTN",
        short_name="LbCpf1",
        pam="TTTN",
        pam_side="5prime",
        scaffold_or_repeat="TAATTTCTACTCTTGTAGAT",
        guide_orientation="repeat_first",
        spacer_len=20,
        notes="Zetsche et al. 2015. Your original repeat.",
    ),
    "AsCpf1_TTTV": CasSystem(
        name="AsCpf1 TTTV (strict)",
        short_name="AsCpf1-TTTV",
        pam="TTTV",
        pam_side="5prime",
        scaffold_or_repeat="TAATTTCTACTAAGTGTAGAT",
        guide_orientation="repeat_first",
        spacer_len=20,
        notes="Stricter PAM (no TTTT). Higher on-target activity.",
    ),
    "LbCpf1_TTTV": CasSystem(
        name="LbCpf1 TTTV (strict)",
        short_name="LbCpf1-TTTV",
        pam="TTTV",
        pam_side="5prime",
        scaffold_or_repeat="TAATTTCTACTCTTGTAGAT",
        guide_orientation="repeat_first",
        spacer_len=20,
        notes="Stricter PAM (no TTTT). Higher on-target activity.",
    ),
    "Cpf1_RR_TYCV": CasSystem(
        name="AsCpf1/LbCpf1 RR variant",
        short_name="Cpf1-RR",
        pam="TYCV",
        pam_side="5prime",
        scaffold_or_repeat="TAATTTCTACTAAGTGTAGAT",
        guide_orientation="repeat_first",
        spacer_len=20,
        notes="Engineered RR variant. Gao et al. 2017.",
    ),
    "Cpf1_RVR_TATV": CasSystem(
        name="AsCpf1/LbCpf1 RVR variant",
        short_name="Cpf1-RVR",
        pam="TATV",
        pam_side="5prime",
        scaffold_or_repeat="TAATTTCTACTAAGTGTAGAT",
        guide_orientation="repeat_first",
        spacer_len=20,
        notes="Engineered RVR variant. Gao et al. 2017.",
    ),
}

DEFAULT_SYSTEM = "LbCpf1_TTTN"


# %% --- Data classes ---

@dataclass
class GuideConfig:
    """Configuration for a single guide RNA."""
    system_key: str = DEFAULT_SYSTEM
    spacer_dna: str = "GAGTCTCTCAGCTGGTACAC"
    dna_positions: list[int] = field(default_factory=list)  # 0-indexed

    @property
    def cas_system(self) -> CasSystem:
        return CAS_SYSTEMS[self.system_key]

    @property
    def scaffold_or_repeat(self) -> str:
        return self.cas_system.scaffold_or_repeat

    @property
    def pam(self) -> str:
        return self.cas_system.pam

    @property
    def guide_orientation(self) -> str:
        return self.cas_system.guide_orientation

    @property
    def part1_dna(self) -> str:
        """First part of the guide (repeat or spacer depending on system)."""
        if self.guide_orientation == "repeat_first":
            return self.scaffold_or_repeat
        else:
            return self.spacer_dna

    @property
    def part2_dna(self) -> str:
        """Second part of the guide (spacer or scaffold depending on system)."""
        if self.guide_orientation == "repeat_first":
            return self.spacer_dna
        else:
            return self.scaffold_or_repeat

    @property
    def part1_label(self) -> str:
        return "Repeat" if self.guide_orientation == "repeat_first" else "Spacer"

    @property
    def part2_label(self) -> str:
        return "Spacer" if self.guide_orientation == "repeat_first" else "Scaffold"

    @property
    def part1_len(self) -> int:
        return len(self.part1_dna)

    @property
    def part2_len(self) -> int:
        return len(self.part2_dna)

    @property
    def total_len(self) -> int:
        return self.part1_len + self.part2_len


# %% --- Core conversion functions ---

def dna_base_to_rna(base: str) -> str:
    """Convert a single DNA base to its RNA equivalent."""
    base_upper = base.upper()
    if base_upper not in DNA_TO_RNA:
        raise ValueError(f"Invalid DNA base '{base}'. Expected one of: A, T, C, G")
    return DNA_TO_RNA[base_upper]


def rna_base_to_dna(base: str) -> str:
    """Convert a single RNA base to its DNA equivalent."""
    base_upper = base.upper()
    if base_upper not in RNA_TO_DNA:
        raise ValueError(f"Invalid RNA base '{base}'. Expected one of: A, U, C, G")
    return RNA_TO_DNA[base_upper]


def dna_seq_to_rna_bases(dna_seq: str) -> list[str]:
    """Convert a DNA sequence string to a list of RNA bases (no prefix)."""
    return [dna_base_to_rna(b) for b in dna_seq.upper()]


# %% --- IUPAC PAM matching ---

def iupac_match(pam_pattern: str, dna_seq: str) -> bool:
    """Check if a DNA sequence matches an IUPAC-coded PAM pattern."""
    if len(pam_pattern) != len(dna_seq):
        return False
    for p_char, d_char in zip(pam_pattern.upper(), dna_seq.upper()):
        if d_char not in IUPAC.get(p_char, set()):
            return False
    return True


def iupac_to_regex(pam_pattern: str) -> str:
    """Convert an IUPAC PAM pattern to a regex pattern."""
    mapping = {
        "A": "A", "T": "T", "C": "C", "G": "G",
        "N": "[ATCG]", "R": "[AG]", "Y": "[CT]",
        "W": "[AT]", "S": "[GC]", "M": "[AC]", "K": "[GT]",
        "V": "[ACG]", "H": "[ACT]", "D": "[AGT]", "B": "[CGT]",
    }
    return "".join(mapping.get(c.upper(), c) for c in pam_pattern)


def reverse_complement(seq: str) -> str:
    """Return the reverse complement of a DNA sequence (including IUPAC ambiguity codes)."""
    comp = {"A": "T", "T": "A", "C": "G", "G": "C", "N": "N",
            "R": "Y", "Y": "R", "W": "W", "S": "S",
            "M": "K", "K": "M", "V": "B", "B": "V",
            "H": "D", "D": "H"}
    return "".join(comp.get(b, "N") for b in reversed(seq))


def validate_spacer(spacer: str, system_key_or_cas: str | CasSystem) -> list[str]:
    """
    Validate a spacer sequence for a given Cas system.
    Accepts either a system key string (e.g., "LbCpf1_TTTN") or a CasSystem object.
    Returns a list of warning strings (empty list if valid).
    Checks: non-empty, only ATCG characters, and matches expected length.
    """
    if isinstance(system_key_or_cas, str):
        cas_system = CAS_SYSTEMS[system_key_or_cas]
    else:
        cas_system = system_key_or_cas

    warnings = []

    if not spacer:
        warnings.append("Spacer is empty.")
        return warnings

    spacer_upper = spacer.upper()
    if not all(c in "ATCG" for c in spacer_upper):
        warnings.append(f"Spacer contains non-ATCG characters: {spacer}")

    if len(spacer_upper) != cas_system.spacer_len:
        warnings.append(
            f"Spacer length {len(spacer_upper)} does not match expected "
            f"length {cas_system.spacer_len} for {cas_system.short_name}."
        )

    return warnings


# %% --- Guide sequence generation ---

def generate_guide(config: GuideConfig) -> str:
    """
    Generate the mixed DNA/RNA guide string.

    For Cas12a:  repeat + spacer  (positions 0..repeat_len-1 are repeat)
    For Cas9:    spacer + scaffold (positions 0..spacer_len-1 are spacer)

    Positions in config.dna_positions use DNA notation (T, A, G, C).
    All other positions use RNA notation (rU, rA, rG, rC).
    """
    part1_rna = dna_seq_to_rna_bases(config.part1_dna)
    part2_rna = dna_seq_to_rna_bases(config.part2_dna)
    all_rna_bases = part1_rna + part2_rna

    dna_pos_set = set(config.dna_positions)
    parts = []

    for i, rna_base in enumerate(all_rna_bases):
        if i in dna_pos_set:
            dna_base = rna_base_to_dna(rna_base)
            parts.append(dna_base)
        else:
            parts.append(f"r{rna_base}")

    return "".join(parts)


def generate_all_rna(config: GuideConfig) -> str:
    """Generate the fully-RNA guide (no DNA substitutions)."""
    clean = GuideConfig(
        system_key=config.system_key,
        spacer_dna=config.spacer_dna,
        dna_positions=[],
    )
    return generate_guide(clean)


# %% --- Position helpers ---

def describe_position(pos: int, config: GuideConfig) -> str:
    """Human-readable description of a position."""
    if pos < config.part1_len:
        return f"{config.part1_label} pos {pos + 1}"
    else:
        return f"{config.part2_label} pos {pos - config.part1_len + 1}"


def parse_position_input(text: str, part1_len: int = 20) -> list[int]:
    """
    Parse a flexible position input string.
    Accepts: "1,5,21" or "1-5,21" or "P1:5,P2:1,P2:3"
             or "R1,R5,S1,S3" (legacy, R=part1, S=part2).
    Returns 0-indexed positions. Negative positions are skipped.
    """
    positions = []
    for part in text.strip().split(","):
        part = part.strip().upper()
        if not part:
            continue

        if part.startswith("R") or part.startswith("P1:"):
            prefix = "R" if part.startswith("R") else "P1:"
            num = int(part[len(prefix):]) - 1
            if num >= 0:
                positions.append(num)
        elif part.startswith("S") or part.startswith("P2:"):
            prefix = "S" if part.startswith("S") else "P2:"
            num = int(part[len(prefix):]) - 1 + part1_len
            if num >= 0:
                positions.append(num)
        elif "-" in part:
            start, end = part.split("-")
            for n in range(int(start) - 1, int(end)):
                if n >= 0:
                    positions.append(n)
        else:
            num = int(part) - 1
            if num >= 0:
                positions.append(num)

    return sorted(set(positions))


# %% --- Target finding (multi-system) ---

def find_targets(
    sequence: str,
    system_key: str = DEFAULT_SYSTEM,
) -> list[dict]:
    """
    Find all target sites for a given Cas system in a DNA sequence.
    Handles both 5' PAM (Cas12a) and 3' PAM (Cas9) systems.
    Searches both strands using reverse complement.
    """
    cas = CAS_SYSTEMS[system_key]
    targets = []
    seq_upper = sequence.upper()
    pam_len = len(cas.pam)
    sp_len = cas.spacer_len

    def _search_strand(seq: str, strand: str):
        for i in range(len(seq)):
            if cas.pam_side == "5prime":
                # PAM...spacer (e.g., TTTA + 20nt)
                if i + pam_len + sp_len > len(seq):
                    continue
                pam_candidate = seq[i : i + pam_len]
                if iupac_match(cas.pam, pam_candidate):
                    spacer = seq[i + pam_len : i + pam_len + sp_len]
                    targets.append({
                        "pam_pos": i if strand == "+" else len(seq_upper) - i - pam_len - sp_len,
                        "strand": strand,
                        "pam_seq": pam_candidate,
                        "spacer": spacer,
                        "full_target": seq[i : i + pam_len + sp_len],
                        "system": system_key,
                    })
            else:
                # spacer...PAM (e.g., 20nt + NGG)
                if i + sp_len + pam_len > len(seq):
                    continue
                pam_candidate = seq[i + sp_len : i + sp_len + pam_len]
                if iupac_match(cas.pam, pam_candidate):
                    spacer = seq[i : i + sp_len]
                    targets.append({
                        "pam_pos": i + sp_len if strand == "+" else len(seq_upper) - i - sp_len,
                        "strand": strand,
                        "pam_seq": pam_candidate,
                        "spacer": spacer,
                        "full_target": seq[i : i + sp_len + pam_len],
                        "system": system_key,
                    })

    _search_strand(seq_upper, "+")
    _search_strand(reverse_complement(seq_upper), "-")

    return targets


# %% --- CSV export ---

def export_guides_csv(
    guides: list[dict],
    output_path: str = "guides_output.csv",
) -> str:
    """
    Export guide configurations to CSV.

    Each dict in guides should have:
      - name: str
      - spacer: str
      - system_key: str (key into CAS_SYSTEMS)
      - dna_positions: list[int] (0-indexed)
      - (optional) gene, strand
    """
    fieldnames = [
        "name", "system", "pam", "gene", "strand",
        "part1_label", "part1_seq", "part2_label", "part2_seq",
        "dna_positions_1indexed", "guide_sequence", "all_rna_sequence",
    ]

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()

        for g in guides:
            sys_key = g.get("system_key", DEFAULT_SYSTEM)
            config = GuideConfig(
                system_key=sys_key,
                spacer_dna=g["spacer"],
                dna_positions=g.get("dna_positions", []),
            )
            cas = config.cas_system
            writer.writerow({
                "name": g.get("name", ""),
                "system": cas.short_name,
                "pam": cas.pam,
                "gene": g.get("gene", ""),
                "strand": g.get("strand", ""),
                "part1_label": config.part1_label,
                "part1_seq": config.part1_dna,
                "part2_label": config.part2_label,
                "part2_seq": config.part2_dna,
                "dna_positions_1indexed": ",".join(
                    str(p + 1) for p in config.dna_positions
                ),
                "guide_sequence": generate_guide(config),
                "all_rna_sequence": generate_all_rna(config),
            })

    return output_path


# %% --- List available systems ---

def list_systems():
    """Print all available Cas systems."""
    print(f"{'Key':<20} {'Name':<40} {'PAM':<12} {'Side':<8} {'Guide':<15} {'SpLen'}")
    print("-" * 110)
    for key, cas in CAS_SYSTEMS.items():
        orient = "repeat+spacer" if cas.guide_orientation == "repeat_first" else "spacer+scaffold"
        print(f"{key:<20} {cas.name:<40} {cas.pam:<12} {cas.pam_side:<8} {orient:<15} {cas.spacer_len}")


# %% --- Demo ---

def demo():
    """Run a demo showing multiple Cas systems."""
    print("=== CRISPR Multi-System Guide RNA Pipeline ===\n")

    list_systems()
    print()

    # Original LbCpf1 example
    print("--- LbCpf1 (your original) ---")
    config = GuideConfig()
    print(f"  Guide: {generate_guide(config)}")
    config_dna = GuideConfig(dna_positions=[0, 20])
    print(f"  DNA@R1+S1: {generate_guide(config_dna)}")
    print()

    # SpCas9 example
    print("--- SpCas9 NGG ---")
    sp_config = GuideConfig(
        system_key="SpCas9_NGG",
        spacer_dna="GAGTCTCTCAGCTGGTACAC",
    )
    cas = sp_config.cas_system
    print(f"  Structure: {sp_config.part1_label}({sp_config.part1_len}) + {sp_config.part2_label}({sp_config.part2_len})")
    guide = generate_guide(sp_config)
    print(f"  Full RNA: {guide[:60]}...")
    print()

    # SaCas9 example
    print("--- SaCas9 NNGRRT ---")
    sa_config = GuideConfig(
        system_key="SaCas9_NNGRRT",
        spacer_dna="GAGTCTCTCAGCTGGTACACT",  # 21nt for SaCas9
    )
    print(f"  Structure: {sa_config.part1_label}({sa_config.part1_len}) + {sa_config.part2_label}({sa_config.part2_len})")
    guide = generate_guide(sa_config)
    print(f"  Full RNA: {guide[:60]}...")
    print()

    # Target finding demo
    print("--- Target finding in sample sequence ---")
    test_seq = "ATGCTTTAGAGTCTCTCAGCTGGTACACCGGTATNGGCATAGC"
    for sys_key in ["LbCpf1_TTTN", "SpCas9_NGG"]:
        targets = find_targets(test_seq, sys_key)
        print(f"  {sys_key}: {len(targets)} targets found")
        for t in targets[:2]:
            print(f"    strand={t['strand']} pam={t['pam_seq']} spacer={t['spacer']}")


if __name__ == "__main__":
    demo()
