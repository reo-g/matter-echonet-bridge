# コミッショニング手順

Matter デバイスを Matter コントローラー (Apple Home / Google Home / Amazon Alexa 等) に登録する手順です。

---

## 初回コミッショニング

### 1. ブリッジを起動する

```bash
npm run build
npm start
```

起動直後のログに QR コードと手動入力コードが表示されます。

```
============================================================
Matter Bridge is running on port 5540
Supported: Aircon, Light, Blind, TempSensor, Lock
Pair this bridge with your Matter controller.
After restart, controllers may take 30-60s to re-establish sessions.
============================================================

QR コード: MT:...
手動ペアリングコード: XXXX-XXX-XXXX
```

### 2. コントローラーのアプリで追加

**Apple Home の場合:**
1. ホーム画面右上の「+」→「アクセサリを追加」
2. カメラで QR コードをスキャン、または「コードを手動で入力」
3. 「このアクセサリは認定されていません」→ 「追加を続ける」
4. ブリッジ名・部屋を設定 → 追加完了

**Google Home の場合:**
1. 「デバイスを追加」→「Googleと連携」→ Matter
2. QR コードをスキャン

**Amazon Alexa の場合:**
1. 「デバイスを追加」→「その他」→「Matter」
2. QR コードをスキャン

### 3. デバイスが表示されることを確認

コミッショニング後、EL デバイスが発見されれば自動的に子デバイスとして追加されます。

```
Discovered aircon: 192.168.x.x (013001)
Matter Thermostat endpoint created for 192.168.x.x

Discovered light: 192.168.x.x (029001)
Matter OnOffLight endpoint created for 192.168.x.x
...
```

---

## 再起動後の動作

ブリッジを再起動しても **再コミッショニングは不要** です。
認証情報は `~/.matter/matter-echonet-bridge/` に永続化されています。

### セッション再接続について

再起動直後に以下のような警告が連続して出ることがあります。

```
WARN ExchangeManager Ignoring message for unknown session 50c5
```

これは Matter コントローラーが前回のセッション ID で通信しようとしているためで、**正常な動作** です。
コントローラーは 30〜60 秒以内に新しいセッションを自動確立します。

---

## コミッショニングのリセット

コミッショニング情報をすべて削除して再ペアリングする場合:

```bash
# ストレージ削除
rm -rf ~/.matter/matter-echonet-bridge

# 再起動 (新しい QR コードが表示される)
npm start
```

または package.json のスクリプトを使用:

```bash
npm run reset
```

> **注意**: ストレージ削除後はコントローラー側でも一度デバイスを削除してから再追加が必要です。

---

## 複数コントローラーへの同時登録

Matter はマルチ Fabric をサポートしており、複数のコントローラーに同時登録できます。

- Apple Home に登録したまま Google Home にも登録可能
- 現在の実装では最大 Fabric 数は matter.js のデフォルト値に従います

---

## ベンダー情報

コミッショニング時にコントローラーに表示されるブリッジ情報:

| 項目 | 値 |
|---|---|
| メーカー名 | `reomaru` |
| 製品名 | `Echonet-Matter Bridge` |
| ベンダー ID | `0xFFF1` (CSA テスト用予約値) |
| 製品 ID | `0x8000` |
| シリアル番号 | `ECHONET-BRIDGE-001` |
| ソフトウェアバージョン | `1.0.0` |
| ハードウェアバージョン | `1.0.0` |

---

## Matter ポート

デフォルトポートは **5540** です。

```typescript
const MATTER_PORT = 5540;  // Alexa 互換のため 5540 推奨
```

ファイアウォールがある場合は UDP 5540 番ポートの受信を許可してください。

---

## QR コードが表示されない場合

すでにコミッショニング済みの場合は QR コードは表示されません。
未コミッショニング状態に戻すには `~/.matter/matter-echonet-bridge/` を削除してください。

---

## 接続トポロジー

```
コントローラー
   │
   │ Matter (Wi-Fi / Thread / BLE)
   │ ポート 5540 (UDP)
   │
   ▼
Echonet-Matter Bridge (このプログラム)
   │
   │ ECHONET Lite (Wi-Fi / 有線 LAN)
   │ UDP マルチキャスト 224.0.23.0:3610
   │
   ▼
EL デバイス群 (エアコン, 照明, ...)
```

ブリッジは EL デバイスと同じ LAN セグメントに接続されている必要があります。
コントローラーはブリッジと同じ LAN または Thread/BLE 経由で接続します。
