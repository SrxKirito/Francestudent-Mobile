#!/usr/bin/env python3
"""Generate a SideStore source for the *preview* Tauri IPA only.

This never produces or updates the production catalogue:
- the bundle identifier must be the preview one (org.francestudent.mobile.next),
  never the production bundle (org.francestudent.chat);
- the source identifier is distinct from the production source identifier;
- the output file must not be called source.json, must not be the repository's
  production source.json, and the URLs must not look like production ones.

The IPA is re-checked with the existing verify-ios-ipa.py before use. Nothing is
published: the caller must host the IPA and the generated source by hand, and
pass the final HTTPS URLs. Without them, placeholder URLs on the reserved
`.invalid` domain are written, so the source cannot be installed by mistake.
"""
import argparse
import hashlib
import importlib.util
import json
import plistlib
import re
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

PREVIEW_BUNDLE = "org.francestudent.mobile.next"
PRODUCTION_BUNDLE = "org.francestudent.chat"
PREVIEW_SOURCE_IDENTIFIER = "org.francestudent.source.preview"
PRODUCTION_IPA_NAME = "FranceStudent-iPhone.ipa"
PLACEHOLDER_HOST = "example.invalid"
REPO_ROOT = Path(__file__).resolve().parents[3]


def load_verifier():
    path = Path(__file__).with_name("verify-ios-ipa.py")
    spec = importlib.util.spec_from_file_location("verify_ios_ipa", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def check_url(value, label, download):
    parts = urlsplit(value)
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password or parts.fragment:
        raise ValueError(f"{label} : une URL HTTPS sans identifiants ni fragment est requise.")
    name = parts.path.rsplit("/", 1)[-1]
    if not download and name == "source.json":
        raise ValueError(f"{label} : le nom source.json est réservé à la source de production.")
    if download and (name == PRODUCTION_IPA_NAME or re.search(r"/releases/download/ios-", parts.path)):
        raise ValueError(f"{label} : cette URL ressemble à celle de la version de production.")
    return value


def sha256_of(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def make_source(ipa, repo, commit, download_url, source_url, icon_url, date):
    verifier = load_verifier()
    info = verifier.verify_ipa(ipa, PREVIEW_BUNDLE)
    if info.get("CFBundleIdentifier") != PREVIEW_BUNDLE or info.get("CFBundleIdentifier") == PRODUCTION_BUNDLE:
        raise ValueError("L'IPA ne porte pas l'identifiant de préversion : refus.")
    version = str(info.get("CFBundleShortVersionString", ""))
    if not re.fullmatch(r"\d+\.\d+(\.\d+)?", version):
        raise ValueError("Version de l'IPA invalide.")
    build = str(info.get("CFBundleVersion", ""))
    size = ipa.stat().st_size
    privacy = {key: value for key, value in info.items() if re.fullmatch(r"NS.*UsageDescription", key) and isinstance(value, str)}
    description = (
        "Préversion de test de la future version Tauri. Elle s'installe à côté de FranceStudent Chat "
 "sans le remplacer, et ne reprend pas ses données locales."
    )
    entry = {
        "version": version,
        "buildVersion": build,
        "date": date,
 "localizedDescription": description,
 "downloadURL": download_url,
        "size": size,
        "sha256": sha256_of(ipa),
        "minOSVersion": str(info.get("MinimumOSVersion", "16.4")),
    }
    app = {
 "name": "FranceStudent (préversion Tauri)",
 "bundleIdentifier": PREVIEW_BUNDLE,
        "developerName": "FranceStudent",
        "localizedDescription": description,
        "iconURL": icon_url,
 "tintColor": "#2563EB",
        "version": version,
        "versionDate": date,
        "downloadURL": download_url,
 "size": size,
        "versions": [entry],
 "appPermissions": {"entitlements": [], "privacy": privacy},
    }
    return {
        "name": "FranceStudent — préversion Tauri",
 "identifier": PREVIEW_SOURCE_IDENTIFIER,
        "sourceURL": source_url,
        "subtitle": "Préversion de test, distincte de FranceStudent Chat",
 "iconURL": icon_url,
        "website": f"https://github.com/{repo}",
        "tintColor": "#2563EB",
        "apps": [app],
        "news": [],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("ipa", type=Path)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--download-url", default="")
    parser.add_argument("--source-url", default="")
    parser.add_argument("--icon-url", default="")
    parser.add_argument("--date", default="")
    args = parser.parse_args()

    if not re.fullmatch(r"[A-Za-z0-9][\w.-]*/[A-Za-z0-9][\w.-]*", args.repo) or not re.fullmatch(r"[a-f0-9]{40}", args.commit):
        raise ValueError("Dépôt ou commit invalide.")
    config = json.loads(args.config.read_text(encoding="utf-8"))
    if config.get("identifier") != PREVIEW_BUNDLE:
        raise ValueError("La configuration Tauri doit garder l'identifiant de préversion.")
    output = args.output.resolve()
    if output.name == "source.json" or output == (REPO_ROOT / "source.json").resolve():
        raise ValueError("Refus d'écrire une source nommée source.json (production).")

    placeholders = []
    download_url = args.download_url.strip()
    if download_url:
        download_url = check_url(download_url, "URL de l'IPA", True)
    else:
        download_url = f"https://{PLACEHOLDER_HOST}/{args.ipa.name}"
        placeholders.append("URL de l'IPA")
    source_url = args.source_url.strip()
    if source_url:
        source_url = check_url(source_url, "URL de la source", False)
    else:
        source_url = f"https://{PLACEHOLDER_HOST}/{output.name}"
        placeholders.append("URL de la source")
    icon_url = args.icon_url.strip()
    if not icon_url:
        icon_url = f"https://raw.githubusercontent.com/{args.repo}/{args.commit}/mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
    icon_url = check_url(icon_url, "URL de l'icône", False)
    date = args.date.strip() or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z", date):
        raise ValueError("Date invalide (ISO 8601 UTC attendu).")

    source = make_source(args.ipa, args.repo, args.commit, download_url, source_url, icon_url, date)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(source, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    app = source["apps"][0]
    print(f"Source de préversion générée : {app['bundleIdentifier']} {app['version']} ({app['size']} octets).")
    if placeholders:
        print("ATTENTION : " + " et ".join(placeholders) + " remplacée(s) par un domaine .invalid : source non installable tant que les URL finales ne sont pas fournies.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, plistlib.InvalidFileException) as error:
        print(f"Génération de la source de préversion impossible : {error}", file=sys.stderr)
        raise SystemExit(1)
