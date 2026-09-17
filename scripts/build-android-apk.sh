#!/bin/sh
set -eu
cd /workspace
export JAVA_HOME="${JAVA_HOME:-/workspace/.jdk-21}"
export ANDROID_HOME="${ANDROID_HOME:-/workspace/.android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

if [ -n "${VITE_PUBLIC_HOSTNAME:-}" ] && [ -z "${CAP_SERVER_URL:-}" ]; then
  export CAP_SERVER_URL="https://${VITE_PUBLIC_HOSTNAME}"
fi

node scripts/prepare-android-web.mjs
npx cap sync android
echo "sdk.dir=$ANDROID_HOME" > android/local.properties
cd android
./gradlew assembleDebug --no-daemon
mkdir -p /workspace/public/downloads /workspace/artifacts
cp app/build/outputs/apk/debug/app-debug.apk /workspace/public/downloads/juicy-lounge-debug.apk
cp app/build/outputs/apk/debug/app-debug.apk /workspace/artifacts/juicy-lounge-debug.apk
ls -lah /workspace/public/downloads/juicy-lounge-debug.apk
