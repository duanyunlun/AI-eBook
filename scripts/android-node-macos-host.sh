#!/usr/bin/env bash
set -euo pipefail
mode=$1
shift
if [[ $mode == ar ]]; then
  flags=$1
  shift
  exec "$AR" "${flags%T}" "$@"
fi
test "$mode" = cxx
arguments=()
compile_only=false
for argument in "$@"; do
  if [[ $argument == -c ]]; then compile_only=true; fi
  case "$argument" in
    -static-libgcc|-static-libstdc++|-Wl,--start-group|-Wl,--end-group|-rdynamic) ;;
    *) arguments+=("$argument") ;;
  esac
done
if ! $compile_only; then arguments+=(-framework CoreFoundation); fi
exec "$AI_EBOOK_HOST_CXX" -isysroot "$AI_EBOOK_HOST_SDK" "${arguments[@]}"
