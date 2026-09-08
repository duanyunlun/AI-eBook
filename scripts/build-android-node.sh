#!/usr/bin/env bash
set -euo pipefail
arch=${1:?Expected arm64 or x64}
case "$arch" in
  arm64) triple=aarch64-linux-android ;;
  x64) triple=x86_64-linux-android ;;
  *) exit 1 ;;
esac
version=v24.20.0
root="$PWD/.build-cache/android-node/$arch"
source_root="$PWD/.build-cache/node-source-$arch"
mkdir -p "$root" "$source_root"
archive="node-$version.tar.xz"
curl --fail --location --retry 3 "https://nodejs.org/dist/$version/$archive" -o "$source_root/$archive"
curl --fail --location --retry 3 "https://nodejs.org/dist/$version/SHASUMS256.txt" -o "$source_root/SHASUMS256.txt"
cd "$source_root"
awk -v name="$archive" '$2 == name' SHASUMS256.txt > selected.sha256
test -s selected.sha256
sha256sum -c selected.sha256
tar -xf "$archive"
cd "node-$version"
toolchain="${NDK_HOME:?}/toolchains/llvm/prebuilt/linux-x86_64"
export PATH="$toolchain/bin:$PATH"
export CC="$toolchain/bin/${triple}26-clang"
export CXX="$toolchain/bin/${triple}26-clang++"
export AR="$toolchain/bin/llvm-ar"
export CC_host=gcc CXX_host=g++ AR_host=ar
export GYP_DEFINES="target_arch=$arch v8_target_arch=$arch android_target_arch=$arch host_os=linux OS=android android_ndk_path=$NDK_HOME"
export LDFLAGS='-Wl,-z,max-page-size=16384'
./configure --dest-cpu="$arch" --dest-os=android --openssl-no-asm --cross-compiling --partly-static --without-node-snapshot
make -j2
cp out/Release/node "$root/libnode_runtime.so"
"$toolchain/bin/llvm-strip" "$root/libnode_runtime.so"
"$toolchain/bin/llvm-readelf" -h -l "$root/libnode_runtime.so"
cp LICENSE "$root/LICENSE-Node.txt"
cp -R deps/npm "$root/npm"
printf '%s\n' "$version" > "$root/version.txt"
