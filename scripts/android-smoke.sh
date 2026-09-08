#!/usr/bin/env bash
set -euo pipefail
mkdir -p .build-cache/android-smoke
trap 'adb exec-out screencap -p > .build-cache/android-smoke/startup.png; adb logcat -d > .build-cache/android-smoke/logcat.txt' EXIT
apk=$(find src-tauri/gen/android/app/build/outputs/apk -name '*x86_64*.apk' -print -quit)
test -n "$apk"
sleep 45
adb install -r "$apk"
adb logcat -c
adb shell am start -W -n app.aiebook.reader/.MainActivity
sleep 12
adb shell pidof app.aiebook.reader
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard
for attempt in 1 2 3 4 5; do
  adb shell uiautomator dump --compressed /sdcard/startup.xml
  if adb pull /sdcard/startup.xml .build-cache/android-smoke/startup.xml; then break; fi
  sleep 3
done
ANDROID_TEST_APK="$apk" node "$(dirname "$0")/android-dsh-test.mjs"
adb logcat -d > .build-cache/android-smoke/logcat.txt
if ! grep -q 'android.webkit.WebView' .build-cache/android-smoke/startup.xml; then
  echo 'Android 首屏未加载 WebView'
  exit 1
fi
if grep -Eq 'FATAL EXCEPTION|panicked at|ANR in app.aiebook.reader' .build-cache/android-smoke/logcat.txt; then
  echo 'Android 启动出现异常'
  exit 1
fi
