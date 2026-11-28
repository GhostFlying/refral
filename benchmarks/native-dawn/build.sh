#!/bin/bash
set -eu
root=$(git rev-parse --show-toplevel)
cd "$root"
src=${CHROMIUM_SRC:-"$HOME/WORKSPACE/chromium/src"}
out="$src/out/Default"
a="$root/artifacts/native-dawn"
b="$root/benchmarks/native-dawn"
mkdir -p "$a"
test "$(node -v)" = v24.14.0
test "$(git -C "$src" rev-parse HEAD)" = 77a6c69fa3d914688d149bfa4f427f9be4bcc1cb
test "$(git -C "$src/third_party/angle" rev-parse HEAD)" = d1c0f87e4626e19a4803cda526afa7eeffbe109a
test "$(git -C "$src/third_party/dawn" rev-parse HEAD)" = 922930e3193753e58591f14a96ab116e5d630964
if [ ! -f "$a/v8-fast-api-calls.h" ]; then
  curl -fsSL https://raw.githubusercontent.com/nodejs/node/v24.14.0/deps/v8/include/v8-fast-api-calls.h -o "$a/v8-fast-api-calls.h"
fi
echo "c6c8b22ebf8014ef5b1cb04bec2af7549754cede52b745474aae1762e060b842  $a/v8-fast-api-calls.h" | shasum -a 256 -c -
python3 "$b/link-angle.py" "$out" "$a/libprobe_angle.dylib"
cargo build --locked --release --manifest-path "$b/rust/Cargo.toml" --target-dir "$a/target"
addon=animometer
flags=(-O3)
if [[ "${1:-}" == "--count-allocations" ]]; then
  addon=animometer-audit
  flags+=(-DREFRAL_COUNT_ALLOCATIONS)
fi
clang++ "${flags[@]}" -std=c++20 -bundle -undefined dynamic_lookup -I"$(dirname "$(command -v node)")/../include/node" -I"$a" \
  -I"$src/third_party/angle/include" -I"$src/third_party/dawn/include" -I"$out/gen/third_party/dawn/include" \
  "$b"/{addon,device,angle,rust-host}.cc "$a/target/release/librefral_native_animometer.a" \
  -L"$a" -lprobe_angle -L"$out" -ldawn_native -ldawn_proc -Wl,-rpath,"$out" -Wl,-rpath,"$a" -o "$a/$addon.node"
