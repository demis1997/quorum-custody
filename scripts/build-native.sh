#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
root="$PWD"
source_dir="$root/.build/cb-mpc"
openssl_root="$root/.build/openssl"
commit=0b716706f998633912ee2be9b9bf8909aed66088
mkdir -p .build
if [ ! -d "$source_dir/.git" ]; then
  GIT_LFS_SKIP_SMUDGE=1 git clone https://github.com/coinbase/cb-mpc.git "$source_dir"
fi
git -C "$source_dir" checkout --detach "$commit"
test "$(git -C "$source_dir" rev-parse HEAD)" = "$commit"
# Building from the untouched pinned checkout; only the external OpenSSL sources
# receive the exact patch specified by upstream's checked-in build script.
if [ ! -f "$openssl_root/lib/libcrypto.a" ] && [ ! -f "$openssl_root/lib64/libcrypto.a" ]; then
  case "$(uname -s)/$(uname -m)" in
    Darwin/arm64) script=build-static-openssl-macos-m1.sh ;;
    Darwin/x86_64) script=build-static-openssl-macos.sh ;;
    Linux/*) script=build-static-openssl-linux.sh ;;
    *) echo 'Unsupported platform' >&2;exit 1 ;;
  esac
  CBMPC_OPENSSL_ROOT="$openssl_root" sh "$source_dir/scripts/openssl/$script" > .build/openssl.log 2>&1
fi
cmake -S native -B .build/native -DCMAKE_BUILD_TYPE=Release -DCBMPC_SOURCE="$source_dir" -DCBMPC_OPENSSL_ROOT="$openssl_root"
cmake --build .build/native -j "${QUORUM_BUILD_JOBS:-4}"
cp .build/native/quorum-signer .build/quorum-signer
