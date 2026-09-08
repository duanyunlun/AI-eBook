#!/usr/bin/env bash
set -euo pipefail
arch=${1:?Expected arm64 or x64}
case "$arch" in
  arm64) triple=aarch64-linux-android ;;
  x64) triple=x86_64-linux-android ;;
  *) exit 1 ;;
esac
version=v24.20.0
scripts="$PWD/scripts"
root="$PWD/.build-cache/android-node/$arch"
source_root="$PWD/.build-cache/node-source-$arch"
mkdir -p "$root" "$source_root"
archive="node-$version.tar.xz"
curl --fail --location --retry 3 "https://nodejs.org/dist/$version/$archive" -o "$source_root/$archive"
curl --fail --location --retry 3 "https://nodejs.org/dist/$version/SHASUMS256.txt" -o "$source_root/SHASUMS256.txt"
cd "$source_root"
awk -v name="$archive" '$2 == name' SHASUMS256.txt > selected.sha256
test -s selected.sha256
shasum -a 256 -c selected.sha256
tar -xf "$archive"
cd "node-$version"
host_os=linux
host_tag=linux-x86_64
if [[ $(uname -s) == Darwin ]]; then
  test "$(uname -m)" = arm64 && test "$arch" = arm64
  host_os=mac
  host_tag=darwin-x86_64
fi
toolchain="${NDK_HOME:?}/toolchains/llvm/prebuilt/$host_tag"
export PATH="$toolchain/bin:$PATH"
compiler_cache=''
if command -v ccache >/dev/null; then compiler_cache='ccache '; fi
export CC="$compiler_cache$toolchain/bin/${triple}26-clang"
export CXX="$compiler_cache$toolchain/bin/${triple}26-clang++"
export AR="$toolchain/bin/llvm-ar"
export CC_host="${compiler_cache}gcc" CXX_host="${compiler_cache}g++" AR_host=ar
if [[ $host_os == mac ]]; then
  export AI_EBOOK_HOST_CXX="$(xcrun --find clang++)" AI_EBOOK_HOST_SDK="$(xcrun --sdk macosx --show-sdk-path)"
  export CC_host="$(xcrun --find clang) -isysroot $AI_EBOOK_HOST_SDK"
  export CXX_host="bash $scripts/android-node-macos-host.sh cxx" AR_host="bash $scripts/android-node-macos-host.sh ar"
fi
export GYP_DEFINES="target_arch=$arch v8_target_arch=$arch android_target_arch=$arch host_os=$host_os OS=android android_ndk_path=$NDK_HOME"
export LDFLAGS='-Wl,-z,max-page-size=16384'
cp "$NDK_HOME/sources/android/cpufeatures/cpu-features.c" deps/zlib/android_cpu_features.c
python3 - <<'PY'
from pathlib import Path
import sys
source = Path('deps/zlib/zlib.gyp')
content = source.read_text()
marker = "          'target_name': 'zlib',\n"
assert content.count(marker) == 2
prefix, target = content.split(marker, 1)
conditions = "          'conditions': [\n"
assert conditions in target
target = target.replace(conditions, conditions + "            ['OS==\"android\" and _toolset==\"target\"', {'sources': ['<(ZLIB_ROOT)/android_cpu_features.c']}],\n", 1)
source.write_text(prefix + marker + target)
source = Path('tools/v8_gypfiles/v8.gyp')
content = source.read_text()
for systems in ('linux mac ios freebsd openharmony', 'linux mac ios openharmony', 'linux mac openharmony', 'linux mac win openharmony'):
    condition = f'OS in "{systems}"'
    assert condition in content
    content = content.replace(condition, f'(_toolset=="host" or {condition})')
source.write_text(content)
if sys.platform == 'darwin':
    marker = '''            ['_toolset=="host"', {
              'sources': [
                '<(V8_ROOT)/src/base/debug/stack_trace_posix.cc',
                '<(V8_ROOT)/src/base/platform/platform-linux.cc',
              ],
            }, {
              'sources': [
                '<(V8_ROOT)/src/base/debug/stack_trace_android.cc','''
    assert marker in content
    replacement = marker.replace("['_toolset==\"host\"',", "['_toolset==\"host\" and host_os==\"linux\"',").replace("            }, {", "            }],\n            ['_toolset==\"target\"', {")
    content = content.replace(marker, replacement)
    source.write_text(content)
    source = Path('deps/uv/uv.gyp')
    content = source.read_text()
    marker = "        [ 'OS in \"mac ios\"', {\n          'sources': [\n"
    assert marker in content
    content = content.replace(marker, "        [ 'OS in \"mac ios\" or _toolset==\"host\"', {\n          'sources': [\n            '<@(uv_sources_bsd_common)',\n")
    content = content.replace("[ 'OS==\"android\"', {", "[ 'OS==\"android\" and _toolset!=\"host\"', {")
    source.write_text(content)
PY
./configure --dest-cpu="$arch" --dest-os=android --openssl-no-asm --cross-compiling --partly-static --without-node-snapshot
make -C out BUILDTYPE=Release -j"${AI_EBOOK_NODE_JOBS:-2}" node > "$source_root/build.log" 2>&1 || { tail -80 "$source_root/build.log" | cut -c1-1000; exit 1; }
cp out/Release/node "$root/libnode_runtime.so"
"$toolchain/bin/llvm-strip" "$root/libnode_runtime.so"
"$toolchain/bin/llvm-readelf" -h -l "$root/libnode_runtime.so"
cp LICENSE "$root/LICENSE-Node.txt"
mkdir -p "$root/npm"
cp -R deps/npm/. "$root/npm/"
printf '%s\n' "$version" > "$root/version.txt"
