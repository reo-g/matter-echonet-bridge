# テスト環境 — E2E テストと elemu 連携

このプロジェクトには、**実機なし・同一マシンだけで完結する E2E テスト環境**があります。
ECHONET Lite 側はスクリプタブルなエミュレータ、Matter 側は matter.js のコントローラ
(ClientNode) を使い、「EL 機器 ↔ ブリッジ ↔ Matter コントローラ」の全経路を検証します。

```
ElDeviceSim / elemu           ブリッジ (dist/bridge.js)        TestController
UDP :3611 で受信       ←──   --el-port 3611 で送信            (matter.js ClientNode)
UDP :3610 へ返信・通知  ──→   UDP :3610 で受信
                              Matter :5540                ←→   Matter :5580
```

## 同一ホストで動かすための二重ポート方式

ECHONET Lite はノード間通信のポートが **3610 固定** (受信も返信先も) です。
そのままではブリッジとエミュレータが同一ホストで 3610 を取り合い、unicast の配送先が
不定になります。そこで送受を分離します:

| プロセス | 受信ポート | 送信先ポート |
|---|---|---|
| ブリッジ | 3610 (通常どおり) | 3611 (`--el-port 3611`) |
| エミュレータ | 3611 | 3610 (EL 仕様どおり) |

ブリッジの `--el-port` は「送信先」だけを変えるオプションです (受信は 3610 のまま)。
併せて `--allow-self` (自ホスト発パケットの受理) が必要です。両方まとめた npm script:

```bash
npm run start:emulator   # = --quiet --allow-self --el-port 3611
```

> 実機や別マシンのエミュレータでテストする場合は、これらのフラグは不要です
> (通常の `npm start` を使う)。

## 自動 E2E テスト

```bash
npm test
```

`test/e2e.test.ts` (node:test) が以下を一括で行います:

1. `ElDeviceSim` (test/harness/el-device.ts) を :3611 で起動し、8 クラスの EL デバイスを定義
2. matter.js コントローラ (`TestController`) を起動し、**先にコミッショニングのスキャンを開始**
3. ブリッジを子プロセスで起動 (固定 passcode/discriminator) → 起動時アナウンスで即発見・PASE
4. EL デバイスを INF でアナウンス → ブリッジがエンドポイント化
5. テスト実行:
   - 全デバイスのエンドポイント公開と DimmableLight / ColorTemperatureLight の出し分け
   - EL 初期値 → Matter Attribute (温度・湿度・OnOff・Thermostat・DoorLock)
   - EL の INF 状変通知 → Matter への同期 (サブスクリプション経由)
   - Matter コマンド/属性書き込み → EL の SetC 受信 (OnOff / 設定温度 / 施錠解錠)

### ハーネスの構成

| ファイル | 役割 |
|---|---|
| `test/harness/el-device.ts` | スクリプタブル EL デバイス。Get/SetC/SetI/INF_REQ に応答し、プロパティマップ (0x9D/9E/9F)・インスタンスリスト (0xD6) も生成。SetC 受信履歴 (`receivedSets`) を記録 |
| `test/harness/bridge-process.ts` | ブリッジ子プロセスの起動/停止、ログ待ち合わせ (`waitForLog`) |
| `test/harness/controller.ts` | matter.js ClientNode のラッパー。コミッショニング、ブリッジ配下エンドポイント探索、属性読み取り/待機、コマンド呼び出し、属性書き込み |

### ハマりどころ (実装済みの対策)

- **mDNS のインターフェース固定が必須**: 指定しないと macOS の `ap1` (AirDrop) 等の
  到達不能アドレスを拾って PASE がハングします。ハーネスは実 LAN 側 I/F を自動検出し、
  `MATTER_MDNS_NETWORKINTERFACE` (ブリッジ) と `mdns.networkInterface` (コントローラ) に設定します。
  上書きは環境変数 `TEST_MDNS_IFACE`。
- **コミッショニングはコントローラ先行で**: 起動済みデバイスへの後追い discovery は
  再アナウンス待ちに入ることがあります。スキャン開始 → ブリッジ起動、の順が確実です。
- **ペアリング情報の固定**: ブリッジは matter.js 標準の環境変数
  (`MATTER_PASSCODE` / `MATTER_DISCRIMINATOR`、または `--passcode` / `--discriminator`)
  でパスコードを固定できます。テストは 20202021 / 3840 を使用。
- **ストレージ分離**: `MATTER_STORAGE_PATH` でブリッジ/コントローラの Matter ストレージを
  `test/.tmp/` 配下に分離し、毎回クリーンな状態から開始します。

## elemu (公式エミュレータ) との連携

[KAIT-HEMS/elemu](https://github.com/KAIT-HEMS/elemu) は公式 MRA 準拠で全 55 クラスを
エミュレートできる Web GUI 付きエミュレータです。GUI で対話的にプロパティを操作しながら
ブリッジの挙動を確認する用途に向きます。

elemu も「受信・返信先とも 3610 固定」「自ホスト発パケットは無視」という仕様のため、
同一ホストで動かすには 2 箇所の 1 行パッチが必要です (セットアップスクリプトが自動で適用):

1. bind ポートを環境変数 `ELEMU_BIND_PORT` で上書き可能に (返信先 3610 は無改造)
2. 自ホスト発パケットの無視を `ELEMU_ALLOW_SELF` で無効化できるように

```bash
npm run setup:elemu      # clone + パッチ + npm ci (test/.elemu/ に配置、git 管理外)

# ターミナル1: elemu (Web GUI: http://localhost:8880)
cd test/.elemu && ELEMU_BIND_PORT=3611 ELEMU_ALLOW_SELF=1 npm start

# ターミナル2: ブリッジ
npm run start:emulator
```

elemu の GUI で機器 (EOJ) を追加すると、ブリッジが自動発見して Matter に公開します。
Apple Home 等の実コントローラからコミッショニングして操作を確認できます。

> elemu を別マシンで動かす場合はパッチ・環境変数とも不要で、ブリッジも通常起動
> (`npm start`) で構いません。

## 制約・既知の注意点

- ブリッジの Matter ポートは 5540 固定です。他の Matter アプリが 5540 を使用中だと
  テストが失敗します。
- E2E テストは実ネットワークインターフェース上の mDNS を使うため、完全オフライン
  (外部 I/F なし) の環境では `TEST_MDNS_IFACE` で有効な I/F を指定してください。
- CI で動かす場合は UDP マルチキャストと mDNS が使えるランナーが必要です
  (GitHub Actions の Linux ランナーでは動作しますが、コンテナ内では追加設定が必要な場合があります)。
