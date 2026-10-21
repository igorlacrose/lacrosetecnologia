from __future__ import annotations

import re
import subprocess
import sys

PATTERNS = [
    ("Supabase secret key", re.compile(r"\bsb_secret_[A-Za-z0-9_-]{20,}", re.I)),
    ("Telegram bot token", re.compile(r"\b\d{8,12}:[A-Za-z0-9_-]{30,}\b")),
    ("Private key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----", re.I)),
    ("OpenAI secret key", re.compile(r"\bsk-[A-Za-z0-9_-]{20,}")),
    ("GitHub token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}")),
    ("Service-role JWT assignment", re.compile(
        r"SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*['\"]eyJ[A-Za-z0-9._-]{40,}",
        re.I,
    )),
]

def main() -> int:
    result = subprocess.run(
        ["git", "log", "--all", "-p", "--no-ext-diff", "--text", "--format=COMMIT:%H"],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )

    commit = "desconhecido"
    findings: list[tuple[str, str]] = []

    for line in result.stdout.splitlines():
        if line.startswith("COMMIT:"):
            commit = line.split(":", 1)[1].strip()
            continue

        for label, pattern in PATTERNS:
            if pattern.search(line):
                item = (commit, label)
                if item not in findings:
                    findings.append(item)

    if findings:
        print("SECRET HISTORY CHECK: FALHOU")
        for commit_sha, label in findings:
            print(f" - {label} detectado no histórico, commit {commit_sha[:12]}")
        print("Rotacione o segredo e remova-o do histórico antes de publicar.")
        return 1

    print("SECRET HISTORY CHECK: OK")
    print("Nenhum padrão de segredo de alta confiança foi encontrado no histórico Git.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
