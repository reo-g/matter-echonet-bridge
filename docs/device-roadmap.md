# 対応デバイス拡張ロードマップ — ECHONET Lite ↔ Matter 機能マッピング

現在の 5 デバイス種別からの拡張候補を、**ECHONET Lite 側の機器オブジェクト定義**と
**Matter 側 (matter.js) のデバイスタイプ実装**の両面から調査した結果をまとめます。

- 調査日: 2026-07-03
- EL 側の根拠: ECHONET Machine Readable Appendix (MRA)。クラスコード・EPC・アクセスルールは
  [KAIT-HEMS/elemu](https://github.com/KAIT-HEMS/elemu) 同梱の公式 MRA データで検証済み
- Matter 側の根拠: 本プロジェクトが依存する **matter.js v0.16** (`@matter/node`) に
  実装済みのデバイスタイプ定義 (デバイスタイプ ID はライブラリ実体から抽出)

> ⚠️ 「コントローラ対応」列は 2026-07 時点の筆者調べです。OS バージョンにより変わるため、
> 実装前に実機コミッショニングでの確認を推奨します。

---

## 現在の対応デバイス (v1.0.0)

| EL クラス | EL デバイス | Matter デバイスタイプ | 方向 |
|---|---|---|---|
| `0x0130` | 家庭用エアコン | Thermostat (`0x0301`) | 双方向 |
| `0x0290` | 一般照明 | Dimmable Light (`0x0101`) | 双方向 |
| `0x0260` | 電動ブラインド・日よけ | Window Covering (`0x0202`) | 双方向 |
| `0x0011` | 温度センサ | Temperature Sensor (`0x0302`) | EL→Matter |
| `0x026F` | 電気錠 | Door Lock (`0x000A`) | 双方向 |

---

## 拡張候補の全体マップ

> ✅ **2026-07-03 更新: Tier 1 / Tier 2 は実装済み** (対応状況は [devices.md](devices.md) 参照)。
> Tier 3 とスマートメータ以下は未実装のまま将来候補。

### Tier 1 — 少ない工数で追加可能 ✅ 実装済み

既存の Manager パターン (handlePacket / poll / setAggregator) をほぼそのまま流用できる候補。

| EL クラス | EL デバイス | Matter デバイスタイプ | 難度 | Apple | Google | Alexa | 備考 |
|---|---|---|---|---|---|---|---|
| `0x0012` | 湿度センサ | Humidity Sensor (`0x0307`) | ★ | ✅ | ✅ | ✅ | TempSensorManager の複製で実装可 |
| `0x0007` | 人体検知センサ | Occupancy Sensor (`0x0107`) | ★ | ✅ | ✅ | ✅ | オートメーショントリガーとして価値大 |
| `0x00D0` | 照度センサ | Light Sensor (`0x0106`) | ★ | ✅ | △ | △ | クラスコードは `0x000D` ではなく **`0x00D0`** (MRA 確認済) |
| `0x001B` | CO2センサ | Air Quality Sensor (`0x002C`) | ★★ | ✅ | ✅ | ✅ | iOS 17+ / CO2 濃度クラスター |
| `0x0291` | 単機能照明 | On/Off Light (`0x0100`) | ★ | ✅ | ✅ | ✅ | 現行 LightManager のサブセット |
| `0x0263` | 電動雨戸・シャッター | Window Covering (`0x0202`) | ★ | ✅ | ✅ | ✅ | EPC 構成が `0x0260` とほぼ同一。BlindManager にクラスコード追加のみ |
| `0x0002` | 防犯センサ | Contact Sensor (`0x0015`) | ★ | ✅ | ✅ | ✅ | 検知状態 → BooleanState |

### Tier 2 — 中規模工数 (マッピング設計が必要) ✅ 実装済み

| EL クラス | EL デバイス | Matter デバイスタイプ | 難度 | Apple | Google | Alexa | 備考 |
|---|---|---|---|---|---|---|---|
| `0x0133` | 換気扇 | Fan (`0x002B`) | ★★ | ✅ | ✅ | △ | FanControl クラスター (下記詳細) |
| `0x0135` | 空気清浄器 | Air Purifier (`0x002D`) | ★★ | ✅ | ✅ | △ | iOS 17+。FanControl 必須 + フィルタ監視は任意 |
| `0x027B` | 床暖房 | Thermostat (`0x0301`) Heating only | ★★ | ✅ | ✅ | ✅ | 日本の住宅で普及。エアコン実装の Heating 専用版 |
| `0x0290` 拡張 | 一般照明の光色 (`0xB1`) | Color Temperature Light (`0x010C`) | ★★ | ✅ | ✅ | ✅ | 新クラスではなく既存 LightManager の格上げ |

### Tier 3 — Matter 1.3/1.4 の新デバイスタイプ (コントローラ対応の成熟待ち)

matter.js v0.16 にはデバイスタイプ定義が存在するが、2026-07 時点で主要コントローラ
(Apple/Google/Alexa) がほぼ未対応。SmartThings が先行。実装しても現状はエコシステムで使えない。

| EL クラス | EL デバイス | Matter デバイスタイプ | 備考 |
|---|---|---|---|
| `0x026B` / `0x02A6` / `0x0272` | 電気温水器 (EcoCute) / ハイブリッド給湯機 / 瞬間式給湯器 | Water Heater (`0x050F`, Matter 1.4) | EL 側は沸き上げ・風呂自動など EPC が非常に豊富。エネルギー管理の本命 |
| `0x027D` | 蓄電池 | Battery Storage (`0x0018`, Matter 1.4) | |
| `0x0279` | 住宅用太陽光発電 | Solar Power (`0x0017`, Matter 1.4) | |
| `0x027E` / `0x02A1` | EV 充放電器 / EV 充電器 | Energy EVSE (`0x050C`, Matter 1.3) | |
| `0x03B7` | 冷凍冷蔵庫 | Refrigerator (`0x0070`) | ドア開閉 `0xB0` → 通知は魅力だが Apple 非対応 |
| `0x03D3` | 洗濯乾燥機 | Laundry Washer (`0x0073`) / Dryer (`0x007C`) | モード体系の対応付けが重い |

### 対象外 (実装しない)

| EL クラス | 理由 |
|---|---|
| `0x0288` 低圧スマート電力量メータ | B ルート (Wi-SUN) 前提で LAN ブリッジの対象外 (README 記載どおり) |
| `0x03B9` クッキングヒータ / `0x03BB` 炊飯器 | 加熱機器の遠隔 ON は EL 側で安全上の制約があり、Matter 側にも適切なデバイスタイプがない |
| `0x0602` テレビ | Matter のメディア系デバイスはコントローラ対応が特殊 (Casting) で費用対効果が低い |
| `0x0156` 系・`0x03CE` 系 業務用機器 | 家庭用ブリッジのスコープ外 |

---

## Tier 1 候補の詳細マッピング

### 湿度センサ (EL `0x0012` → Matter Humidity Sensor `0x0307`)

| EPC | EPC 名称 | アクセス | Matter Attribute | 変換 |
|---|---|---|---|---|
| `0xE0` | 相対湿度計測値 | Get 必須 | `relativeHumidityMeasurement.measuredValue` | 1 バイト % → 0.01% 単位 (`% × 100`)、`0xFD`(オーバーフロー)/`0xFE`(アンダーフロー) → `null` |

実装は TempSensorManager と同型 (読み取り専用・Suppress タイマ不要)。

### 人体検知センサ (EL `0x0007` → Matter Occupancy Sensor `0x0107`)

| EPC | EPC 名称 | アクセス | Matter Attribute | 変換 |
|---|---|---|---|---|
| `0xB1` | 人体検知状態 | Get 必須 | `occupancySensing.occupancy` | `0x41`=検知 → `{occupied: true}` / `0x42`=非検知 → `{occupied: false}` |

`occupancySensorType` は `Pir` を設定。検知イベントの即時性はポーリング間隔 (30 秒) に依存する点に注意
(EL 機器が INF (状変時通知) を送る場合はプッシュで反映可能)。

### 照度センサ (EL `0x00D0` → Matter Light Sensor `0x0106`)

| EPC | EPC 名称 | アクセス | Matter Attribute | 変換 |
|---|---|---|---|---|
| `0xE0` | 照度計測値1 (lux) | Get 条件付き必須 | `illuminanceMeasurement.measuredValue` | **対数スケール**: `round(10000 × log10(lux) + 1)`、0 lux → `0` |
| `0xE1` | 照度計測値2 (klx) | Get 条件付き必須 | 同上 | `lux = klx × 1000` として同式 |

Matter の照度は lux 生値ではなく対数エンコーディングである点が最大の注意点。
`0xE0`/`0xE1` はどちらか一方の実装で可 (required_c) のため、両対応が必要。

### CO2 センサ (EL `0x001B` → Matter Air Quality Sensor `0x002C`)

| EPC | EPC 名称 | アクセス | Matter Attribute | 変換 |
|---|---|---|---|---|
| `0xE0` | CO2濃度計測値 | Get 必須 | `carbonDioxideConcentrationMeasurement.measuredValue` | 2 バイト ppm → float ppm (`NumericMeasurement` + `MeasurementMedium=Air`) |
| (同上から導出) | — | — | `airQuality.airQuality` | 例: <800=Good / <1000=Fair / <1500=Moderate / ≥1500=Poor |

AirQuality クラスターが必須のため、CO2 値から品質区分を導出して両方を更新する。

### 単機能照明 (EL `0x0291` → Matter On/Off Light `0x0100`)

| EPC | EPC 名称 | アクセス | Matter Attribute | 変換 |
|---|---|---|---|---|
| `0x80` | 動作状態 | Get/Set 必須 | `onOff.onOff` | `0x30`=ON / `0x31`=OFF (双方向) |

現行 LightManager から LevelControl を除いただけの構成。クラスコード分岐の追加で対応可能。

### 電動雨戸・シャッター (EL `0x0263` → Matter Window Covering `0x0202`)

| EPC | EPC 名称 | アクセス | Matter Attribute | 変換 |
|---|---|---|---|---|
| `0xE0` | 開閉動作設定 | Get/Set 必須 | `targetPositionLiftPercent100ths` | `0x41`=開 / `0x42`=閉 (現行 0x0260 と同一) |
| `0xE1` | 開度レベル設定 (%) | 任意 | `current/targetPositionLiftPercent100ths` | `% × 100` (対応機のみ。下記「既存デバイスの強化」参照) |
| `0xEA` | 開閉状態 | 任意 | `operationalStatus` | 全開/全閉/開動作中/閉動作中/途中停止 |

BlindManager のディスパッチに `"0263"` を追加し、`endProductType` を `RollerShutter` にするだけで最小対応できる。

### 防犯センサ (EL `0x0002` → Matter Contact Sensor `0x0015`)

| EPC | EPC 名称 | アクセス | Matter Attribute | 変換 |
|---|---|---|---|---|
| `0xB1` | 侵入発生状態 | Get 必須 | `booleanState.stateValue` | 検知=`false` (open) / 非検知=`true` (closed) |

---

## Tier 2 候補の詳細マッピング

### 換気扇 (EL `0x0133` → Matter Fan `0x002B`)

| EPC | EPC 名称 | アクセス | Matter Attribute | 変換 |
|---|---|---|---|---|
| `0x80` | 動作状態 | Get/Set 必須 | `fanControl.fanMode` | OFF → `Off` / ON → 風量に応じたモード |
| `0xA0` | 換気風量設定 | 任意 | `fanControl.percentSetting` / `fanMode` | `0x31`-`0x38` (8 段階) → `12/25/37/50/62/75/87/100%`、`0x41`=自動 → `fanMode=Auto` |

FanControl は `fanModeSequence` の宣言と `percentCurrent` の同期が必要。エアコンの `0xA0` と同じ
8 段階レベル表現なので変換ユーティリティを共通化できる。

### 空気清浄器 (EL `0x0135` → Matter Air Purifier `0x002D`)

| EPC | EPC 名称 | アクセス | Matter Attribute | 変換 |
|---|---|---|---|---|
| `0x80` | 動作状態 | Get/Set 必須 | `fanControl.fanMode` | 換気扇と同様 |
| `0xA0` | 風量設定 | 任意 | `fanControl.percentSetting` | 同上 (`0x41`=自動あり) |
| `0xC0` | 空気汚れ検知状態 | 任意 | (Air Quality Sensor を子エンドポイントで併設) | `0x41`=汚れあり → `airQuality=Poor` 等 |
| `0xE1` | フィルタ交換通知状態 | 任意 | `hepaFilterMonitoring.changeIndication` | `0x41`=交換要 → `Critical` |

Air Purifier は FanControl のみで成立し、フィルタ監視・空気質は任意クラスターとして段階的に追加できる。

### 床暖房 (EL `0x027B` → Matter Thermostat `0x0301`, Heating 専用)

| EPC | EPC 名称 | アクセス | Matter Attribute | 変換 |
|---|---|---|---|---|
| `0x80` | 動作状態 | Get/Set 必須 | `systemMode` | ON → `Heat` / OFF → `Off` |
| `0xE0` | 温度設定1 (℃) | 条件付き必須 | `occupiedHeatingSetpoint` | 1 バイト ℃ → 0.01℃ 単位 |
| `0xE1` | 温度設定2 (レベル) | 条件付き必須 | 同上 | `0x31`-`0x3F` レベル → 温度レンジへ線形写像 (機器依存、`0xD1` で最大レベル取得) |
| `0xE2` | 室内温度計測値 | 任意 | `localTemperature` | 1 バイト ℃ |
| `0xE3` | 床温度計測値 | 任意 | (内部保持) | |

`Thermostat.with("Heating")` のみで構成 (`controlSequenceOfOperation: HeatingOnly`)。
エアコン実装からデッドバンド処理を除いた簡略版になる。温度が「℃ 型」(`0xE0`) と
「レベル型」(`0xE1`) の 2 系統あり、機器がどちらを実装しているかで分岐が必要な点が本質的な難しさ。

### 一般照明の光色対応 (既存 `0x0290` → Color Temperature Light `0x010C` に格上げ)

| EPC | EPC 名称 | アクセス | Matter Attribute | 変換 |
|---|---|---|---|---|
| `0xB1` | 光色設定 | 任意 | `colorControl.colorTemperatureMireds` | 離散値マッピング (下表) |

| EL 値 | 光色 | 近似色温度 | mireds |
|---|---|---|---|
| `0x41` | 電球色 | 2700K | 370 |
| `0x42` | 白色 | 4000K | 250 |
| `0x43` | 昼白色 | 5000K | 200 |
| `0x44` | 昼光色 | 6500K | 154 |

Matter→EL は mireds を最近傍の 4 値に量子化する。EL 機器が `0xB1` を持たない場合は
従来どおり Dimmable Light として公開する (発見時の Get 応答でクラスター構成を出し分け)。
なお `0xC0` (カラー灯モード時 RGB 設定) を持つ機器は Extended Color Light (`0x010D`) まで拡張可能。

---

## 既存デバイスの機能強化 (新クラス追加以外)

| 対象 | EPC | 内容 |
|---|---|---|
| エアコン | `0xA0` 風量設定 | 既にパース済み (内部保持のみ)。FanControl クラスターを Thermostat エンドポイントに追加し風量操作を公開 |
| エアコン | `0xBA` 室内相対湿度 | 既にパース済み。Humidity Sensor を子エンドポイントとして併設 |
| ブラインド | `0xE1` 開度レベル設定 | 対応機では現在のバイナリ開/閉を 0-100% の連続位置制御に格上げ (`targetPositionLiftPercent100ths` の実値反映) |
| 電気錠 | `0xE3` 扉開閉状態等 | DoorLock の `doorState` への反映 (対応機のみ) |

いずれも「機器が任意 EPC を実装している場合のみ有効化」する graceful degradation 方針とする。

---

## テスト環境の課題と推奨

現在の動作確認は [MoekadenRoom](https://github.com/SonyCSL/MoekadenRoom) だが、
対応エミュレーションは 5 機器 + スマートメータのみで、**Tier 1 以降の候補はテストできない**。

拡張にあたっては [KAIT-HEMS/elemu](https://github.com/KAIT-HEMS/elemu)
(神奈川工科大学の ECHONET Lite 機器エミュレータ) への移行/併用を推奨する:

- 本ドキュメントの調査対象 **55 クラスすべて**をエミュレート可能 (公式 MRA データ準拠)
- Node.js 製・Web GUI 付きで `npm start` で起動でき、CI への組み込み余地もある
- EPC 単位でプロパティ値を GUI から操作でき、INF (状変時通知) のテストも可能

---

## 実装優先度の提案

1. **`0x0263` 雨戸・シャッター** — BlindManager への 1 行追加レベル。即効性最大
2. **`0x0012` 湿度 / `0x0007` 人体検知 / `0x00D0` 照度** — センサ 3 種。TempSensorManager の型を流用、オートメーション価値が高い
3. **`0x0291` 単機能照明** — LightManager の縮退版
4. **エアコン FanControl + ブラインド開度レベル** — 新規クラスなしで体験が向上
5. **`0x0133` 換気扇 → `0x0135` 空気清浄器** — FanControl 実装を共有して段階導入
6. **`0x027B` 床暖房 / 照明の光色** — マッピング設計を伴う中規模
7. **Tier 3 (給湯器・蓄電池・太陽光・EVSE)** — コントローラ対応の成熟を待って着手。Matter 1.4 Energy 系はエコシステム側が追いつき次第、日本市場で価値が見込まれる領域

## 参考

- [ECHONET Machine Readable Appendix (MRA)](https://echonet.jp/spec_mra_rr2_en/) — EL 機器オブジェクト定義の一次情報
- [KAIT-HEMS/elemu](https://github.com/KAIT-HEMS/elemu) — MRA 準拠の機器エミュレータ (本調査のクラスコード検証にも使用)
- [matter.js Devices](https://github.com/project-chip/matter.js) — `@matter/node` の `devices/` ディレクトリが実装済みデバイスタイプの一次情報
- [docs/devices.md](devices.md) — 現行 5 デバイスの実装済みマッピング詳細
