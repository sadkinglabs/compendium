# Gate-0 OCR baseline harness (on-device)

Produces the OCR baseline number over the governed physical corpus. The recognition itself is native
ML Kit, so it runs as an **instrumented test** on a connected device
(`android/app/src/androidTest/.../scanner/RecogOcrBaselineTest.kt`). Two measurements per image:

- **strip** - the EXACT production path (`StripExtractor.extract(bitmap)` + `FrameSelector.selectCard`),
  i.e. what the live scanner does treating the photo as one camera frame.
- **full** (the `ocrCardId` score.mjs reads) - whole-image OCR, every line through the same `Matcher`;
  a framing-independent upper bound on what OCR can read at all.

## Run it

```bash
export JAVA_HOME="C:/Program Files/Android/Android Studio/jbr"
PKG=com.sadkinglabs.compendium
DIR=/sdcard/Android/data/$PKG/files/recog-ocr

# 1. build + install the debug app + test APK (debug coexists only if nothing else holds the package;
#    otherwise `adb uninstall $PKG` first - the scanner test device carries throwaway builds).
( cd android && ./gradlew :app:installDebug :app:installDebugAndroidTest )

# 2. create the app-owned data dir (run once; the assert fails, that is expected), then push the corpus.
#    The app must OWN the dir or it cannot read adb-pushed files in scoped storage.
adb shell am instrument -w -e class com.sadkinglabs.compendium.scanner.RecogOcrBaselineTest \
  $PKG.test/androidx.test.runner.AndroidJUnitRunner   # creates $DIR (app-owned), fails "push ... first"
adb push recog-data/store/. $DIR/
adb push android/app/src/test/resources/scanner/full-catalog.tsv $DIR/

# 3. run the harness for real, pull the results, score.
adb shell am instrument -w -e class com.sadkinglabs.compendium.scanner.RecogOcrBaselineTest \
  $PKG.test/androidx.test.runner.AndroidJUnitRunner
adb pull $DIR/ocr-results.json recog-data/ocr-results.json
npm run recog:score            # writes data/recog/gate0-baseline.json + prints the off-ramp verdict
```

`recog-data/` is gitignored (private images + raw results). The committed evidence is
`data/recog/gate0-baseline.json` (aggregate slice metrics, no PII, no image bytes).
