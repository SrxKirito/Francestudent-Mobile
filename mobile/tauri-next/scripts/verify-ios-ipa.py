#!/usr/bin/env python3
"""Validate the *preview* IPA before it is made available as a CI artifact.

This checks packaging only, not installation, signing, API access, or parity.
The executable is copied to an explicit path so macOS `lipo` can inspect it.
"""
import argparse
import json
import plistlib
import re
import shutil
import sys
import zipfile
from pathlib import Path


def verify_app_icon(archive: zipfile.ZipFile, app_root: str, info: dict):
    icons = info.get("CFBundleIcons") or {}
    primary = icons.get("CFBundlePrimaryIcon") if isinstance(icons, dict) else None
    files = primary.get("CFBundleIconFiles") if isinstance(primary, dict) else None
    if not isinstance(files, list) or not files:
        raise ValueError("Icône principale iPhone absente du manifeste.")
    stems = [Path(entry).stem for entry in files if isinstance(entry, str) and re.fullmatch(r"[\w.-]+", entry)]
    names = archive.namelist()
    for stem in stems:
        pattern = re.compile(re.escape(app_root + stem) + r"(?:@[23]x)?\.png")
        for name in names:
            if pattern.fullmatch(name):
                with archive.open(name) as stream:
                    if stream.read(8) == b"\x89PNG\r\n\x1a\n":
                        return
    raise ValueError("Image de l’icône principale absente ou invalide dans l’IPA.")


def verify_ipa(ipa: Path, expected_bundle: str, executable_output: Path | None = None):
    with zipfile.ZipFile(ipa) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("L'IPA contient des entrées dupliquées.")
        candidates = [n for n in names if re.fullmatch(r"Payload/[^/]+\.app/Info\.plist", n)]
        if len(candidates) != 1:
            raise ValueError("L'IPA doit contenir exactement une application principale.")
        info_entry = archive.getinfo(candidates[0])
        if info_entry.file_size > 1024 * 1024:
            raise ValueError("Info.plist trop volumineux.")
        info = plistlib.loads(archive.read(info_entry))
        if info.get("CFBundleIdentifier") != expected_bundle:
            raise ValueError("Identifiant de l'application inattendu.")
        if info.get("CFBundlePackageType") != "APPL":
            raise ValueError("Le paquet n'est pas une application iOS.")
        if info.get("MinimumOSVersion") != "16.4":
            raise ValueError("La version iOS minimale attendue est 16.4.")
        if "iPhoneOS" not in info.get("CFBundleSupportedPlatforms", []):
            raise ValueError("L'IPA ne cible pas un iPhone physique.")
        for key in ("NSCameraUsageDescription", "NSPhotoLibraryUsageDescription", "NSMicrophoneUsageDescription", "NSSpeechRecognitionUsageDescription"):
            if not isinstance(info.get(key), str) or not info[key].strip():
                raise ValueError(f"Description d'autorisation absente : {key}.")
        app_root = candidates[0].rsplit("/", 1)[0] + "/"
        verify_app_icon(archive, app_root, info)
        privacy_name = app_root + "PrivacyInfo.xcprivacy"
        try:
            privacy_entry = archive.getinfo(privacy_name)
        except KeyError as error:
            raise ValueError("Manifeste de confidentialité absent de l'application.") from error
        if privacy_entry.file_size > 1024 * 1024:
            raise ValueError("Manifeste de confidentialité trop volumineux.")
        privacy = plistlib.loads(archive.read(privacy_entry))
        reasons = {item.get("NSPrivacyAccessedAPIType"): item.get("NSPrivacyAccessedAPITypeReasons", []) for item in privacy.get("NSPrivacyAccessedAPITypes", []) if isinstance(item, dict)}
        if "CA92.1" not in reasons.get("NSPrivacyAccessedAPICategoryUserDefaults", []) or "C617.1" not in reasons.get("NSPrivacyAccessedAPICategoryFileTimestamp", []):
            raise ValueError("Manifeste de confidentialité incomplet.")
        executable = info.get("CFBundleExecutable")
        if not isinstance(executable, str) or not executable or "/" in executable or "\\" in executable or executable in (".", ".."):
            raise ValueError("Nom d'exécutable invalide.")
        binary_name = app_root + executable
        try:
            binary = archive.getinfo(binary_name)
        except KeyError as error:
            raise ValueError("Exécutable absent de l'IPA.") from error
        if binary.is_dir() or binary.file_size == 0:
            raise ValueError("Exécutable vide ou invalide.")
        # Test every entry's CRC rather than trusting the ZIP central directory.
        damaged = archive.testzip()
        if damaged:
            raise ValueError("Archive corrompue : " + damaged)
        if executable_output is not None:
            with archive.open(binary) as src, executable_output.open("wb") as dst:
                shutil.copyfileobj(src, dst, 1024 * 1024)
        return info


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("ipa", type=Path)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--executable-output", type=Path)
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding="utf-8"))
    expected = config["identifier"]
    # Preview builds must not masquerade as the installed production bundle.
    if expected != "org.francestudent.mobile.next":
        raise ValueError("Le build de vérification doit garder l'identifiant de préversion.")
    info = verify_ipa(args.ipa, expected, args.executable_output)
    print(f"IPA de préversion vérifié : {info['CFBundleIdentifier']}, iOS {info['MinimumOSVersion']}.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, plistlib.InvalidFileException) as error:
        print(f"Vérification IPA impossible : {error}", file=sys.stderr)
        raise SystemExit(1)
