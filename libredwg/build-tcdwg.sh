#!/usr/bin/env bash
# Build lại lõi LibreDWG WASM cho app TC DWG (thay cho bản npm @mlightcad/libredwg-web 0.8.2).
# Cấu hình giống bản gốc (configure: --enable-release --enable-debug --disable-write --disable-json, -O2 -DNDEBUG, zlib),
# chỉ khác phần bộ nhớ: tham số 1 = MALLOC (dlmalloc | emmalloc | mimalloc), tham số 2 = INITIAL_MEMORY, tham số 3 = thư mục ra.
# Chạy trong Git Bash:  bash build-tcdwg.sh dlmalloc 64MB out-dl
set -e
cd "$(dirname "$0")"
GOC="$PWD"
MALLOC="${1:-dlmalloc}"
INIT="${2:-64MB}"
OUT="${3:-out-$MALLOC}"
export EMSDK=D:/.tools/emsdk EM_CONFIG=D:/.tools/emsdk/.emscripten
export EMSDK_NODE=D:/.tools/emsdk/node/24.19.0_64bit/bin/node.exe EMSDK_PYTHON=D:/.tools/emsdk/python/3.13.3_64bit/python.exe
export EM_CACHE=D:/.tools/emsdk/upstream/emscripten/cache
export PATH="/d/.tools/emsdk/upstream/emscripten:/d/.tools/emsdk/node/24.19.0_64bit/bin:/d/.tools/emsdk/python/3.13.3_64bit:$PATH"
emcc() { emcc.exe "$@"; }
emcmake() { emcmake.exe "$@"; }
CMAKE=/d/.tools/venv-build/Scripts/cmake.exe
NINJA=/d/.tools/venv-build/Scripts/ninja.exe

# 1. sinh config.h bằng bước cấu hình CMake (dùng emcc để dò hàm/headers của libc emscripten)
if [ ! -f build-cfg/src/config.h ]; then
  mkdir -p build-cfg
  (cd build-cfg && emcmake "$CMAKE" .. -G Ninja -DCMAKE_MAKE_PROGRAM="$NINJA" \
     -DLIBREDWG_DISABLE_WRITE=ON -DLIBREDWG_DISABLE_JSON=ON -DLIBREDWG_LIBONLY=ON \
     -DBUILD_SHARED_LIBS=OFF -DENABLE_LTO=OFF -DDISABLE_WERROR=ON >/dev/null)
fi
CFG="build-cfg/src"

# 2. biên dịch nguồn C (danh sách theo src/Makefile.am khi tắt write/json)
SRC="dwg common codepages bits logging decode decode2 decode_r11 decode_r2007 reedsolomon print free hash dynapi classes dwg_api objects geom out_dxf out_dxfb"
mkdir -p "$OUT/obj"
CFLAGS="-O2 -sUSE_ZLIB=1 -DNDEBUG -DHAVE_CONFIG_H -DIS_RELEASE=1 -DDEBUG_CLASSES=1 -I$CFG -Isrc -Iinclude -w"
for f in $SRC; do
  if [ ! -f "$OUT/obj/$f.o" ] || [ "src/$f.c" -nt "$OUT/obj/$f.o" ]; then
    echo "  CC $f.c"; emcc $CFLAGS -c "src/$f.c" -o "$OUT/obj/$f.o" &
  fi
done
wait

# 3. liên kết với embind (cùng cờ bản gốc, trừ MALLOC/INITIAL_MEMORY)
em++.exe bindings/javascript/embind/*.cpp "$OUT"/obj/*.o -O2 -lembind -std=c++17 -I$CFG -Isrc -Iinclude \
  -o "$OUT/libredwg-web.js" -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY="$INIT" -s MAXIMUM_MEMORY=4GB \
  -s MALLOC="$MALLOC" -s STACK_SIZE=8MB -s USE_ZLIB=1 -s EXPORT_ES6=1 -s MODULARIZE=1 -s EXPORT_NAME="createModule" \
  -sEXPORTED_RUNTIME_METHODS=FS,ENV,ccall,cwrap,UTF8ToString,stringToNewUTF8,setValue,HEAPU8,HEAP16,HEAPU16,HEAP32,HEAPU32,HEAPF64 $4
echo "XONG: $OUT/libredwg-web.js + .wasm"
