# Echonet-Matter Bridge ドキュメント

ECHONET Lite デバイスを Matter 標準に変換するブリッジの実装ドキュメントです。

## ドキュメント一覧

| ドキュメント | 内容 |
|---|---|
| [overview.md](overview.md) | アーキテクチャ概要・クラス設計・データフロー |
| [devices.md](devices.md) | デバイス別 EPC / Matter Attribute 対応表 |
| [commissioning.md](commissioning.md) | コミッショニング手順・再起動・リセット |
| [operation.md](operation.md) | 起動コマンド・設定オプション・トラブルシュート |
| [testing.md](testing.md) | E2E テスト環境・elemu 連携・同一ホスト二重ポート方式 |
| [device-roadmap.md](device-roadmap.md) | 対応デバイス拡張候補と EL ↔ Matter 機能マッピング |

## 対応デバイス早見表

| EL クラス | デバイス | Matter タイプ | 双方向 |
|---|---|---|---|
| `0x0130` | エアコン | Thermostat | ✓ |
| `0x0290` | 一般照明 | Dimmable / Color Temperature Light | ✓ |
| `0x0291` | 単機能照明 | On/Off Light | ✓ |
| `0x0260` | 電動ブラインド | Window Covering | ✓ |
| `0x0263` | 電動雨戸・シャッター | Window Covering | ✓ |
| `0x0011` | 温度センサー | Temperature Sensor | 読み取り専用 |
| `0x0012` | 湿度センサー | Humidity Sensor | 読み取り専用 |
| `0x0007` | 人体検知センサー | Occupancy Sensor | 読み取り専用 |
| `0x00D0` | 照度センサー | Light Sensor | 読み取り専用 |
| `0x001B` | CO2センサー | Air Quality Sensor | 読み取り専用 |
| `0x0002` | 防犯センサー | Contact Sensor | 読み取り専用 |
| `0x026F` | 電気錠 | Door Lock | ✓ |
| `0x0133` | 換気扇 | Fan | ✓ |
| `0x0135` | 空気清浄器 | Air Purifier | ✓ |
| `0x027B` | 床暖房 | Thermostat (暖房専用) | ✓ |

## クイックスタート

```bash
# インストール
npm install

# ビルド & 起動
npm run build
npm start

# 静かなログで起動
npm run start:quiet
```

起動後に表示される QR コードを Matter コントローラーでスキャンしてコミッショニングします。
詳細は [commissioning.md](commissioning.md) を参照してください。
