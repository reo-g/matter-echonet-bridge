# ECHONET Lite ↔ Matter Bridge

ECHONET Lite (日本の HEMS 標準) 機器を Matter 標準に変換する **双方向ブリッジ**。
Apple Home / Google Home / Amazon Alexa から既存の EL 機器を操作できるようになります。

> ⚠️ Personal experimental project. Tested with [MoekadenRoom](https://github.com/SonyCSL/MoekadenRoom) emulator. Not production-certified.

[English](#english) | [日本語](#日本語)

---

## English

### What is this?

A Node.js bridge that exposes existing **ECHONET Lite** devices (a smart-home protocol widely used in Japan) as **Matter** accessories. Pair the bridge once with any Matter controller (Apple Home, Google Home, Alexa) and all your discovered EL devices appear automatically.

### Why does this exist?

ECHONET Lite is widely used for home appliances in Japan, but Matter — the global cross-vendor standard — does not natively speak it. This bridge translates between the two so existing ECHONET Lite devices can be controlled from Matter ecosystems.

This is a single-file TypeScript implementation (~3,000 lines) on top of [matter.js](https://github.com/project-chip/matter.js).

### Supported devices

| EL Class | Device | Matter Device Type | Direction |
|---|---|---|---|
| `0x0130` | Home Air Conditioner | Thermostat (`0x0301`) | Bidirectional |
| `0x0290` | General Lighting | Dimmable Light (`0x0101`) / Color Temperature Light (`0x010C`)* | Bidirectional |
| `0x0291` | Mono Functional Lighting | On/Off Light (`0x0100`) | Bidirectional |
| `0x0260` | Electrically Operated Blind/Shade | Window Covering (`0x0202`) | Bidirectional |
| `0x0263` | Electrically Operated Rain Sliding Door/Shutter | Window Covering (`0x0202`) | Bidirectional |
| `0x0011` | Temperature Sensor | Temperature Sensor (`0x0302`) | Read-only |
| `0x0012` | Humidity Sensor | Humidity Sensor (`0x0307`) | Read-only |
| `0x0007` | Human Detection Sensor | Occupancy Sensor (`0x0107`) | Read-only |
| `0x00D0` | Illuminance Sensor | Light Sensor (`0x0106`) | Read-only |
| `0x001B` | CO2 Sensor | Air Quality Sensor (`0x002C`) | Read-only |
| `0x0002` | Crime Prevention Sensor | Contact Sensor (`0x0015`) | Read-only |
| `0x026F` | Electric Door Lock | Door Lock (`0x000A`) | Bidirectional |
| `0x0133` | Ventilation Fan | Fan (`0x002B`) | Bidirectional |
| `0x0135` | Air Cleaner | Air Purifier (`0x002D`) | Bidirectional |
| `0x027B` | Floor Heater | Thermostat (`0x0301`, heating only) | Bidirectional |

\* Lights are exposed as Color Temperature Light when the device supports light-color EPC `0xB1`
(auto-detected at discovery), otherwise as Dimmable Light.

Smart meters (`0x0288`) are intentionally out of scope.
See [docs/device-roadmap.md](docs/device-roadmap.md) for planned device types and the full EL ↔ Matter mapping study.

### Quick start

```bash
git clone https://github.com/reo-g/matter-echonet-bridge
cd matter-echonet-bridge
npm install
npm run build
npm start
```

No hardware? Run the E2E test suite (`npm test`) — it spins up an ECHONET Lite
device emulator and a matter.js controller on localhost and verifies the whole
path. See [docs/testing.md](docs/testing.md).

A QR code and manual pairing code appear at startup. Scan it with your Matter controller. After commissioning, EL devices found on your LAN auto-register as bridged child devices.

For IGMP-snooped switches, pin the multicast interface explicitly:

```bash
npm start -- --interface 192.168.1.100
```

### Architecture (one-paragraph version)

The bridge runs the [echonet-lite](https://www.npmjs.com/package/echonet-lite) UDP stack on port 3610, dispatches incoming packets by class code to per-device managers (Aircon / Light / Blind / Lock / Fan / FloorHeater / read-only sensors), and mirrors state into Matter Endpoints attached to a single `Aggregator`. Matter→EL writes are deduped against EL→Matter polling responses via a per-device suppress timer (default 2s) to prevent feedback loops. Reachability is tracked with a 120-second heartbeat and pushed to `BridgedDeviceBasicInformation.reachable`.

See [docs/overview.md](docs/overview.md) for the full architecture, [docs/devices.md](docs/devices.md) for EPC ↔ Attribute mappings, [docs/commissioning.md](docs/commissioning.md) for pairing, and [docs/operation.md](docs/operation.md) for runtime/operations.

### Known limitations

- **Apple Home does not support Matter Room Air Conditioner (`0x0072`) reliably**, so the AC is exposed as a `Thermostat` (`0x0301`) (per [project-chip/connectedhomeip#32867](https://github.com/project-chip/connectedhomeip/issues/32867)). EL `Dry`/`Fan` modes therefore degrade to `Cool`/`FanOnly` round-trip.
- Verified against **emulators** (the built-in E2E suite and MoekadenRoom), not physical appliances yet. Real EL appliance compatibility may vary by EPC implementation completeness.
- Vendor ID is the CSA test value `0xFFF1`. Do **not** use this build for shipped products.

### Tech stack

| Layer | Library |
|---|---|
| Matter protocol | [`@matter/main`](https://github.com/project-chip/matter.js) v0.16+ |
| Matter Node runtime | `@matter/nodejs` v0.16+ |
| ECHONET Lite | [`echonet-lite`](https://www.npmjs.com/package/echonet-lite) v2.16+ |
| Language / runtime | TypeScript 5.8 / Node.js ≥ 20.19 |

### Acknowledgments

This work was informed by:

- V. C. Pham, T. Nguyen-Mau, M. Sioutis, Y. Tan, "[Matter and ECHONET Lite: Similarities, differences, and a bridge solution for interoperability](https://doi.org/10.1016/j.iot.2024.101265)", *Internet of Things*, Vol. 27, 2024.

### License

[Apache License 2.0](LICENSE).

---

## 日本語

### 概要

ECHONET Lite (日本で広く使われている HEMS 標準) 機器を Matter 標準に変換する Node.js ブリッジ実装です。Apple Home / Google Home / Amazon Alexa など Matter コントローラーから、既存の EL 対応エアコン・照明・ブラインド・温度センサー・電気錠を操作できます。

### 対応機器

| EL クラスコード | EL デバイス種別 | Matter デバイスタイプ | 通信方向 |
|---|---|---|---|
| `0x0130` | 家庭用エアコン | Thermostat (`0x0301`) | 双方向 |
| `0x0290` | 一般照明 | Dimmable Light (`0x0101`) / Color Temperature Light (`0x010C`)※ | 双方向 |
| `0x0291` | 単機能照明 | On/Off Light (`0x0100`) | 双方向 |
| `0x0260` | 電動ブラインド | Window Covering (`0x0202`) | 双方向 |
| `0x0263` | 電動雨戸・シャッター | Window Covering (`0x0202`) | 双方向 |
| `0x0011` | 温度センサー | Temperature Sensor (`0x0302`) | EL→Matter のみ |
| `0x0012` | 湿度センサー | Humidity Sensor (`0x0307`) | EL→Matter のみ |
| `0x0007` | 人体検知センサー | Occupancy Sensor (`0x0107`) | EL→Matter のみ |
| `0x00D0` | 照度センサー | Light Sensor (`0x0106`) | EL→Matter のみ |
| `0x001B` | CO2センサー | Air Quality Sensor (`0x002C`) | EL→Matter のみ |
| `0x0002` | 防犯センサー | Contact Sensor (`0x0015`) | EL→Matter のみ |
| `0x026F` | 電気錠 | Door Lock (`0x000A`) | 双方向 |
| `0x0133` | 換気扇 | Fan (`0x002B`) | 双方向 |
| `0x0135` | 空気清浄器 | Air Purifier (`0x002D`) | 双方向 |
| `0x027B` | 床暖房 | Thermostat (`0x0301`, 暖房専用) | 双方向 |

※ 一般照明は発見時に光色設定 (EPC `0xB1`) 対応を自動判定し、対応機は Color Temperature Light として公開します。

### クイックスタート

```bash
npm install
npm run build
npm start             # 通常モード
npm run start:quiet   # Matter内部ログを抑制
npm test              # E2E テスト (エミュレータ + matter.js コントローラ、実機不要)
```

起動時に表示される QR コードを Matter コントローラーでスキャンしてコミッショニングします。

### ドキュメント

| ドキュメント | 内容 |
|---|---|
| [docs/overview.md](docs/overview.md) | アーキテクチャ・クラス設計・データフロー |
| [docs/devices.md](docs/devices.md) | デバイス別 EPC ↔ Matter Attribute 対応表 |
| [docs/commissioning.md](docs/commissioning.md) | コミッショニング手順 |
| [docs/operation.md](docs/operation.md) | 起動・運用・トラブルシュート |
| [docs/testing.md](docs/testing.md) | E2E テスト環境 (エミュレータ + matter.js コントローラ)・elemu 連携 |
| [docs/device-roadmap.md](docs/device-roadmap.md) | 対応デバイス拡張候補と EL ↔ Matter 機能マッピング |

### 既知の制約

- **Apple Home は Matter Room Air Conditioner (`0x0072`) を実質的にサポートしていない**ため、エアコンは `Thermostat` (`0x0301`) として公開しています ([project-chip/connectedhomeip#32867](https://github.com/project-chip/connectedhomeip/issues/32867))。EL の `除湿`/`送風` モードは `Cool`/`FanOnly` に縮退します。
- 動作確認は**エミュレータ** (同梱の E2E テストスイート・MoekadenRoom) ベースです。実機との互換性は EPC 実装の完全性に依存します。
- Vendor ID は CSA テスト用予約値 `0xFFF1` を使用しています。商用製品にこのビルドを流用しないでください。

### 参考文献

実装にあたり以下を参考にしています:

- V. C. Pham, T. Nguyen-Mau, M. Sioutis, Y. Tan「[Matter and ECHONET Lite: Similarities, differences, and a bridge solution for interoperability](https://doi.org/10.1016/j.iot.2024.101265)」*Internet of Things* Vol.27 (2024)

### ライセンス

[Apache License 2.0](LICENSE)
