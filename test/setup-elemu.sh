#!/usr/bin/env bash
# elemu (KAIT-HEMS の ECHONET Lite 機器エミュレータ) をブリッジと同一ホストで
# 動かせる形でセットアップする。
#
# 背景: EL ノードは受信も返信先も UDP 3610 固定のため、ブリッジと elemu を
# 同一ホストで起動すると unicast の配送先が不定になる。そこで:
#   - elemu:   ELEMU_BIND_PORT=3611 で受信 (このスクリプトが 1 行パッチを適用)
#              返信・通知は無改造のまま 3610 へ送られる
#   - ブリッジ: 3610 で受信し、--el-port 3611 で elemu へ送信
#
# 使い方:
#   ./test/setup-elemu.sh                 # クローン + パッチ + npm ci
#   (cd test/.elemu && ELEMU_BIND_PORT=3611 ELEMU_ALLOW_SELF=1 npm start)   # elemu 起動 (GUI: http://localhost:8880)
#   npm run start:emulator                # ブリッジ起動 (--allow-self --el-port 3611)
set -euo pipefail

cd "$(dirname "$0")"
ELEMU_DIR=".elemu"
ELEMU_REPO="https://github.com/KAIT-HEMS/elemu.git"
# 動作確認済みコミット (V1.2.0 系, main 2024-12)。更新する場合は動作確認の上で変更する
ELEMU_REF="main"

if [ ! -d "$ELEMU_DIR" ]; then
  echo "==> cloning elemu..."
  git clone --depth 1 --branch "$ELEMU_REF" "$ELEMU_REPO" "$ELEMU_DIR"
else
  echo "==> elemu already cloned ($ELEMU_DIR)"
fi

cd "$ELEMU_DIR"

echo "==> applying same-host patches (ELEMU_BIND_PORT / ELEMU_ALLOW_SELF)..."
node - <<'EOF'
const fs = require("fs");
const path = "lib/Device.js";
let src = fs.readFileSync(path, "utf8");
let changed = false;

// パッチ1: bind ポートを環境変数で上書き可能に (返信先 3610 は無改造)
const bindOrig = "let port = this._ip_address_utils.getPortNumber();";
const bindNew  = "let port = Number(process.env.ELEMU_BIND_PORT) || this._ip_address_utils.getPortNumber();";
if (src.includes(bindNew)) {
  console.log("    bind-port: already patched");
} else if (src.includes(bindOrig)) {
  src = src.replace(bindOrig, bindNew);
  changed = true;
  console.log("    bind-port: patched");
} else {
  console.error("    ERROR: bind-port patch target not found — elemu の実装が変わった可能性があります");
  process.exit(1);
}

// パッチ2: 自ホスト発パケットの無視を環境変数で無効化 (同一ホストのブリッジと通信するため)
const selfOrig = "if (this._ip_address_utils.isLocalAddress(address)) {";
const selfNew  = "if (!process.env.ELEMU_ALLOW_SELF && this._ip_address_utils.isLocalAddress(address)) {";
if (src.includes(selfNew)) {
  console.log("    allow-self: already patched");
} else if (src.includes(selfOrig)) {
  src = src.replace(selfOrig, selfNew);
  changed = true;
  console.log("    allow-self: patched");
} else {
  console.error("    ERROR: allow-self patch target not found — elemu の実装が変わった可能性があります");
  process.exit(1);
}

if (changed) fs.writeFileSync(path, src);
EOF

echo "==> npm ci..."
npm ci --silent 2>/dev/null || npm install --silent

cat <<'MSG'

==> done. 起動方法:

  # ターミナル1: elemu (Web GUI: http://localhost:8880)
  cd test/.elemu && ELEMU_BIND_PORT=3611 ELEMU_ALLOW_SELF=1 npm start

  # ターミナル2: ブリッジ (エミュレータ連携モード)
  npm run start:emulator

  elemu の GUI で機器 (EOJ) を追加すると、ブリッジが自動発見して
  Matter コントローラに公開します。
MSG
