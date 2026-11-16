import importlib.util
import plistlib
import tempfile
import unittest
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("verify_ios_ipa", HERE / "verify-ios-ipa.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture(destination, *, bundle="org.francestudent.mobile.next", minimum="16.4", privacy=True, executable=True):
    info = {
        "CFBundleIdentifier": bundle,
        "CFBundlePackageType": "APPL",
        "MinimumOSVersion": minimum,
        "CFBundleSupportedPlatforms": ["iPhoneOS"],
        "CFBundleExecutable": "FranceStudent",
        "NSCameraUsageDescription": "photo",
        "NSPhotoLibraryUsageDescription": "photos",
        "NSMicrophoneUsageDescription": "microphone",
        "NSSpeechRecognitionUsageDescription": "dictée",
    }
    manifest = plistlib.loads((HERE.parent / "src-tauri" / "PrivacyInfo.xcprivacy").read_bytes())
    with zipfile.ZipFile(destination, "w") as archive:
        archive.writestr("Payload/Test.app/Info.plist", plistlib.dumps(info))
        if executable:
            archive.writestr("Payload/Test.app/FranceStudent", b"mock-binary")
        if privacy:
            archive.writestr("Payload/Test.app/PrivacyInfo.xcprivacy", plistlib.dumps(manifest))


class VerifyIosIpa(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.ipa = Path(self.temp.name) / "preview.ipa"
        self.binary = Path(self.temp.name) / "binary"

    def test_valid_preview_extracts_only_the_executable(self):
        fixture(self.ipa)
        info = module.verify_ipa(self.ipa, "org.francestudent.mobile.next", self.binary)
        self.assertEqual(info["MinimumOSVersion"], "16.4")
        self.assertEqual(self.binary.read_bytes(), b"mock-binary")

    def test_wrong_bundle_and_missing_content_are_rejected(self):
        for options in ({"bundle": "org.francestudent.chat"}, {"minimum": "15.0"}, {"privacy": False}, {"executable": False}):
            with self.subTest(options=options):
                fixture(self.ipa, **options)
                with self.assertRaises(ValueError):
                    module.verify_ipa(self.ipa, "org.francestudent.mobile.next")


if __name__ == "__main__":
    unittest.main()
