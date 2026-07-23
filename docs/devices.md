# 対応デバイス詳細 — EPC / Matter Attribute 対応表

## 共通仕様

### BridgedDeviceBasicInformation クラスター (全デバイス共通)

すべてのデバイスは Matter Bridge モードで動作し、以下の Attribute を持ちます。

| Matter Attribute | 設定値 | 説明 |
|---|---|---|
| `nodeLabel` | `"エアコン (192.168.x.x)"` 等 | HomeKit 等で表示されるデバイス名 |
| `vendorName` | `"reomaru"` | メーカー名 |
| `productName` | デバイス種別ごと | 製品名 |
| `serialNumber` | `{ip}_{eoj}` | 一意識別子 (例: `192.168.1.10_013001`) |
| `reachable` | `true` / `false` | 到達性フラグ (120秒タイムアウト) |

### 到達性管理

- **ポーリング間隔**: 30秒ごとに EL プロパティ取得要求を送信
- **タイムアウト**: 最終受信から 120秒 経過で `reachable = false`
- **復帰**: 次回のポーリング応答受信時に `reachable = true` に戻る

---

## 1. エアコン (EL 0x0130 → Matter Thermostat)

### EPC 対応表

| EPC | EPC 名称 | EDT 値 | Matter Attribute | 方向 |
|---|---|---|---|---|
| `0x80` | 動作状態 | `0x30`=ON / `0x31`=OFF | `systemMode` (Off=0) | 双方向 |
| `0xB0` | 運転モード | 下表参照 | `systemMode` | 双方向 |
| `0xB3` | 設定温度 | 符号付き1バイト (℃) | `occupiedCoolingSetpoint` / `occupiedHeatingSetpoint` | 双方向 |
| `0xBB` | 室温計測値 | 符号付き1バイト (℃) | `localTemperature` | EL→Matter |
| `0xBA` | 室内相対湿度 | 0〜100 (%) | (内部保持のみ) | EL→Matter |
| `0xBE` | 外気温度計測値 | 符号付き1バイト (℃) | (内部保持のみ) | EL→Matter |
| `0xA0` | 風量設定 | `0x41`=Auto / `0x31-0x38`=Lv1-8 | (内部保持 + ログ) | EL→Matter |
| `0xA3` | スイング設定 | `0x31`〜 | (内部保持のみ) | EL→Matter |
| `0x88` | 異常発生状態 | `0x41`=異常あり / `0x42`=正常 | `reachable` | EL→Matter |
| `0x8F` | 節電動作状態 | `0x41`=節電中 / `0x42`=通常 | (内部保持 + ログ) | EL→Matter |

> 室温 (`0xBB`) が計測不能 (`0x7E`) の場合、`localTemperature` には設定温度値を代替使用します。
>
> 異常発生 (`0x88=0x41`) を検知すると `BridgedDeviceBasicInformation.reachable` を `false` に設定し、HomeKit 等に異常を通知します。

### 運転モードマッピング

| EL 値 | EL モード名 | Matter SystemMode | 備考 |
|---|---|---|---|
| `0x41` | 自動 | `Auto` (1) | |
| `0x42` | 冷房 | `Cool` (3) | |
| `0x43` | 暖房 | `Heat` (4) | |
| `0x44` | 除湿 | `Cool` (3) | Matter に除湿モードなし |
| `0x45` | 送風 | `FanOnly` (6) | |
| (電源OFF) | — | `Off` (0) | |

### Thermostat クラスター有効 Feature

```
Thermostat.with("Heating", "Cooling", "AutoMode")
```

| Feature | 効果 |
|---|---|
| `Heating` | `occupiedHeatingSetpoint` を有効化 |
| `Cooling` | `occupiedCoolingSetpoint` を有効化 |
| `AutoMode` | `systemMode = Auto` を有効化 |

### セットポイントとデッドバンド

Matter 仕様では冷房/暖房セットポイントに最小 1.0℃ のデッドバンドが必要です。
EL は設定温度を1値で持つため、以下のように変換します。

| Matter Attribute | 変換ルール |
|---|---|
| `minSetpointDeadBand` | `10` (= 1.0℃、単位は 0.1℃) |
| `minCoolSetpointLimit` | `1600` (= 16℃) |
| `maxCoolSetpointLimit` | `3200` (= 32℃) |
| `minHeatSetpointLimit` | `700` (= 7℃) |
| `maxHeatSetpointLimit` | `3000` (= 30℃) |
| `controlSequenceOfOperation` | `CoolingAndHeating` (冷暖両対応) |

**モード変更時の自動補正**: モード変更時に現在の EL 設定温度に合わせてセットポイントを再計算し、デッドバンド制約を満たすよう調整します。

---

## 2. 照明 (EL 0x0290 → Matter Dimmable Light / Color Temperature Light)

### EPC 対応表

| EPC | EPC 名称 | EDT 値 | Matter Attribute | 方向 |
|---|---|---|---|---|
| `0x80` | 動作状態 | `0x30`=ON / `0x31`=OFF | `onOff.onOff` | 双方向 |
| `0xB0` | 照度レベル設定 | `0x00`-`0x64` (0-100%) | `levelControl.currentLevel` (1-254) | 双方向 |
| `0xB1` | 光色設定 | `0x41`-`0x44` (下表) | `colorControl.colorTemperatureMireds` | 双方向 (対応機のみ) |

### 光色対応の自動判定

発見時に `0xB1` の Get を送信し、**3.5 秒以内に有効な応答があれば Color Temperature Light**、
なければ Dimmable Light としてエンドポイントを作成します
(発見パケット自体に `0xB1` が含まれる場合は即時判定)。

### 光色 ↔ 色温度マッピング

EL の光色は離散4値のため、Matter の連続値 (mireds) と以下で相互変換します。
Matter→EL は最近傍の値に量子化します。

| EL 値 | 光色 | 近似色温度 | mireds |
|---|---|---|---|
| `0x41` | 電球色 | 2700K | 370 |
| `0x42` | 白色 | 4000K | 250 |
| `0x43` | 昼白色 | 5000K | 200 |
| `0x44` | 昼光色 | 6500K | 154 |

### DimmableLightDevice クラスター構成

`DimmableLightDevice` を使用し、`OnOff` + `LevelControl(Lighting, OnOff)` を提供します。
光色対応機では `ColorTemperatureLightDevice` (上記 + `ColorControl(ColorTemperature)`) を使用します。

| Matter Attribute | 型 | 初期値 |
|---|---|---|
| `onOff.onOff` | `boolean` | EL 発見パケット (なければ `false`) |
| `levelControl.currentLevel` | `number` (1-254) | EL 0xB0 から変換 (なければ 254) |
| `levelControl.minLevel` | `number` | `1` |
| `levelControl.maxLevel` | `number` | `254` |

### 照度レベル変換

| EL EDT (0xB0) | 値 | Matter currentLevel | 式 |
|---|---|---|---|
| `0x00` | 0% | 1 (最低) | `max(1, round(elLevel * 254 / 100))` |
| `0x32` | 50% | 127 | ← |
| `0x64` | 100% | 254 (最大) | ← |

逆変換: `round(matterLevel * 100 / 254)`

### Matter → EL 操作

| イベント | EL コマンド |
|---|---|
| `onOff$Changed` → true | SetC 0x80 EDT `0x30` (ON) |
| `onOff$Changed` → false | SetC 0x80 EDT `0x31` (OFF) |
| `levelControl.currentLevel$Changed` | SetC 0xB0 EDT (輝度 0-100%) |

---

## 3. 電動ブラインド (EL 0x0260 → Matter Window Covering)

### EPC 対応表

| EPC | EPC 名称 | EDT 値 | Matter Attribute | 方向 |
|---|---|---|---|---|
| `0xE0` | 開閉動作設定 | `0x41`=開 / `0x42`=閉 | `targetPositionLiftPercent100ths` | 双方向 |

### WindowCovering クラスター有効 Feature

```
WindowCoveringServer.with("Lift", "PositionAwareLift")
```

`PositionAwareLift` を有効にしないと HomeKit が「応答なし」を返すため必須です。

### バイナリ位置マッピング

MoekadenRoom は位置情報 (0〜100%) を持たないため、バイナリ (開/閉) にマッピングします。

| EL 状態 | `currentPositionLiftPercent100ths` | `currentPositionLiftPercentage` | 意味 |
|---|---|---|---|
| 開 (`0x41`) | `0` (= 0%) | `0` | 完全に開いている |
| 閉 (`0x42`) | `10000` (= 100%) | `100` | 完全に閉じている |

Matter の位置値は 0 = 開いている / 10000 = 閉じている の方向性です。

### Matter → EL 操作

`targetPositionLiftPercent100ths$Changed` イベントを監視します。

```
target < 5000  (50%未満) → 開く → EPC 0xE0 EDT 0x41
target >= 5000 (50%以上) → 閉じる → EPC 0xE0 EDT 0x42
```

### 初期設定値

| Matter Attribute | 設定値 |
|---|---|
| `type` | `Rollershade` |
| `endProductType` | `RollerShade` |
| `configStatus.operational` | `true` |
| `configStatus.liftPositionAware` | `true` |
| `operationalStatus` | 全て `Stopped` |

---

## 4. 温度センサー (EL 0x0011 → Matter Temperature Sensor)

### EPC 対応表

| EPC | EPC 名称 | EDT 形式 | Matter Attribute | 方向 |
|---|---|---|---|---|
| `0xE0` | 温度計測値 | 2バイト符号付き, 0.1℃単位 | `measuredValue` | EL→Matter のみ |

### TemperatureMeasurement クラスター

`TemperatureSensorDevice` にデフォルト内蔵の `TemperatureMeasurementServer` を使用します。

| Matter Attribute | 型 | 設定値 |
|---|---|---|
| `measuredValue` | `number \| null` | EL 温度値 (単位: 0.01℃) |
| `minMeasuredValue` | `number` | `-1000` (= -10℃) |
| `maxMeasuredValue` | `number` | `5000` (= 50℃) |

### 温度値エンコーディング

EL の温度センサー (`0x0011`) EPC `0xE0` は **2バイト符号付き整数、0.1℃単位** です。
これをエアコンの1バイト形式と混同しないよう専用パーサーを使用します。

```
EL EDT: 0x00F0 (hex) = 240 (dec) = 24.0℃
Matter: 2400 (= 24.00℃、0.01℃単位)

特殊値:
  0x7FFE = 計測範囲超過 → null
  0x7FFF = 計測不能    → null
```

### 読み取り専用

温度センサーは EL→Matter の一方向のみです。Matter からの書き込みイベントハンドラはありません。Suppress タイマーも不要です。

---

## 5. 電気錠 (EL 0x026F → Matter Door Lock)

### EPC 対応表

| EPC | EPC 名称 | EDT 値 | Matter Attribute | 方向 |
|---|---|---|---|---|
| `0xE0` | 施錠設定 | `0x41`=施錠 / `0x42`=解錠 | `lockState` | 双方向 |

### DoorLock クラスター

`DoorLockDevice` にデフォルト内蔵の `DoorLockServer` を使用します。

| Matter Attribute | 設定値 | 説明 |
|---|---|---|
| `lockState` | `Locked` / `Unlocked` | 現在の施錠状態 |
| `lockType` | `DeadBolt` | 錠前種別 |
| `actuatorEnabled` | `true` | アクチュエーター有効 |
| `operatingMode` | `Normal` | 動作モード |

### supportedOperatingModes の注意点

Matter 仕様では `supportedOperatingModes` の各ビットが **「サポートしていない」を意味する反転フラグ** です。
`alwaysSet` フィールドは常に `2047` に設定する必要があります。

```typescript
supportedOperatingModes: {
  normal: false,           // false = Normalモードをサポートする
  vacation: false,
  privacy: false,
  noRemoteLockUnlock: false,
  passage: false,
  alwaysSet: 2047,         // 必須: 常にこの値
}
```

### Matter → EL 操作

`lockState$Changed` イベントを監視します。

```
LockState.Locked   → EPC 0xE0 EDT 0x41 (施錠)
LockState.Unlocked → EPC 0xE0 EDT 0x42 (解錠)
```

---

## 6. 単機能照明 (EL 0x0291 → Matter On/Off Light)

| EPC | EPC 名称 | EDT 値 | Matter Attribute | 方向 |
|---|---|---|---|---|
| `0x80` | 動作状態 | `0x30`=ON / `0x31`=OFF | `onOff.onOff` | 双方向 |

一般照明 (0x0290) の縮退版。`OnOffLightDevice` を使用し、調光・光色は扱いません。

---

## 7. 電動雨戸・シャッター (EL 0x0263 → Matter Window Covering)

| EPC | EPC 名称 | EDT 値 | Matter Attribute | 方向 |
|---|---|---|---|---|
| `0xE0` | 開閉動作設定 | `0x41`=開 / `0x42`=閉 | `targetPositionLiftPercent100ths` | 双方向 |
| `0xEA` | 開閉状態 | `0x41`=全開, `0x43`=開動作中 → 開<br>`0x42`=全閉, `0x44`=閉動作中 → 閉 | `currentPositionLiftPercent100ths` | EL→Matter |

ブラインド (0x0260) と同じ `BlindManager` が処理します。状態判定は `0xEA` (開閉状態) を優先し、
未対応機では `0xE0` の応答から判定します。`type` は `Shutter`、`endProductType` は `RollerShutter` を設定。
`0x45` (途中停止) は現在位置を維持します。

---

## 8. 湿度センサー (EL 0x0012 → Matter Humidity Sensor)

| EPC | EPC 名称 | EDT 形式 | Matter Attribute | 方向 |
|---|---|---|---|---|
| `0xE0` | 相対湿度計測値 | 1バイト, 0-100% | `relativeHumidityMeasurement.measuredValue` | EL→Matter のみ |

Matter 側は 0.01% 単位のため `% × 100` で変換します (55% → `5500`)。100 を超える値は計測不能として `null`。

---

## 9. 人体検知センサー (EL 0x0007 → Matter Occupancy Sensor)

| EPC | EPC 名称 | EDT 値 | Matter Attribute | 方向 |
|---|---|---|---|---|
| `0xB1` | 人体検知状態 | `0x41`=検知 / `0x42`=非検知 | `occupancySensing.occupancy.occupied` | EL→Matter のみ |

`occupancySensorType` は `Pir` を設定します。OccupancySensing クラスターはリビジョン5以降
検知方式 Feature の宣言が必須のため、`OccupancySensingServer.with("PassiveInfrared")` で合成しています。
検知の即時性は EL 機器が INF (状変時通知) を送信するかに依存し、送信しない機器では
ポーリング間隔 (30秒) の遅延が生じます。

---

## 10. 照度センサー (EL 0x00D0 → Matter Light Sensor)

| EPC | EPC 名称 | EDT 形式 | Matter Attribute | 方向 |
|---|---|---|---|---|
| `0xE0` | 照度計測値1 | 2バイト, 0-65533 lux | `illuminanceMeasurement.measuredValue` | EL→Matter のみ |
| `0xE1` | 照度計測値2 | 2バイト, 0-65533 klx | 同上 (`× 1000` で lux 換算) | EL→Matter のみ |

**クラスコードは `0x00D0`** です (`0x000D` ではない点に注意)。
Matter の照度は対数エンコーディングのため以下で変換します。

```
measuredValue = round(10000 × log10(lux) + 1)   // 1-65534
0 lux → 0 (計測不能な暗さ)
0xFFFE (オーバーフロー) / 0xFFFF (計測不能) → null
```

`0xE0` / `0xE1` は機器によってどちらか一方のみ実装されるため (required_c)、両対応しています
(同一パケットに両方あれば `0xE0` を優先)。

---

## 11. CO2センサー (EL 0x001B → Matter Air Quality Sensor)

| EPC | EPC 名称 | EDT 形式 | Matter Attribute | 方向 |
|---|---|---|---|---|
| `0xE0` | CO2濃度計測値 | 2バイト, 0-65533 ppm | `carbonDioxideConcentrationMeasurement.measuredValue` | EL→Matter のみ |
| (同上から導出) | — | — | `airQuality.airQuality` | EL→Matter のみ |

`AirQualitySensorDevice` + `CarbonDioxideConcentrationMeasurementServer(NumericMeasurement)` で構成し、
測定単位は `Ppm`、測定媒体は `Air` (固定値)。AirQuality 区分は CO2 濃度から導出します。

| CO2 濃度 | AirQuality |
|---|---|
| < 800 ppm | `Good` |
| 800-999 ppm | `Fair` |
| 1000-1499 ppm | `Moderate` |
| ≥ 1500 ppm | `Poor` |

---

## 12. 防犯センサー (EL 0x0002 → Matter Contact Sensor)

| EPC | EPC 名称 | EDT 値 | Matter Attribute | 方向 |
|---|---|---|---|---|
| `0xB1` | 侵入発生状態 | `0x41`=検知 / `0x42`=非検知 | `booleanState.stateValue` | EL→Matter のみ |

Matter BooleanState は `true`=閉 (正常) / `false`=開 の意味論のため、
**侵入検知 (`0x41`) を `false` (開)** として通知します。

---

## 13. 換気扇 / 空気清浄器 (EL 0x0133 / 0x0135 → Matter Fan / Air Purifier)

### EPC 対応表

| EPC | EPC 名称 | EDT 値 | Matter Attribute | 方向 |
|---|---|---|---|---|
| `0x80` | 動作状態 | `0x30`=ON / `0x31`=OFF | `fanControl.fanMode` (Off) | 双方向 |
| `0xA0` | 風量設定 | `0x41`=自動 / `0x31`-`0x38`=Lv1-8 | `fanControl.fanMode` / `percentSetting` | 双方向 |

換気扇は `FanDevice`、空気清浄器は `AirPurifierDevice` を使用し、いずれも
`FanControlServer.with("Auto")` (fanModeSequence: `OffLowMedHighAuto`) で構成します。
両クラスコードを共通の `FanDeviceManager` が処理します。

### 風量マッピング

| EL 値 | Matter fanMode | percent |
|---|---|---|
| 電源 OFF | `Off` | 0 |
| `0x41` (自動) | `Auto` | `percentSetting=null` / `percentCurrent=50` (実風量不明のため) |
| `0x31`-`0x33` (Lv1-3) | `Low` | `Lv × 100/8` |
| `0x34`-`0x35` (Lv4-5) | `Medium` | 同上 |
| `0x36`-`0x38` (Lv6-8) | `High` | 同上 |

Matter→EL: `fanMode` の `Low`/`Medium`/`High` は代表レベル Lv2/Lv5/Lv8 に、
`percentSetting` は `ceil(% × 8/100)` で 8 段階に量子化します。`percentSetting=0` は電源 OFF。

---

## 14. 床暖房 (EL 0x027B → Matter Thermostat, Heating 専用)

### EPC 対応表

| EPC | EPC 名称 | EDT 値 | Matter Attribute | 方向 |
|---|---|---|---|---|
| `0x80` | 動作状態 | `0x30`=ON / `0x31`=OFF | `systemMode` (Heat/Off) | 双方向 |
| `0xE0` | 温度設定1 | `0x00`-`0x32` (0-50℃) / `0x41`=自動 | `occupiedHeatingSetpoint` | 双方向 |
| `0xE1` | 温度設定2 | `0x31`-`0x3F` (レベル1-15) / `0x41`=自動 | 同上 (近似変換) | 双方向 |
| `0xE2` | 室内温度計測値 | 符号付き1バイト (℃) | `localTemperature` | EL→Matter |

### Thermostat 構成

`ThermostatServer.with("Heating")` のみで構成します
(`controlSequenceOfOperation: HeatingOnly`、デッドバンド処理は不要)。
セットポイント範囲は 10-40℃ (`absMin/absMaxHeatSetpointLimit` を明示設定)。

### ℃型とレベル型の使い分け

EL 仕様では `0xE0` (℃型) と `0xE1` (レベル型) のどちらか一方の実装で可 (required_c) のため、
両対応しています。

- `0xE0` の有効応答 (0-50) を受信した機器 → ℃型で読み書き
- `0xE0` がなく `0xE1` のみ応答する機器 → レベル型。`temp = 10 + (level-1) × 2` (Lv1-15 → 10-38℃)
  の線形近似で相互変換 (実際の温度対応は機器依存のため近似値)
- `0x41` (自動) 受信時は現在のセットポイントを維持

---

## 温度変換ユーティリティ

| 関数名 | 変換内容 |
|---|---|
| `parseTemperature(hex)` | EL 1バイト符号付き hex → ℃ (エアコン用) |
| `parseTempSensor2Byte(hex)` | EL 2バイト符号付き hex (0.1℃単位) → ℃ (温度センサー用) |
| `celsiusToMatter(c)` | ℃ → Matter 温度値 (`Math.round(c * 100)`) |
| `matterToCelsius(m)` | Matter 温度値 → ℃ (`m / 100`) |
| `celsiusToElHex(c)` | ℃ → EL 1バイト符号付き hex (エアコン用) |
| `parseUint16Measurement(hex)` | EL 2バイト符号なし hex → 数値 (0xFFFE/0xFFFF → null) |
| `parseHumidityPercent(hex)` | EL 1バイト hex → 湿度% (>100 → null) |
| `luxToMatter(lux)` | lux → Matter 照度対数値 |
| `co2ToAirQuality(ppm)` | CO2 ppm → AirQuality 区分 |
| `elAirFlowToPercent(v)` / `percentToElAirFlow(p)` | EL 風量 Lv1-8 ↔ パーセント |
| `elAirFlowToFanMode(v)` | EL 風量 → Matter FanMode |
| `elColorToMireds(v)` / `miredsToElColor(m)` | EL 光色 4値 ↔ mireds |
| `floorHeaterLevelToTemp(l)` / `floorHeaterTempToLevel(t)` | 床暖房レベル 1-15 ↔ ℃ (線形近似) |
