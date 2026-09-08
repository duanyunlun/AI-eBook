#!/usr/bin/env bash
set -euo pipefail
mkdir -p .build-cache/android-smoke
apk=$(find src-tauri/gen/android/app/build/outputs/apk -name '*x86_64*.apk' -print -quit)
test -n "$apk"
adb install -r "$apk"
adb logcat -c
adb shell am start -W -n app.aiebook.reader/.MainActivity
sleep 12
adb shell pidof app.aiebook.reader
adb shell uiautomator dump /sdcard/startup.xml
adb pull /sdcard/startup.xml .build-cache/android-smoke/startup.xml
adb exec-out screencap -p > .build-cache/android-smoke/startup.png
adb logcat -d > .build-cache/android-smoke/logcat.txt
if ! rg -q '打开书籍' .build-cache/android-smoke/startup.xml; then
  echo 'Android 首屏未出现打开书籍入口'
  exit 1
fi
if rg -q 'FATAL EXCEPTION|panicked at' .build-cache/android-smoke/logcat.txt; then
  echo 'Android 启动出现异常'
  exit 1
fi
