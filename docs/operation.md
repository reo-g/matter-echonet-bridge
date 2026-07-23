# 起動・設定・トラブルシュート

## 起動コマンド

```bash
# TypeScript をコンパイルしてから起動 (本番用)
npm run build
npm start

# quiet モード (Matter 内部ログを抑制)
npm run start:quiet

# 開発用 (tsx で直接実行、コンパイル不要)
npm run dev
npm run dev:quiet
```

---

## コマンドラインオプション

| オプション | 短縮形 | 説明 |
|---|---|---|
| `--quiet` | `-q` | Matter フレームワークの INFO/DEBUG ログを抑制し、制御・発見ログのみ表示 |
| `--interface <IP>` | `-I <IP>` | マルチキャスト参加インターフェースの IP を明示指定 |
| `--allow-self` | — | 自ホスト (127.0.0.1 / 自 IP) 発の EL パケットも処理する |
| `--el-port <port>` | — | EL パケットの送信先ポートを変更 (受信は 3610 のまま)。同一ホストでのエミュレータ連携用 ([docs/testing.md](testing.md)) |
| `--passcode <n>` / `--discriminator <n>` | — | コミッショニング情報を固定 (matter.js 標準。環境変数 `MATTER_PASSCODE` / `MATTER_DISCRIMINATOR` でも可) |

### 使用例

```bash
# quiet モードで起動
npm start -- --quiet

# インターフェースを明示指定 (IGMP snooping 対策)
npm start -- --interface 192.168.1.100

# 両方指定
npm start -- --quiet --interface 192.168.1.100

# ブリッジと同一マシンでエミュレータ (MoekadenRoom / elemu) を動かす場合
npm start -- --allow-self
```

> `--allow-self` について: echonet-lite ライブラリはデフォルトで自ホスト由来の受信を無視します
> (`ignoreMe: true`)。ブリッジと同じマシンでエミュレータを起動するとパケットがすべて破棄されて
> デバイスが発見されないため、その場合はこのフラグを指定してください。

---

## ログレベルと出力

### 通常モード (デフォルト)

matter.js の全ログ (DEBUG〜FATAL) を出力します。
開発中や問題調査時に使用します。

```
2026-01-01 12:00:00.000 NOTICE EchonetBridge      Echonet Lite client initialized (UDP 3610)
2026-01-01 12:00:01.000 INFO   ExchangeManager     Session established ...
...
```

### Quiet モード (`--quiet`)

`Logger.level = 2` (NOTICE 以上) に設定されます。

```
2026-01-01 12:00:00.000 NOTICE EchonetBridge Echonet Lite client initialized (UDP 3610)
2026-01-01 12:00:05.000 NOTICE EchonetBridge Discovered aircon: 192.168.1.10 (013001)
2026-01-01 12:00:05.100 NOTICE EchonetBridge [EL→] 192.168.1.10 Power: ON
2026-01-01 12:00:10.000 NOTICE EchonetBridge [→EL] SystemMode changed to 3
```

### ログプレフィックスの意味

| プレフィックス | 説明 |
|---|---|
| `[EL→]` | ECHONET Lite デバイスからの状態変化を Matter に反映 |
| `[→EL]` | Matter コントローラーからの操作を ECHONET Lite に送信 |

---

## 起動シーケンス

```
1. EchonetClient 初期化
   - UDP ソケット作成 (ポート 3610)
   - マルチキャストグループ参加 (224.0.23.0)

2. Matter ServerNode 作成
   - ストレージ読み込み (~/.matter/matter-echonet-bridge/)
   - Fabric / セッション情報復元

3. Aggregator Endpoint 追加

4. EL デバイス探索開始
   - 即時 1回
   - 3, 6, 10, 20 秒後にリトライ (UDP パケットロスト対策)
   - 以降 60 秒ごとに定期探索

5. Matter サーバー起動 (ポート 5540)
   - コミッショニング済みの場合: セッション再確立待ち
   - 未コミッショニングの場合: QR コード表示

6. 定期ポーリング開始 (30秒ごと)
   - 全デバイスのプロパティ再取得
   - 到達性チェック
```

---

## デバイス発見の仕組み

### 発見フロー

```
EL.search() → EL_Multi (224.0.23.0) にブロードキャスト
    ↓
各 EL デバイスが INF で応答
    ↓
EchonetClient のコールバックで受信
    ↓
classCode で Manager にディスパッチ
    ↓
新規デバイスなら:
  1. 内部 State を初期化
  2. 全プロパティを取得 (200ms 間隔で順次 GET)
  3. 5 秒後にリトライ取得
  4. Matter Endpoint を Aggregator に追加
```

### 発見されるパケット種別

| ESV | 説明 |
|---|---|
| `0x73` (INF) | デバイスからの自発的通知 |
| `0x74` (INFC) | デバイスからの通知 (応答要求付き) |
| `0x72` (GET_RES) | GET に対する応答 |
| `0x71` (SET_RES) | SetC に対する応答 |

---

## 定期ポーリング

30 秒ごとに全デバイスのプロパティを取得します。

| デバイス | ポーリング対象 EPC |
|---|---|
| エアコン | `0x80`, `0xB0`, `0xB3`, `0xBB` |
| 照明 | `0x80` |
| ブラインド | `0xE0` |
| 温度センサー | `0xE0` |
| 電気錠 | `0xE0` |

ポーリング応答は Matter→EL 操作中 (Suppress タイマー有効時) は無視されます。

---

## データの永続化

### matter.js ストレージ

`~/.matter/matter-echonet-bridge/` に以下が保存されます。

| ファイル | 内容 |
|---|---|
| `fabrics.fabrics` | Fabric 情報 (コントローラー証明書) |
| `sessions.resumptionRecords` | CASE セッション再開情報 |
| `root.commissioning.*` | パスコード / ディスクリミネーター |
| `root.parts.bridge.parts.*` | 各デバイスの Attribute 値 |
| `root.operationalCredentials.*` | 運用証明書 |

### EL デバイス情報の永続化

EL デバイスの IP・EOJ・状態はメモリ上のみで管理されます。
再起動のたびに EL ネットワークからデバイスを再発見します。

---

## シャットダウン

`Ctrl+C` または `SIGTERM` で graceful shutdown します。

```
1 回目の Ctrl+C:
  "Shutting down gracefully (press Ctrl+C again to force)..."
  → server.close() を呼び出し Matter セッションを正常終了
  → コントローラーに終了を通知

2 回目の Ctrl+C:
  "Force exit."
  → 即時終了
```

> **正常終了の重要性**: `server.close()` を呼ばずにプロセスを強制終了すると、コントローラー側のセッションが残り、再起動後に `Ignoring message for unknown session` 警告が多発します。

---

## IGMP snooping 対策

IGMP snooping が有効なスイッチ環境では、マルチキャストが届かない場合があります。

`echonet-lite` ライブラリは内部で `addMembership('224.0.23.0')` を呼び出しており、IGMP Join パケットは送出されています。
それでも受信できない場合は、インターフェースを明示指定してください。

```bash
npm start -- --interface 192.168.1.100
```

`192.168.1.100` は EL デバイスと同じネットワークセグメントのローカル IP アドレスに置き換えてください。

---

## トラブルシュート

### デバイスが発見されない

**症状**: 起動後 30 秒以上待っても `Discovered xxx` ログが出ない

**確認事項**:
1. MoekadenRoom または実 EL デバイスが起動しているか
2. ブリッジと EL デバイスが同一 LAN セグメントにいるか
3. ファイアウォールが UDP 3610 をブロックしていないか

```bash
# EL マルチキャストが届いているか確認
sudo tcpdump -i en0 -n udp port 3610
```

4. IGMP snooping 環境では `--interface` オプションを試す

---

### デバイスが「応答なし」になる

**症状**: HomeKit 等で「応答なし」と表示される

**確認事項**:
1. EL デバイスへの到達性 (`ping <EL デバイスの IP>`)
2. ブリッジのログで `Device unreachable:` が出ているか
3. 120 秒以内にポーリング応答が返っているか

---

### 再起動後に「アップデート中」が続く

**症状**: ブリッジ再起動後、HomeKit が「アップデート中」のまま 2〜3 分以上続く

**原因**: コントローラーが古いセッション ID で再接続を試みるため。

**対処**:
- 通常は 30〜60 秒で自動復帰します
- Ctrl+C で正常終了していれば復帰が早くなります
- 2 分以上続く場合は HomeKit でデバイスを削除して再コミッショニング

---

### コミッショニング QR コードが出ない

**症状**: 起動しても QR コードが表示されない

**原因**: すでにコミッショニング済み (ストレージに Fabric 情報がある)

**対処**:
```bash
rm -rf ~/.matter/matter-echonet-bridge
npm start
```

---

### エアコンのモード変更後に温度がずれる

**症状**: HomeKit でエアコンのモードを変更すると、設定温度の表示がおかしくなる

**原因**: Thermostat クラスターは冷房/暖房を別々のセットポイントで管理するため、モード切替時に再計算が必要。

**実装**: `systemMode$Changed` ハンドラー内でモード変更後にセットポイントを現在の EL 設定温度に基づいて再計算しています。手動で修正する必要はありません。

---

### ブラインドが「応答なし」になる

**症状**: WindowCovering デバイスが HomeKit で「応答なし」

**原因**: `WindowCoveringServer.with("Lift")` のみでは HomeKit が操作できない。

**実装**: `"PositionAwareLift"` Feature を追加し、`currentPositionLiftPercent100ths` と `targetPositionLiftPercent100ths` を提供することで解決済みです。

---

## ログ出力サンプル

正常起動時の出力例:

```
NOTICE EchonetBridge  Echonet Lite client initialized (UDP 3610)
NOTICE EchonetBridge  Starting Echonet Lite device discovery...
NOTICE EchonetBridge  Starting Matter server...
NOTICE EchonetBridge  ============================================================
NOTICE EchonetBridge  Matter Bridge is running on port 5540
NOTICE EchonetBridge  Supported: Aircon, Light, Blind, TempSensor, Lock
NOTICE EchonetBridge  Pair this bridge with your Matter controller.
NOTICE EchonetBridge  ============================================================
NOTICE EchonetBridge  Discovered aircon: 192.168.1.10 (013001)
NOTICE EchonetBridge  [EL→] 192.168.1.10 Power: ON
NOTICE EchonetBridge  [EL→] 192.168.1.10 Mode: 0x42
NOTICE EchonetBridge  [EL→] 192.168.1.10 SetTemp: 26℃
NOTICE EchonetBridge  Matter Thermostat endpoint created for 192.168.1.10
NOTICE EchonetBridge  Discovered light: 192.168.1.11 (029001)
NOTICE EchonetBridge  [EL→] 192.168.1.11 Light: OFF
NOTICE EchonetBridge  Matter OnOffLight endpoint created for 192.168.1.11
```

Matter 操作時の出力例:

```
NOTICE EchonetBridge  [→EL] SystemMode changed to 4
NOTICE EchonetBridge  [→EL] HeatingSetpoint → 22℃
NOTICE EchonetBridge  [→EL] Light onOff → true
NOTICE EchonetBridge  [→EL] Blind → CLOSE
NOTICE EchonetBridge  [→EL] Lock → LOCKED
```
