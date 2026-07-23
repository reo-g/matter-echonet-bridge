# Echonet-Matter Bridge — アーキテクチャ概要

## 概要

ECHONET Lite (以下 EL) デバイスを Matter 標準に変換する **ブリッジデバイス** です。
Matter コントローラー (Apple Home, Google Home, Amazon Alexa 等) から既存の EL 機器を操作できるようになります。

```
[Apple Home / Google Home / Alexa]
          ↕  Matter (UDP/BLE/TCP)
  ┌───────────────────────────────────┐
  │      Echonet-Matter Bridge        │
  │       (Node.js プロセス)          │
  │                                   │
  │  AirconManager   FloorHeaterMgr   │
  │  LightManager    MonoLightMgr     │
  │  BlindManager    FanDeviceMgr     │
  │  LockManager     ReadOnlySensor─┐ │
  │                  │ Temp/Humidity│ │
  │                  │ Occupancy    │ │
  │                  │ Illuminance  │ │
  │                  │ CO2/Security │ │
  │                  └──────────────┘ │
  └───────────────────────────────────┘
          ↕  ECHONET Lite (UDP マルチキャスト, ポート 3610)
[エアコン][照明][ブラインド/シャッター][各種センサー][電気錠][換気扇][空気清浄機][床暖房]
```

---

## デバイス対応表

| EL クラスコード | EL デバイス種別 | Matter デバイスタイプ | 通信方向 |
|---|---|---|---|
| `0x0130` | 家庭用エアコン | Thermostat (0x0301) | 双方向 |
| `0x0290` | 一般照明 | Dimmable Light (0x0101) / Color Temperature Light (0x010C)※ | 双方向 |
| `0x0291` | 単機能照明 | On/Off Light (0x0100) | 双方向 |
| `0x0260` | 電動ブラインド | Window Covering (0x0202) | 双方向 |
| `0x0263` | 電動雨戸・シャッター | Window Covering (0x0202) | 双方向 |
| `0x0011` | 温度センサー | Temperature Sensor (0x0302) | EL→Matter (読み取り専用) |
| `0x0012` | 湿度センサー | Humidity Sensor (0x0307) | EL→Matter (読み取り専用) |
| `0x0007` | 人体検知センサー | Occupancy Sensor (0x0107) | EL→Matter (読み取り専用) |
| `0x00D0` | 照度センサー | Light Sensor (0x0106) | EL→Matter (読み取り専用) |
| `0x001B` | CO2センサー | Air Quality Sensor (0x002C) | EL→Matter (読み取り専用) |
| `0x0002` | 防犯センサー | Contact Sensor (0x0015) | EL→Matter (読み取り専用) |
| `0x026F` | 電気錠 | Door Lock (0x000A) | 双方向 |
| `0x0133` | 換気扇 | Fan (0x002B) | 双方向 |
| `0x0135` | 空気清浄器 | Air Purifier (0x002D) | 双方向 |
| `0x027B` | 床暖房 | Thermostat (0x0301) Heating専用 | 双方向 |

※ 一般照明は発見時に光色設定 (EPC 0xB1) の対応を自動判定し、対応機は Color Temperature Light、
非対応機は Dimmable Light として公開します。

スマートメーター (`0x0288`) は対象外です。

---

## ソフトウェアスタック

| レイヤー | ライブラリ |
|---|---|
| Matter プロトコル | `@matter/main` v0.16+ (matter.js) |
| Matter Node 基盤 | `@matter/nodejs` v0.16+ |
| ECHONET Lite | `echonet-lite` v2.16+ |
| 言語/ランタイム | TypeScript 5.8 / Node.js 20.19+ |

---

## ファイル構成

```
matter-echonet-bridge/
├── src/
│   └── bridge.ts               # ブリッジ実装 (単一ファイル)
├── dist/                       # TypeScript コンパイル出力
├── docs/                       # このドキュメント
│   ├── overview.md             # アーキテクチャ概要 (このファイル)
│   ├── devices.md              # デバイス別 EPC・Attribute 対応表
│   ├── commissioning.md        # コミッショニング手順
│   └── operation.md            # 起動・運用・トラブルシュート
├── package.json
└── tsconfig.json
```

---

## 主要クラス設計

### EchonetClient

EL プロトコルの低レベルラッパー。`echonet-lite` npm パッケージをラップし、以下を提供します。

- UDP ソケット初期化・マルチキャスト参加 (`224.0.23.0:3610`)
- INFC (通知応答要) への自動応答
- プロパティ取得 (Get / ESV=0x62)
- プロパティ設定 (SetC / ESV=0x61)
- ネットワーク探索 (`EL.search()`)

### XxxManager (各デバイスマネージャ)

デバイス種別ごとの Manager クラスが共通パターンを持ちます。
双方向デバイス (`AirconManager`, `LightManager`, `MonoLightManager`, `BlindManager`,
`LockManager`, `FanDeviceManager`, `FloorHeaterManager`) は個別クラス、
読み取り専用センサー (温度/湿度/人体検知/照度/CO2/防犯) は共通基底クラス
`ReadOnlySensorManager` のサブクラスとして実装されています。

| メソッド | 役割 |
|---|---|
| `handlePacket()` | EL パケット受信 → デバイス登録 / 状態更新 |
| `poll()` | 定期ポーリング + 到達性チェック |
| `createMatterEndpoint()` / `buildEndpoint()` | Matter Endpoint 生成・イベントハンドラ登録 |
| `syncToMatter()` | EL 状態変化を Matter Attribute に反映 |
| `updateReachable()` | 到達性を BridgedDeviceBasicInformation に反映 |

`FanDeviceManager` は換気扇 (0x0133) と空気清浄器 (0x0135) の両クラスコードを、
`BlindManager` はブラインド (0x0260) と雨戸・シャッター (0x0263) の両クラスコードを処理します。

### Suppress タイマーパターン

Matter からの操作コマンドと EL ポーリング応答の競合を防ぐタイマーです。

```
Matter→EL 操作発生
    ↓
beginSuppress(2000ms) ← タイマースタート (既存タイマーはリセット)
    ↓
EL ポーリング応答が届いても syncToMatter() をスキップ
    ↓
2秒後: タイマー解除 → 通常の EL→Matter 同期を再開
```

これにより連続した Matter 操作も確実にキャプチャされます。

---

## データフロー詳細

### EL → Matter (状態更新)

```
EL デバイスから UDP パケット受信
    ↓
ESV 確認 (GET_RES=0x72 / INF=0x73 / INFC=0x74)
    ↓
classCode で該当 Manager にディスパッチ
    ↓
isSuppressed チェック (True なら状態更新をスキップ)
    ↓
EPC ごとに内部 State を更新
    ↓
syncToMatter() で Matter Endpoint の Attribute を更新
```

### Matter → EL (コマンド送信)

```
Matter コントローラーから Attribute 変更 or コマンド受信
    ↓
$Changed イベントハンドラが発火
    ↓
beginSuppress() でタイマー開始
    ↓
内部 State を即時更新
    ↓
elClient.setProperty() で EL デバイスに SetC 送信
```

---

## 永続化ストレージ

matter.js は `~/.matter/matter-echonet-bridge/` にノードの認証情報・Fabric 情報を保存します。

主なファイル:

| ファイル | 内容 |
|---|---|
| `fabrics.fabrics` | コミッショニング済み Fabric (コントローラー証明書等) |
| `sessions.resumptionRecords` | CASE セッション再開情報 |
| `root.commissioning.passcode` | コミッショニング用パスコード |
| `root.commissioning.discriminator` | ディスクリミネーター |
| `root.parts.bridge.parts.*` | 各 Endpoint の Attribute 永続値 |

このストレージを削除すると再コミッショニングが必要になります。
