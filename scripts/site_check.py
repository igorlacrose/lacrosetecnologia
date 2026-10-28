from __future__ import annotations

import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote

ROOT = Path(__file__).resolve().parents[1]

REQUIRED = [
    "index.html",
    "CNAME",
    "404.html",
    "robots.txt",
    "sitemap.xml",
    "app.js",
    "assets/experience.css",
    "assets/experience.js",
    "assets/agent-base.css",
    "assets/agent-studio.css",
    "assets/agent-studio.js",
    "assets/brand/lacrose-tecnologia-dark.png",
    "assets/agent/mascote-lacrose.png",
    "card/index.html",
    "admin/index.html",
    "flux/index.html",
    "flux/app.js",
    "flux/sw.js",
    "gpar/index.html",
    "gpar/app.js",
    "gpar/navigation.js",
    "lcs/index.html",
    ".github/dependabot.yml",
]

TEXT_SUFFIXES = {".html", ".css", ".js", ".json", ".xml", ".webmanifest", ".yml", ".yaml"}
FORBIDDEN = [
    re.compile(r"\blocalhost\b", re.I),
    re.compile(r"\b127\.0\.0\.1\b"),
    re.compile(r"\bTODO\b"),
    re.compile(r"\bFIXME\b"),
    re.compile(r"SUPABASE_SERVICE_ROLE_KEY"),
    re.compile(r"\bsb_secret_[A-Za-z0-9_-]+"),
    re.compile(r"TELEGRAM_BOT_TOKEN"),
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"lacrose_agent_demo_lead"),
    re.compile(r"cdn\.jsdelivr\.net/npm/@supabase/supabase-js@(?:2|latest)(?:[\"'/]|$)"),
]


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str]] = []
        self.unsafe_blank_links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = dict(attrs)
        for attr in ("src", "href"):
            value = attr_map.get(attr)
            if value:
                self.links.append((attr, value))

        if tag == "a" and attr_map.get("target") == "_blank":
            rel = set((attr_map.get("rel") or "").lower().split())
            if "noopener" not in rel:
                self.unsafe_blank_links.append(attr_map.get("href") or "<sem href>")


def fail(message: str, errors: list[str]) -> None:
    errors.append(message)


def local_target(source: Path, raw: str) -> Path | None:
    value = raw.strip()
    if not value or value.startswith(("#", "mailto:", "tel:", "data:", "javascript:")):
        return None

    parts = urlsplit(value)
    if parts.scheme or parts.netloc:
        return None

    path = unquote(parts.path)
    if not path:
        return None

    if path.startswith("/"):
        target = ROOT / path.lstrip("/")
    else:
        target = source.parent / path

    target = target.resolve()

    try:
        target.relative_to(ROOT.resolve())
    except ValueError:
        return None

    if value.endswith("/") or target.is_dir():
        target = target / "index.html"

    return target


def main() -> int:
    errors: list[str] = []

    for rel in REQUIRED:
        if not (ROOT / rel).exists():
            fail(f"Arquivo obrigatório ausente: {rel}", errors)

    cname = (ROOT / "CNAME")
    if cname.exists() and cname.read_text(encoding="utf-8").strip() != "lacrosetecnologia.com.br":
        fail("CNAME deve conter exatamente lacrosetecnologia.com.br", errors)

    for path in ROOT.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        if ".git" in path.parts:
            continue

        text = path.read_text(encoding="utf-8", errors="replace")
        rel = path.relative_to(ROOT)

        for pattern in FORBIDDEN:
            if pattern.search(text):
                fail(f"Marcador proibido {pattern.pattern!r} em {rel}", errors)

        if path.suffix.lower() == ".html":
            parser = LinkParser()
            parser.feed(text)
            for attr, raw in parser.links:
                target = local_target(path, raw)
                if target is not None and not target.exists():
                    fail(f"Referência local quebrada em {rel}: {attr}={raw!r}", errors)

            for raw in parser.unsafe_blank_links:
                fail(f"Link target=_blank sem noopener em {rel}: {raw!r}", errors)

    index = (ROOT / "index.html").read_text(encoding="utf-8")
    for required_text in [
        'rel="canonical" href="https://lacrosetecnologia.com.br/"',
        'name="twitter:card"',
        'application/ld+json',
        'Content-Security-Policy',
        'name="referrer"',
    ]:
        if required_text not in index:
            fail(f"SEO da home incompleto: ausente {required_text}", errors)

    if 'href="admin/"' in index or 'id="openAdmin"' in index or "Ver painel comercial" in index:
        fail("A home não deve expor link ou botão para /admin/", errors)

    if 'href="flux/"' in index:
        fail("A home não deve expor atalho público para /flux/", errors)

    for rel in ["admin/index.html", "lcs/index.html", "flux/index.html", "gpar/index.html"]:
        text = (ROOT / rel).read_text(encoding="utf-8")
        if 'name="robots"' not in text or "noindex" not in text or "nofollow" not in text:
            fail(f"{rel} precisa permanecer noindex,nofollow", errors)

    admin_html = (ROOT / "admin/index.html").read_text(encoding="utf-8")
    if "@supabase/supabase-js@2.117.3" not in admin_html:
        fail("Painel deve usar versão fixa do supabase-js", errors)
    if "Content-Security-Policy" not in admin_html:
        fail("Painel deve manter CSP explícita", errors)

    admin_js = (ROOT / "admin/app.js").read_text(encoding="utf-8")
    if "persistSession:false" not in admin_js:
        fail("Painel deve manter sessão administrativa somente em memória", errors)
    if "storage:window.sessionStorage" in admin_js or "persistSession:true" in admin_js:
        fail("Painel não deve persistir sessão administrativa no sessionStorage", errors)
    if "ADMIN_IDLE_MS=30*60*1000" not in admin_js:
        fail("Painel deve encerrar sessão após inatividade", errors)
    for required_mfa in [
        'id="mfaScreen"',
        "auth.mfa.enroll",
        "auth.mfa.challenge",
        "auth.mfa.verify",
        "getAuthenticatorAssuranceLevel",
        "currentLevel==='aal2'",
    ]:
        target = admin_html if required_mfa.startswith('id="') else admin_js
        if required_mfa not in target:
            fail(f"Painel sem MFA obrigatório esperado: {required_mfa}", errors)

    flux_html = (ROOT / "flux/index.html").read_text(encoding="utf-8")
    flux_js = (ROOT / "flux/app.js").read_text(encoding="utf-8")
    for required_flux in [
        "Content-Security-Policy",
        "connect-src 'none'",
        'name="referrer" content="no-referrer"',
        'name="robots" content="noindex, nofollow, noarchive"',
    ]:
        if required_flux not in flux_html:
            fail(f"FluX local sem isolamento esperado: {required_flux}", errors)
    for required_flux_js in [
        "indexedDB.open(",
        "crypto.subtle.digest(",
        "f.size>10*1024*1024",
        "p.transactions.length>50000",
    ]:
        if required_flux_js not in flux_js:
            fail(f"FluX local sem proteção esperada: {required_flux_js}", errors)
    for forbidden_flux_js in [
        "fetch(",
        "XMLHttpRequest",
        "WebSocket",
        "EventSource",
        "sendBeacon(",
        "SUPABASE_",
        "localStorage",
        "sessionStorage",
    ]:
        if forbidden_flux_js in flux_js:
            fail(f"FluX local não deve transmitir/persistir fora do IndexedDB: {forbidden_flux_js}", errors)

    gpar_html = (ROOT / "gpar/index.html").read_text(encoding="utf-8")
    gpar_js = (ROOT / "gpar/app.js").read_text(encoding="utf-8")
    for required_gpar in [
        "Content-Security-Policy",
        "connect-src 'none'",
        'name="referrer" content="no-referrer"',
        'name="robots" content="noindex, nofollow, noarchive"',
    ]:
        if required_gpar not in gpar_html:
            fail(f"GPar sem isolamento esperado: {required_gpar}", errors)
    for required_gpar_js in [
        "const MAX_FILE_BYTES = 10 * 1024 * 1024",
        "const MAX_ROWS = 20000",
        "csvTextSafe",
        "indexedDB.open(",
    ]:
        if required_gpar_js not in gpar_js:
            fail(f"GPar sem proteção esperada: {required_gpar_js}", errors)
    for forbidden_gpar_js in ["fetch(", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon(", "eval(", "new Function"]:
        if forbidden_gpar_js in gpar_js:
            fail(f"GPar local contém API proibida: {forbidden_gpar_js}", errors)

    for rel in ["card/index.html", "404.html", "lcs/index.html"]:
        text = (ROOT / rel).read_text(encoding="utf-8")
        if "Content-Security-Policy" not in text:
            fail(f"{rel} deve manter CSP explícita", errors)

    workflow = (ROOT / ".github/workflows/site-check.yml").read_text(encoding="utf-8")
    for forbidden_action_ref in ["actions/checkout@v", "actions/setup-python@v"]:
        if forbidden_action_ref in workflow:
            fail(f"GitHub Action deve estar fixada por SHA: {forbidden_action_ref}", errors)
    for required_action_sha in [
        "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
        "actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97",
    ]:
        if required_action_sha not in workflow:
            fail(f"GitHub Action esperada ausente: {required_action_sha}", errors)

    robots = (ROOT / "robots.txt").read_text(encoding="utf-8")
    for rule in ["Disallow: /admin/", "Disallow: /lcs/", "Disallow: /flux/", "Sitemap: https://lacrosetecnologia.com.br/sitemap.xml"]:
        if rule not in robots:
            fail(f"robots.txt incompleto: ausente {rule}", errors)

    sitemap = (ROOT / "sitemap.xml").read_text(encoding="utf-8")
    for url in ["https://lacrosetecnologia.com.br/", "https://lacrosetecnologia.com.br/card/"]:
        if f"<loc>{url}</loc>" not in sitemap:
            fail(f"sitemap.xml incompleto: ausente {url}", errors)

    if errors:
        print("SITE CHECK: FALHOU")
        for item in errors:
            print(f" - {item}")
        return 1

    print("SITE CHECK: OK")
    print(f"Arquivos obrigatórios: {len(REQUIRED)}")
    print("Links relativos, SEO, noindex e arquivos de produção validados.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
