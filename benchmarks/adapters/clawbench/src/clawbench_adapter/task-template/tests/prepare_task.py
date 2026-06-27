#!/usr/bin/env python3
"""Per-task setup: provision a disposable email + write the ./my-info bundle.

Kernel port of upstream ClawBench ``runtime/harbor/prepare-task.py``. Instead of
PurelyMail-specific calls it uses the ``EmailProvider`` abstraction
(``_email_provider.py``): AgentMail when ``AGENTMAIL_API_KEY`` is set, else a
no-inbox persona address (so the non-email task subset still runs). Writes
``alex_green_personal_info.json`` (email injected), ``email_credentials.json``,
and ``alex_green_resume.pdf`` (best-effort, needs fpdf2) into the agent's
``./my-info/`` dir, and records the email handle in a state file so
``cleanup_email.py`` can delete the inbox afterwards.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _email_provider import select_provider  # noqa: E402

TESTS_DIR = Path(__file__).resolve().parent


def _safe_text(text: str) -> str:
    repl = {
        "—": " - ", "–": " - ", "•": "-",
        "‘": "'", "’": "'", "“": '"', "”": '"',
    }
    for src, dst in repl.items():
        text = text.replace(src, dst)
    return text


def _write_resume_pdf(template_path: Path, email: str, output_path: Path) -> bool:
    try:
        from fpdf import FPDF
    except Exception as exc:  # fpdf2 not installed in the VM
        print(f"  WARNING: skipping resume PDF ({exc})", file=sys.stderr)
        return False
    data = json.loads(template_path.read_text())
    data["header"]["email"] = email
    header = data["header"]
    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 22)
    pdf.cell(0, 10, _safe_text(header["name"]), new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.set_font("Helvetica", "", 11)
    pdf.cell(0, 6, _safe_text(header["title"]), new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.set_font("Helvetica", "", 9)
    contact = "  |  ".join(
        p for p in [header.get("email", ""), header.get("location", "")] if p
    )
    pdf.cell(0, 5, _safe_text(contact), new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.ln(2)
    for section in (
        "summary", "experience", "education", "skills", "certifications", "languages"
    ):
        value = data.get(section)
        if not value:
            continue
        pdf.set_font("Helvetica", "B", 12)
        pdf.cell(0, 7, section.replace("_", " ").title(), new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 9)
        if isinstance(value, str):
            pdf.multi_cell(0, 5, _safe_text(value))
        else:
            pdf.multi_cell(0, 5, _safe_text(json.dumps(value, ensure_ascii=False, indent=2)))
        pdf.ln(1)
    pdf.output(str(output_path))
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare ClawBench my-info bundle")
    parser.add_argument("--output-dir", type=Path, default=Path("/app/my-info"))
    parser.add_argument("--state-file", type=Path, default=Path("/data/task-state.json"))
    parser.add_argument("--persona", type=Path, default=TESTS_DIR / "alex_green_personal_info.json")
    parser.add_argument("--resume-template", type=Path, default=TESTS_DIR / "resume_template.json")
    args = parser.parse_args()

    provider = select_provider()
    account = provider.create()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.state_file.parent.mkdir(parents=True, exist_ok=True)

    persona = json.loads(args.persona.read_text())
    persona.setdefault("contact", {})["email"] = account.address
    persona.pop("online_accounts", None)
    (args.output_dir / "alex_green_personal_info.json").write_text(
        json.dumps(persona, indent=2)
    )
    (args.output_dir / "email_credentials.json").write_text(
        json.dumps(account.credentials(), indent=2)
    )
    _write_resume_pdf(
        args.resume_template, account.address, args.output_dir / "alex_green_resume.pdf"
    )

    args.state_file.write_text(json.dumps({"email": asdict(account)}, indent=2))
    print(f"Prepared ClawBench my-info for {account.address} (provider={provider.name})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
