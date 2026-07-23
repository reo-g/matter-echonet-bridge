/**
 * Echonet Lite ↔ Matter ブリッジ
 *
 * ECHONET Lite デバイスを Matter に統合する双方向ブリッジ
 * - エアコン (0x0130) → Matter Thermostat
 * - 照明 (0x0290) → Matter DimmableLight / ColorTemperatureLight (光色 0xB1 対応機)
 * - 単機能照明 (0x0291) → Matter OnOffLight
 * - ブラインド (0x0260) / 雨戸・シャッター (0x0263) → Matter WindowCovering
 * - 温度センサー (0x0011) → Matter TemperatureSensor
 * - 湿度センサー (0x0012) → Matter HumiditySensor
 * - 人体検知センサー (0x0007) → Matter OccupancySensor
 * - 照度センサー (0x00D0) → Matter LightSensor
 * - CO2センサー (0x001B) → Matter AirQualitySensor
 * - 防犯センサー (0x0002) → Matter ContactSensor
 * - 電気錠 (0x026F) → Matter DoorLock
 * - 換気扇 (0x0133) → Matter Fan
 * - 空気清浄器 (0x0135) → Matter AirPurifier
 * - 床暖房 (0x027B) → Matter Thermostat (Heating専用)
 *
 * 動作要件:
 *   Node.js 20.19+ / 22.13+
 *   npm install @matter/main @matter/nodejs echonet-lite
 *
 * テスト環境:
 *   MoekadenRoom (エアコン/照明/ブラインド/温度センサー/電気錠)
 *   KAIT-HEMS elemu (全クラス対応の ECHONET Lite エミュレータ)
 */

// メインエントリ (ServerNode, Endpoint, Logger 等)
import { Endpoint, Environment, Logger, ServerNode, VendorId } from "@matter/main";

// エンドポイント定義 (ケバブケース)
import { AggregatorEndpoint } from "@matter/main/endpoints/aggregator";
// デバイスタイプ定義
import { ThermostatDevice } from "@matter/main/devices/thermostat";
import { DimmableLightDevice } from "@matter/main/devices/dimmable-light";
import { ColorTemperatureLightDevice } from "@matter/main/devices/color-temperature-light";
import { OnOffLightDevice } from "@matter/main/devices/on-off-light";
import { WindowCoveringDevice } from "@matter/main/devices/window-covering";
import { TemperatureSensorDevice } from "@matter/main/devices/temperature-sensor";
import { HumiditySensorDevice } from "@matter/main/devices/humidity-sensor";
import { OccupancySensorDevice } from "@matter/main/devices/occupancy-sensor";
import { LightSensorDevice } from "@matter/main/devices/light-sensor";
import { ContactSensorDevice } from "@matter/main/devices/contact-sensor";
import { AirQualitySensorDevice } from "@matter/main/devices/air-quality-sensor";
import { DoorLockDevice } from "@matter/main/devices/door-lock";
import { FanDevice } from "@matter/main/devices/fan";
import { AirPurifierDevice } from "@matter/main/devices/air-purifier";

// クラスター定義
import { Thermostat } from "@matter/main/clusters/thermostat";
import { WindowCovering } from "@matter/main/clusters/window-covering";
import { DoorLock } from "@matter/main/clusters/door-lock";
import { FanControl } from "@matter/main/clusters/fan-control";
import { AirQuality } from "@matter/main/clusters/air-quality";
import { ConcentrationMeasurement } from "@matter/main/clusters/concentration-measurement";
import { ColorControl } from "@matter/main/clusters/color-control";
import { OccupancySensing } from "@matter/main/clusters/occupancy-sensing";

// Behavior
import { ThermostatServer } from "@matter/main/behaviors/thermostat";
import { BridgedDeviceBasicInformationServer } from "@matter/main/behaviors/bridged-device-basic-information";
import { WindowCoveringServer } from "@matter/main/behaviors/window-covering";
import { FanControlServer } from "@matter/main/behaviors/fan-control";
import { AirQualityServer } from "@matter/main/behaviors/air-quality";
import { CarbonDioxideConcentrationMeasurementServer } from "@matter/main/behaviors/carbon-dioxide-concentration-measurement";
import { OccupancySensingServer } from "@matter/main/behaviors/occupancy-sensing";

// @ts-ignore echonet-lite has no type declarations
import EL from "echonet-lite";

/**
 * matter.js バージョン互換メモ:
 * - パッケージ名: @matter/main (0.11以降。旧 @matter.js/main は非推奨)
 * - サブパスはケバブケース: devices/thermostat, endpoints/bridged-node 等
 * - 0.16+: Thermostat cluster のデフォルト実装が大幅強化 (Matter 1.4.2準拠)
 */

// ============================================================
// 型定義
// ============================================================
const QUIET_MODE = process.argv.includes("--quiet") || process.argv.includes("-q");
if (QUIET_MODE) {
  Logger.level = 2; // NOTICE — Matter 内部の info/debug を抑制
}

/** --interface オプション: マルチキャスト参加に使うローカルIPを指定 (IGMP snooping対策) */
const ifIdx = process.argv.findIndex(a => a === "--interface" || a === "-I");
const BIND_INTERFACE = ifIdx >= 0 ? process.argv[ifIdx + 1] : "";

/**
 * --allow-self オプション: 自ホスト (127.0.0.1 / 自IP) 発の EL パケットも処理する。
 * ブリッジと同一マシンでエミュレータ (MoekadenRoom / elemu 等) を動かす場合に指定する。
 */
const ALLOW_SELF = process.argv.includes("--allow-self");

/**
 * --el-port オプション: EL パケットの送信先ポートを変更する (既定 3610)。
 * 同一マシンでエミュレータを動かす場合、双方が 3610 を bind すると unicast の配送先が
 * 不定になるため、受信 (3610) と送信先を分離する。エミュレータ側は指定ポートで受信し、
 * 応答は 3610 へ返すこと (test/harness/el-device.ts、および elemu の bind ポートパッチが対応)。
 */
const elPortIdx = process.argv.findIndex(a => a === "--el-port");
const EL_TARGET_PORT = elPortIdx >= 0 ? parseInt(process.argv[elPortIdx + 1] ?? "", 10) || 0 : 0;

const logger = Logger.get("EchonetBridge");

/** Echonet Lite ELDATA 構造 */
interface ElData {
  EHD: string;
  TID: string;
  SEOJ: string;
  DEOJ: string;
  EDATA: string;
  ESV: string;
  OPC: string;
  DETAIL: string;
  DETAILs: Record<string, string>;
}

interface RInfo {
  address: string;
  port: number;
  family: string;
  size: number;
}

/** 管理対象のエアコン情報 */
interface AirconState {
  ip: string;
  eoj: string;             // "013001" etc.
  power: boolean;           // 0x80: ON/OFF
  mode: number;             // 0xB0: 運転モード (EL値)
  targetTemp: number;       // 0xB3: 設定温度 (℃)
  roomTemp: number | null;  // 0xBB: 室温 (℃)
  humidity: number | null;  // 0xBA: 湿度 (%)
  outdoorTemp: number | null; // 0xBE: 外気温 (℃)
  airFlowRate: number;      // 0xA0: 風量
  swingMode: number;        // 0xA3: スイング
  powerSaving: boolean;     // 0x8F: 節電動作状態
  hasError: boolean;        // 0x88: 異常発生状態
  reachable: boolean;
  lastSeen: number;         // timestamp
  matterEndpoint?: Endpoint;
}

/** 照明デバイス状態 */
interface LightState {
  ip: string;
  eoj: string;
  power: boolean;
  brightness: number | null; // 0xB0: 照度レベル (0-100%)
  colorTemp: number | null;  // 0xB1: 光色設定 (EL値 0x41-0x44、未対応機は null)
  reachable: boolean;
  lastSeen: number;
  matterEndpoint?: Endpoint;
  /** 光色対応判定のためエンドポイント作成を遅延するタイマー */
  createTimer?: ReturnType<typeof setTimeout>;
}

/** 単機能照明デバイス状態 */
interface MonoLightState {
  ip: string;
  eoj: string;
  power: boolean;
  reachable: boolean;
  lastSeen: number;
  matterEndpoint?: Endpoint;
}

/** ブラインド/雨戸・シャッターデバイス状態 */
interface BlindState {
  ip: string;
  eoj: string;
  kind: "blind" | "shutter";  // 0x0260=blind, 0x0263=shutter
  isOpen: boolean;
  reachable: boolean;
  lastSeen: number;
  matterEndpoint?: Endpoint;
}

/** 換気扇/空気清浄器デバイス状態 */
interface FanLikeState {
  ip: string;
  eoj: string;
  kind: "fan" | "airPurifier"; // 0x0133=fan, 0x0135=airPurifier
  power: boolean;
  airFlow: number;             // 0xA0: 0x41=自動, 0x31-0x38=Lv1-8
  reachable: boolean;
  lastSeen: number;
  matterEndpoint?: Endpoint;
}

/** 床暖房デバイス状態 */
interface FloorHeaterState {
  ip: string;
  eoj: string;
  power: boolean;
  targetTemp: number;          // 設定温度 (℃)
  usesLevelSetpoint: boolean;  // true: 0xE1 (レベル型) のみ対応の機器
  roomTemp: number | null;     // 0xE2: 室内温度計測値
  reachable: boolean;
  lastSeen: number;
  matterEndpoint?: Endpoint;
}

/** 温度センサーデバイス状態 */
interface TempSensorState {
  ip: string;
  eoj: string;
  temperature: number | null;
  reachable: boolean;
  lastSeen: number;
  matterEndpoint?: Endpoint;
}

/** 電気錠デバイス状態 */
interface LockState {
  ip: string;
  eoj: string;
  locked: boolean;
  reachable: boolean;
  lastSeen: number;
  matterEndpoint?: Endpoint;
}

// ============================================================
// Echonet Lite エアコン EPC 定義
// ============================================================
const EPC = {
  OPERATION_STATUS: "80",   // 動作状態
  ERROR_STATE: "88",        // 異常発生状態 (0x41=異常あり, 0x42=正常)
  POWER_SAVING: "8F",       // 節電動作状態 (0x41=節電中, 0x42=通常)
  OPERATION_MODE: "B0",     // 運転モード
  SET_TEMPERATURE: "B3",    // 設定温度
  ROOM_TEMPERATURE: "BB",   // 室温計測値
  ROOM_HUMIDITY: "BA",      // 室内相対湿度計測値
  OUTDOOR_TEMPERATURE: "BE",// 外気温度計測値
  AIR_FLOW_RATE: "A0",      // 風量設定 (0x41=自動, 0x31-0x38=Lv1-8)
  SWING_MODE: "A3",         // スイング設定
  PROPERTY_MAP: "9F",       // Get プロパティマップ
} as const;

/** Echonet Lite 運転モード値 */
const EL_MODE = {
  AUTO: 0x41,
  COOL: 0x42,
  HEAT: 0x43,
  DEHUMIDIFY: 0x44,
  FAN: 0x45,
} as const;

/** ESV コード */
const ESV = {
  SETI: "60",      // SetI (応答不要)
  SETC: "61",      // SetC (応答要)
  GET: "62",        // Get
  INF_REQ: "63",    // INF要求
  SET_RES: "71",    // Set応答
  GET_RES: "72",    // Get応答
  INF: "73",        // 通知
  INFC: "74",       // 通知(応答要)
  SETC_SNA: "51",   // SetC不可応答
  GET_SNA: "52",    // Get不可応答
} as const;

/** 照明 EPC */
const LIGHT_EPC = {
  OPERATION_STATUS: "80",
  BRIGHTNESS: "B0",         // 照度レベル設定 (0x00-0x64 = 0-100%)
  LIGHT_COLOR: "B1",        // 光色設定 (0x41=電球色, 0x42=白色, 0x43=昼白色, 0x44=昼光色)
} as const;

/** ブラインド/雨戸・シャッター EPC */
const BLIND_EPC = {
  OPEN_CLOSE: "E0",         // 開閉動作設定 (0x41=開, 0x42=閉, 0x43=停止[0x0263のみ])
  OPEN_CLOSE_STATUS: "EA",  // 開閉状態 (0x41=全開, 0x42=全閉, 0x43=開動作中, 0x44=閉動作中, 0x45=途中停止)
} as const;

/** 温度センサー EPC */
const TEMP_EPC = {
  MEASURED_TEMP: "E0",
} as const;

/** 電気錠 EPC */
const LOCK_EPC = {
  LOCK_STATUS: "E0",
} as const;

/** 換気扇/空気清浄器 EPC */
const FAN_EPC = {
  OPERATION_STATUS: "80",
  AIR_FLOW: "A0",           // 風量設定 (0x41=自動, 0x31-0x38=Lv1-8)
} as const;

/** 床暖房 EPC */
const FLOOR_HEATER_EPC = {
  OPERATION_STATUS: "80",
  TEMP_SETTING_1: "E0",     // 温度設定1 (0x00-0x32=0-50℃, 0x41=自動)
  TEMP_SETTING_2: "E1",     // 温度設定2 (0x31-0x3F=レベル1-15, 0x41=自動)
  ROOM_TEMP: "E2",          // 室内温度計測値
} as const;

/** 光色設定 (EL 0xB1) ↔ 色温度 mireds の対応表 (近傍値に量子化) */
const LIGHT_COLOR_TO_MIREDS: ReadonlyArray<{ el: number; mireds: number }> = [
  { el: 0x41, mireds: 370 }, // 電球色 ≈ 2700K
  { el: 0x42, mireds: 250 }, // 白色 ≈ 4000K
  { el: 0x43, mireds: 200 }, // 昼白色 ≈ 5000K
  { el: 0x44, mireds: 154 }, // 昼光色 ≈ 6500K
];

// ============================================================
// モードマッピング
// ============================================================

/** Echonet Lite Mode → Matter SystemMode */
function elModeToMatterMode(elMode: number, power: boolean): Thermostat.SystemMode {
  if (!power) return Thermostat.SystemMode.Off;
  switch (elMode) {
    case EL_MODE.AUTO:       return Thermostat.SystemMode.Auto;
    case EL_MODE.COOL:       return Thermostat.SystemMode.Cool;
    case EL_MODE.HEAT:       return Thermostat.SystemMode.Heat;
    case EL_MODE.DEHUMIDIFY: return Thermostat.SystemMode.Cool; // Matterに除湿なし→冷房扱い
    case EL_MODE.FAN:        return Thermostat.SystemMode.FanOnly;
    default:                 return Thermostat.SystemMode.Auto;
  }
}

/** Matter SystemMode → Echonet Lite Mode (+ power state) */
function matterModeToEl(mode: Thermostat.SystemMode): { power: boolean; elMode: number | null } {
  switch (mode) {
    case Thermostat.SystemMode.Off:
      return { power: false, elMode: null };
    case Thermostat.SystemMode.Auto:
      return { power: true, elMode: EL_MODE.AUTO };
    case Thermostat.SystemMode.Cool:
      return { power: true, elMode: EL_MODE.COOL };
    case Thermostat.SystemMode.Heat:
      return { power: true, elMode: EL_MODE.HEAT };
    case Thermostat.SystemMode.FanOnly:
      return { power: true, elMode: EL_MODE.FAN };
    default:
      return { power: true, elMode: EL_MODE.AUTO };
  }
}

// ============================================================
// 温度変換ユーティリティ
// ============================================================

/** Echonet Lite EDT (符号付き1バイト hex) → ℃ or null (計測不能) */
function parseTemperature(hex: string): number | null {
  const val = parseInt(hex, 16);
  if (isNaN(val)) return null;
  // ECHONET Lite 特殊値: 0x7E/0x7F=計測範囲超, 0x80=計測不能 (アンダーフロー)
  if (val === 0x7e || val === 0x7f || val === 0x80) return null;
  return val > 127 ? val - 256 : val;
}

/** 温度センサー (0x0011) EPC 0xE0: 2バイト符号付き (0.1℃単位) → ℃ or null */
function parseTempSensor2Byte(hex: string): number | null {
  if (hex.length < 4) return null;
  const raw = parseInt(hex, 16);
  if (isNaN(raw) || raw === 0x7ffe || raw === 0x7fff) return null;
  const signed = raw > 32767 ? raw - 65536 : raw;
  return signed / 10;
}

/** ℃ → Matter温度値 (0.01℃ 単位の整数) */
function celsiusToMatter(c: number): number {
  return Math.round(c * 100);
}

/** Matter温度値 → ℃ */
function matterToCelsius(m: number): number {
  return m / 100;
}

/** EL 照度レベル (0-100) → Matter LevelControl currentLevel (1-254) */
function elBrightnessToMatter(level: number): number {
  return Math.max(1, Math.round(level * 254 / 100));
}

/** Matter LevelControl currentLevel (1-254) → EL 照度レベル (0-100) */
function matterToElBrightness(level: number): number {
  return Math.min(100, Math.round(level * 100 / 254));
}

/** EL 照度レベル (0-100) → EDT hex (1バイト) */
function elBrightnessToHex(level: number): string {
  return Math.min(100, Math.max(0, Math.round(level))).toString(16).padStart(2, "0");
}

/** ℃ → Echonet Lite EDT hex (符号付き1バイト) */
function celsiusToElHex(c: number): string {
  const clamped = Math.max(-127, Math.min(125, Math.round(c)));
  const byte = clamped < 0 ? clamped + 256 : clamped;
  return byte.toString(16).padStart(2, "0");
}

/** 2バイト符号なし計測値 (0-65533) → 数値 or null (0xFFFE=オーバーフロー, 0xFFFF=計測不能) */
function parseUint16Measurement(hex: string): number | null {
  if (hex.length < 4) return null;
  const raw = parseInt(hex, 16);
  if (isNaN(raw) || raw >= 0xfffe) return null;
  return raw;
}

/** 相対湿度 (1バイト 0-100%) → 数値 or null */
function parseHumidityPercent(hex: string): number | null {
  const val = parseInt(hex, 16);
  if (isNaN(val) || val > 100) return null;
  return val;
}

/**
 * lux → Matter IlluminanceMeasurement 値 (対数エンコーディング)
 * Matter仕様: measuredValue = 10000 × log10(lux) + 1 (1-65534, 0="計測不能な暗さ")
 */
function luxToMatter(lux: number): number {
  if (lux <= 0) return 0;
  return Math.min(65534, Math.max(1, Math.round(10000 * Math.log10(lux) + 1)));
}

/** CO2 ppm → Matter AirQuality 区分 (一般的な室内環境基準に基づく) */
function co2ToAirQuality(ppm: number): AirQuality.AirQualityEnum {
  if (ppm < 800) return AirQuality.AirQualityEnum.Good;
  if (ppm < 1000) return AirQuality.AirQualityEnum.Fair;
  if (ppm < 1500) return AirQuality.AirQualityEnum.Moderate;
  return AirQuality.AirQualityEnum.Poor;
}

/** EL 風量 (0x31-0x38=Lv1-8) → パーセント (12-100) */
function elAirFlowToPercent(airFlow: number): number {
  const level = Math.max(1, Math.min(8, airFlow - 0x30));
  return Math.round(level * 100 / 8);
}

/** パーセント (1-100) → EL 風量 (0x31-0x38) */
function percentToElAirFlow(percent: number): number {
  const level = Math.max(1, Math.min(8, Math.ceil(percent * 8 / 100)));
  return 0x30 + level;
}

/** EL 風量 → Matter FanMode (Off以外) */
function elAirFlowToFanMode(airFlow: number): FanControl.FanMode {
  if (airFlow === 0x41) return FanControl.FanMode.Auto;
  const level = airFlow - 0x30;
  if (level <= 3) return FanControl.FanMode.Low;
  if (level <= 5) return FanControl.FanMode.Medium;
  return FanControl.FanMode.High;
}

/** EL 光色設定値 → mireds (未知の値は null) */
function elColorToMireds(el: number): number | null {
  return LIGHT_COLOR_TO_MIREDS.find(e => e.el === el)?.mireds ?? null;
}

/** mireds → 最近傍の EL 光色設定値 */
function miredsToElColor(mireds: number): number {
  let best = LIGHT_COLOR_TO_MIREDS[0];
  for (const e of LIGHT_COLOR_TO_MIREDS) {
    if (Math.abs(e.mireds - mireds) < Math.abs(best.mireds - mireds)) best = e;
  }
  return best.el;
}

// ============================================================
// Echonet Lite クライアント
// ============================================================
class EchonetClient {
  private selfEoj = "05ff01"; // コントローラプロファイル
  private initialized = false;
  private onPacket: ((rinfo: RInfo, els: ElData) => void) | null = null;

  /** 初期化: UDPソケットを開いてリスン開始 */
  async initialize(onPacket: (rinfo: RInfo, els: ElData) => void): Promise<void> {
    this.onPacket = onPacket;
    return new Promise<void>((resolve, reject) => {
      try {
        EL.initialize(
          [this.selfEoj],
          (rinfo: RInfo, els: ElData, err: any) => {
            if (err) {
              logger.error("EL receive error:", err);
              return;
            }
            // INF/INFC への自動応答 (ECHONET Lite仕様準拠)
            if (els.ESV === ESV.INFC) {
              // INFC (通知応答要) に対する応答を返す
              try {
                EL.sendOPC1(
                  rinfo.address, this.selfEoj, els.SEOJ,
                  "7a", // INF_RES
                  Object.keys(els.DETAILs || {})[0] || "80", ""
                );
              } catch (e) {
                logger.warn(`Failed to send INF_RES to ${rinfo.address}/${els.SEOJ}:`, e);
              }
            }
            this.onPacket?.(rinfo, els);
          },
          4, // IPv4
          { v4: BIND_INTERFACE, v6: "", ignoreMe: !ALLOW_SELF, autoGetProperties: true, autoGetDelay: 1000, debugMode: false }
        );
        if (BIND_INTERFACE) {
          logger.notice(`Multicast bound to interface: ${BIND_INTERFACE}`);
        }
        if (EL_TARGET_PORT > 0) {
          // bind (3610) は EL.initialize 内で確定済み。以降の送信先のみを変更する
          (EL as any).EL_port = EL_TARGET_PORT;
          logger.notice(`EL destination port overridden: ${EL_TARGET_PORT} (listening stays on 3610)`);
        }
        this.initialized = true;
        logger.notice("Echonet Lite client initialized (UDP 3610)");
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }

  /** ネットワーク探索 */
  search(): void {
    if (!this.initialized) return;
    EL.search();
  }

  /** プロパティ取得 (Get) */
  getProperty(ip: string, eoj: string, epc: string): void {
    if (!this.initialized) return;
    try {
      EL.sendOPC1(ip, this.selfEoj, eoj, ESV.GET, epc, "");
    } catch (e) {
      logger.warn(`Failed to GET ${epc} from ${ip}/${eoj}:`, e);
    }
  }

  /** プロパティ設定 (SetC: 応答要求あり) — 同期送信例外時に指数バックオフで最大maxRetries回再送 */
  setProperty(ip: string, eoj: string, epc: string, edt: string, maxRetries = 2): void {
    if (!this.initialized) return;
    const trySend = (attempt: number): void => {
      try {
        EL.sendOPC1(ip, this.selfEoj, eoj, ESV.SETC, epc, edt);
        const suffix = attempt > 0 ? ` (retry ${attempt}/${maxRetries})` : "";
        logger.info(`SetC → ${ip}/${eoj} EPC:${epc} EDT:${edt}${suffix}`);
      } catch (e) {
        if (attempt < maxRetries) {
          const backoffMs = 100 * Math.pow(2, attempt);
          logger.warn(`SetC throw ${epc} on ${ip}/${eoj} (attempt ${attempt + 1}), retry in ${backoffMs}ms:`, e);
          setTimeout(() => trySend(attempt + 1), backoffMs);
        } else {
          logger.warn(`Failed to SET ${epc} on ${ip}/${eoj} after ${maxRetries + 1} attempts:`, e);
        }
      }
    };
    trySend(0);
  }

  /** 複数プロパティを一括取得 — 200ms 間隔で順次送信 (UDP輻輳・パケットロス対策) */
  getMultiple(ip: string, eoj: string, epcs: string[]): void {
    epcs.forEach((epc, i) => {
      setTimeout(() => this.getProperty(ip, eoj, epc), i * 200);
    });
  }

  /** INF要求を送信 (プロパティ変化通知を要求) */
  requestNotification(ip: string, eoj: string): void {
    if (!this.initialized) return;
    try {
      EL.sendOPC1(ip, this.selfEoj, eoj, ESV.INF_REQ, EPC.OPERATION_STATUS, "");
    } catch (e) {
      logger.warn(`Failed to request INF from ${ip}/${eoj}:`, e);
    }
  }
}

// ============================================================
// エアコン状態マネージャ
// ============================================================
class AirconManager {
  private devices = new Map<string, AirconState>();
  private elClient: EchonetClient;
  private aggregator: Endpoint | null = null;
  private pollIntervalMs: number;
  private reachableTimeoutMs: number;
  private suppressTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private isSuppressed(key: string): boolean {
    return this.suppressTimers.has(key);
  }
  private beginSuppress(key: string, ms = 2000): void {
    const existing = this.suppressTimers.get(key);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => { this.suppressTimers.delete(key); }, ms);
    this.suppressTimers.set(key, t);
  }

  constructor(
    elClient: EchonetClient,
    opts: { pollIntervalSec?: number; reachableTimeoutSec?: number } = {}
  ) {
    this.elClient = elClient;
    this.pollIntervalMs = (opts.pollIntervalSec ?? 30) * 1000;
    this.reachableTimeoutMs = (opts.reachableTimeoutSec ?? 120) * 1000;
  }

  setAggregator(agg: Endpoint): void {
    this.aggregator = agg;
  }

  /** デバイスキー生成 */
  private key(ip: string, eoj: string): string {
    return `${ip}_${eoj}`;
  }

  /** パケット受信処理 */
  async handlePacket(rinfo: RInfo, els: ElData): Promise<void> {
    const ip = rinfo.address;
    const seoj = els.SEOJ;
    const esv = els.ESV;
    const details = els.DETAILs || {};

    // エアコンクラス (0x0130) のみ処理
    const classCode = seoj.substring(0, 4);
    if (classCode !== "0130") return;

    const k = this.key(ip, seoj);

    // 新規デバイス発見
    if (!this.devices.has(k)) {
      logger.notice(`Discovered aircon: ${ip} (${seoj})`);
      const state: AirconState = {
        ip, eoj: seoj,
        power: false, mode: EL_MODE.AUTO, targetTemp: 25,
        roomTemp: null, humidity: null, outdoorTemp: null,
        airFlowRate: 0x41, swingMode: 0x31,
        powerSaving: false, hasError: false,
        reachable: true, lastSeen: Date.now(),
      };
      this.devices.set(k, state);

      // 初回: 全プロパティ取得 (少し間隔を空けて送信)
      const fetchProps = async () => {
        const epcs = [
          EPC.OPERATION_STATUS, EPC.ERROR_STATE, EPC.POWER_SAVING,
          EPC.OPERATION_MODE, EPC.SET_TEMPERATURE, EPC.ROOM_TEMPERATURE,
          EPC.ROOM_HUMIDITY, EPC.OUTDOOR_TEMPERATURE,
          EPC.AIR_FLOW_RATE, EPC.SWING_MODE,
        ];
        for (const epc of epcs) {
          this.elClient.getProperty(ip, seoj, epc);
          await new Promise(r => setTimeout(r, 200)); // 200ms間隔で送信
        }
      };
      fetchProps();

      // INF通知を要求 (状態変化のリアルタイム検知)
      setTimeout(() => {
        this.elClient.requestNotification(ip, seoj);
      }, 3000);

      // 5秒後にリトライ (初回取りこぼし対策)
      setTimeout(() => {
        this.elClient.getMultiple(ip, seoj, [
          EPC.OPERATION_STATUS, EPC.OPERATION_MODE,
          EPC.SET_TEMPERATURE, EPC.ROOM_TEMPERATURE,
        ]);
      }, 5000);

      // Matter エンドポイント作成
      if (this.aggregator) {
        await this.createMatterEndpoint(state, k);
      }
    }

    // プロパティ更新
    const dev = this.devices.get(k)!;
    const wasUnreachable = !dev.reachable;
    dev.lastSeen = Date.now();
    dev.reachable = true;
    if (wasUnreachable) {
      logger.notice(`Aircon reachable again: ${ip}/${seoj}`);
      this.updateReachable(dev, true);
      this.elClient.requestNotification(ip, seoj);
    }

    // Matter→EL操作中はELからの状態更新をスキップ (ポーリング応答との競合防止)
    if (this.isSuppressed(k)) return;

    let stateChanged = false;
    for (const [epc, edt] of Object.entries(details)) {
      const epcUpper = epc.toUpperCase();
      switch (epcUpper) {
        case EPC.OPERATION_STATUS: {
          const newPower = edt === "30";
          if (dev.power !== newPower) {
            dev.power = newPower;
            stateChanged = true;
            logger.notice(`[EL→] ${ip} Power: ${newPower ? "ON" : "OFF"}`);
          }
          break;
        }
        case EPC.OPERATION_MODE: {
          const newMode = parseInt(edt, 16);
          if (!isNaN(newMode) && dev.mode !== newMode) {
            dev.mode = newMode;
            stateChanged = true;
            logger.notice(`[EL→] ${ip} Mode: 0x${edt}`);
          }
          break;
        }
        case EPC.SET_TEMPERATURE: {
          const newTemp = parseTemperature(edt);
          // エアコンの設定温度として有効な範囲: 0〜50℃
          if (newTemp !== null && newTemp >= 0 && newTemp <= 50 && dev.targetTemp !== newTemp) {
            dev.targetTemp = newTemp;
            stateChanged = true;
            logger.notice(`[EL→] ${ip} SetTemp: ${newTemp}℃`);
          }
          break;
        }
        case EPC.ROOM_TEMPERATURE: {
          const newTemp = parseTemperature(edt);
          if (newTemp !== dev.roomTemp) {
            dev.roomTemp = newTemp;
            stateChanged = true;
            logger.debug(`[EL→] ${ip} RoomTemp: ${newTemp ?? "N/A"}℃`);
          }
          break;
        }
        case EPC.ROOM_HUMIDITY: {
          const h = parseInt(edt, 16);
          if (!isNaN(h) && h <= 100) {
            dev.humidity = h;
            logger.debug(`[EL→] ${ip} Humidity: ${h}%`);
          }
          break;
        }
        case EPC.OUTDOOR_TEMPERATURE: {
          const t = parseTemperature(edt);
          dev.outdoorTemp = t;
          logger.debug(`[EL→] ${ip} OutdoorTemp: ${t ?? "N/A"}℃`);
          break;
        }
        case EPC.ERROR_STATE: {
          // 0x41=異常あり, 0x42=正常
          const newError = edt === "41";
          if (dev.hasError !== newError) {
            dev.hasError = newError;
            if (newError) {
              logger.warn(`[EL→] ${ip} Aircon ERROR detected`);
              this.updateReachable(dev, false);
            } else {
              logger.notice(`[EL→] ${ip} Aircon error cleared`);
              this.updateReachable(dev, true);
            }
          }
          break;
        }
        case EPC.POWER_SAVING: {
          // 0x41=節電中, 0x42=通常
          const newSaving = edt === "41";
          if (dev.powerSaving !== newSaving) {
            dev.powerSaving = newSaving;
            logger.notice(`[EL→] ${ip} PowerSaving: ${newSaving ? "ON" : "OFF"}`);
          }
          break;
        }
        case EPC.AIR_FLOW_RATE: {
          const newRate = parseInt(edt, 16) || 0x41;
          if (dev.airFlowRate !== newRate) {
            dev.airFlowRate = newRate;
            const rateName = newRate === 0x41 ? "Auto"
              : newRate >= 0x31 && newRate <= 0x38 ? `Lv${newRate - 0x30}` : `0x${edt}`;
            logger.notice(`[EL→] ${ip} FanSpeed: ${rateName}`);
          }
          break;
        }
        case EPC.SWING_MODE: {
          dev.swingMode = parseInt(edt, 16) || 0x31;
          break;
        }
      }
    }

    if (stateChanged) {
      this.syncToMatter(dev);
    }
  }

  /** ポーリング: 全デバイスのプロパティを再取得 + 到達性チェック */
  poll(): void {
    const now = Date.now();
    for (const [k, dev] of this.devices) {
      // 到達性チェック
      if (now - dev.lastSeen > this.reachableTimeoutMs) {
        if (dev.reachable) {
          dev.reachable = false;
          logger.warn(`Device unreachable: ${dev.ip}/${dev.eoj}`);
          this.updateReachable(dev, false);
        }
        // それでもポーリングは続ける (復帰検知のため)
      }

      this.elClient.getMultiple(dev.ip, dev.eoj, [
        EPC.OPERATION_STATUS, EPC.ERROR_STATE,
        EPC.OPERATION_MODE, EPC.SET_TEMPERATURE, EPC.ROOM_TEMPERATURE,
      ]);
    }
  }

  // ============================================================
  // Matter エンドポイント作成
  // ============================================================
  private async createMatterEndpoint(dev: AirconState, key: string): Promise<void> {
    if (!this.aggregator) return;

    // Thermostat: Heating + Cooling feature を有効化
    // これにより Apple Home / Google Home で冷暖房両方の制御UIが出る
    const ThermostatWithFeatures = ThermostatDevice.with(
      ThermostatServer.with("Heating", "Cooling", "AutoMode"),
      BridgedDeviceBasicInformationServer
    );

    // ELは設定温度が1値だが、Matterは冷房/暖房別々 + デッドバンドが必要
    // minSetpointDeadBand は 0.1℃ 単位、setpoint は 0.01℃ 単位
    const DEADBAND_ATTR = 10;  // 属性値: 10 = 1.0℃ (0.1℃単位)
    const DEADBAND = 100;      // setpoint計算用: 100 = 1.0℃ (0.01℃単位)
    const targetMatter = celsiusToMatter(dev.targetTemp);
    const coolSetpoint = Math.max(celsiusToMatter(16), targetMatter);
    const heatSetpoint = Math.min(celsiusToMatter(30), coolSetpoint - DEADBAND);

    const ep = new Endpoint(
      ThermostatWithFeatures,
      {
        id: `aircon-${key.replace(/[^a-zA-Z0-9]/g, "-")}`,
        bridgedDeviceBasicInformation: {
          nodeLabel: `エアコン (${dev.ip})`,
          vendorName: "reomaru",
          productName: "ECHONET Lite Air Conditioner",
          serialNumber: key,
          reachable: true,
        },
        thermostat: {
          // MoekadenRoom等では室温(0xBB)未実装のため、未計測時は設定温度で代替
          localTemperature: celsiusToMatter(dev.roomTemp ?? dev.targetTemp),
          occupiedCoolingSetpoint: coolSetpoint,
          occupiedHeatingSetpoint: heatSetpoint,
          systemMode: elModeToMatterMode(dev.mode, dev.power),
          controlSequenceOfOperation:
            Thermostat.ControlSequenceOfOperation.CoolingAndHeating,
          minCoolSetpointLimit: celsiusToMatter(16),
          maxCoolSetpointLimit: celsiusToMatter(32),
          minHeatSetpointLimit: celsiusToMatter(7),
          maxHeatSetpointLimit: celsiusToMatter(30),
          minSetpointDeadBand: DEADBAND_ATTR,
        },
      }
    );

    // ---- Matter → Echonet Lite: コマンドハンドラ ----

    // SystemMode 変更 (ON/OFF + 運転モード)
    ep.events.thermostat.systemMode$Changed.on(async (newMode: Thermostat.SystemMode) => {
      logger.notice(`[→EL] SystemMode changed to ${newMode}`);
      this.beginSuppress(key);
      const { power, elMode } = matterModeToEl(newMode);

      // 電源制御
      const currentPower = dev.power;
      if (power !== currentPower) {
        this.elClient.setProperty(
          dev.ip, dev.eoj,
          EPC.OPERATION_STATUS,
          power ? "30" : "31"
        );
        dev.power = power;
      }

      // モード設定 (電源ONの場合のみ)
      if (power && elMode !== null) {
        this.elClient.setProperty(
          dev.ip, dev.eoj,
          EPC.OPERATION_MODE,
          elMode.toString(16).padStart(2, "0")
        );
        dev.mode = elMode;
      }

      // モード変更後にセットポイントを現在のEL設定温度に合わせる
      const target = celsiusToMatter(dev.targetTemp);
      const setpointUpdates: Record<string, any> = {};
      switch (newMode) {
        case Thermostat.SystemMode.Cool:
          setpointUpdates.occupiedCoolingSetpoint = Math.max(celsiusToMatter(16), target);
          break;
        case Thermostat.SystemMode.Heat:
          setpointUpdates.occupiedHeatingSetpoint = Math.min(celsiusToMatter(30), target);
          break;
        case Thermostat.SystemMode.Auto: {
          const cool = Math.max(celsiusToMatter(16), target);
          const heat = Math.min(celsiusToMatter(30), cool - DEADBAND);
          setpointUpdates.occupiedCoolingSetpoint = cool;
          setpointUpdates.occupiedHeatingSetpoint = heat;
          break;
        }
      }
      if (Object.keys(setpointUpdates).length > 0) {
        try { (ep as any).set({ thermostat: setpointUpdates }); } catch (_) {}
      }
    });

    // 冷房設定温度変更
    ep.events.thermostat.occupiedCoolingSetpoint$Changed.on(async (newVal: number) => {
      const celsius = matterToCelsius(newVal);
      logger.notice(`[→EL] CoolingSetpoint → ${celsius}℃`);
      this.beginSuppress(key);
      this.elClient.setProperty(
        dev.ip, dev.eoj,
        EPC.SET_TEMPERATURE,
        celsiusToElHex(celsius)
      );
      dev.targetTemp = Math.round(celsius);
    });

    // 暖房設定温度変更
    ep.events.thermostat.occupiedHeatingSetpoint$Changed.on(async (newVal: number) => {
      const celsius = matterToCelsius(newVal);
      logger.notice(`[→EL] HeatingSetpoint → ${celsius}℃`);
      this.beginSuppress(key);
      this.elClient.setProperty(
        dev.ip, dev.eoj,
        EPC.SET_TEMPERATURE,
        celsiusToElHex(celsius)
      );
      dev.targetTemp = Math.round(celsius);
    });

    // Aggregator に追加
    await (this.aggregator as any).add(ep);
    dev.matterEndpoint = ep;
    logger.notice(`Matter Thermostat endpoint created for ${dev.ip}`);
  }

  // ============================================================
  // Echonet Lite → Matter 同期
  // ============================================================
  private syncToMatter(dev: AirconState): void {
    const ep = dev.matterEndpoint;
    if (!ep) return;

    this.beginSuppress(this.key(dev.ip, dev.eoj), 1000);
    try {
      const updates: Record<string, any> = {};
      const DEADBAND = 100; // 1.0℃
      const MIN_COOL = celsiusToMatter(16);
      const MAX_HEAT = celsiusToMatter(30);

      updates.localTemperature = celsiusToMatter(dev.roomTemp ?? dev.targetTemp);

      const matterMode = elModeToMatterMode(dev.mode, dev.power);
      updates.systemMode = matterMode;

      const target = celsiusToMatter(dev.targetTemp);
      switch (matterMode) {
        case Thermostat.SystemMode.Cool:
          updates.occupiedCoolingSetpoint = Math.max(MIN_COOL, target);
          break;
        case Thermostat.SystemMode.Heat:
          updates.occupiedHeatingSetpoint = Math.min(MAX_HEAT, target);
          break;
        case Thermostat.SystemMode.Auto: {
          const cool = Math.max(MIN_COOL, target);
          const heat = Math.min(MAX_HEAT, cool - DEADBAND);
          updates.occupiedCoolingSetpoint = cool;
          updates.occupiedHeatingSetpoint = heat;
          break;
        }
        default:
          break;
      }

      (ep as any).set({ thermostat: updates });

      logger.debug(`[EL→Matter] Synced: mode=${matterMode}, ` +
        `temp=${dev.roomTemp}℃, target=${dev.targetTemp}℃`);
    } catch (e) {
      logger.error("Failed to sync to Matter:", e);
    }
  }

  /** 到達性の更新 */
  private updateReachable(dev: AirconState, reachable: boolean): void {
    if (!dev.matterEndpoint) return;
    try {
      (dev.matterEndpoint as any).set({
        bridgedDeviceBasicInformation: { reachable },
      });
    } catch (e) {
      logger.warn("Failed to update reachable:", e);
    }
  }

  /** デバッグ: 現在の全デバイス状態を出力 */
  dumpState(): void {
    for (const [k, dev] of this.devices) {
      logger.info(
        `[${k}] power=${dev.power} mode=0x${dev.mode.toString(16)} ` +
        `target=${dev.targetTemp}℃ room=${dev.roomTemp}℃ ` +
        `humidity=${dev.humidity}% outdoor=${dev.outdoorTemp}℃ ` +
        `reachable=${dev.reachable}`
      );
    }
  }
}

// ============================================================
// 照明マネージャ (EL 0x0290 → Matter OnOffLight)
// ============================================================
class LightManager {
  private devices = new Map<string, LightState>();
  private elClient: EchonetClient;
  private aggregator: Endpoint | null = null;
  private reachableTimeoutMs: number;

  constructor(elClient: EchonetClient, opts: { reachableTimeoutSec?: number } = {}) {
    this.elClient = elClient;
    this.reachableTimeoutMs = (opts.reachableTimeoutSec ?? 120) * 1000;
  }

  setAggregator(agg: Endpoint): void { this.aggregator = agg; }

  private key(ip: string, eoj: string): string { return `${ip}_${eoj}`; }

  async handlePacket(rinfo: RInfo, els: ElData): Promise<void> {
    const ip = rinfo.address;
    const seoj = els.SEOJ;
    const classCode = seoj.substring(0, 4);
    if (classCode !== "0290") return;

    const k = this.key(ip, seoj);
    const details = els.DETAILs || {};

    const powerEdt = Object.entries(details)
      .find(([epc]) => epc.toUpperCase() === LIGHT_EPC.OPERATION_STATUS)?.[1];
    const brightnessEdt = Object.entries(details)
      .find(([epc]) => epc.toUpperCase() === LIGHT_EPC.BRIGHTNESS)?.[1];
    const colorEdt = Object.entries(details)
      .find(([epc]) => epc.toUpperCase() === LIGHT_EPC.LIGHT_COLOR)?.[1];

    if (!this.devices.has(k)) {
      logger.notice(`Discovered light: ${ip} (${seoj})`);
      const initBrightness = brightnessEdt !== undefined
        ? parseInt(brightnessEdt, 16) : null;
      const initColorRaw = colorEdt !== undefined ? parseInt(colorEdt, 16) : NaN;
      const initColor = elColorToMireds(initColorRaw) !== null ? initColorRaw : null;
      const state: LightState = {
        ip, eoj: seoj,
        power: powerEdt === "30",
        brightness: initBrightness,
        colorTemp: initColor,
        reachable: true, lastSeen: Date.now(),
      };
      this.devices.set(k, state);
      // 発見パケットに含まれていないプロパティを取得
      if (!powerEdt) this.elClient.getProperty(ip, seoj, LIGHT_EPC.OPERATION_STATUS);
      if (!brightnessEdt) this.elClient.getProperty(ip, seoj, LIGHT_EPC.BRIGHTNESS);
      if (powerEdt) logger.notice(`[EL→] ${ip} Light: ${state.power ? "ON" : "OFF"}`);
      if (initBrightness !== null) logger.notice(`[EL→] ${ip} Brightness: ${initBrightness}%`);

      // 光色 (0xB1) 対応判定:
      //   発見パケットに含まれていれば即 ColorTemperatureLight として作成。
      //   なければ Get を投げて応答を待ち、期限までに来なければ DimmableLight として作成。
      if (state.colorTemp !== null) {
        if (this.aggregator) await this.createMatterEndpoint(state, k, true);
      } else {
        this.elClient.getProperty(ip, seoj, LIGHT_EPC.LIGHT_COLOR);
        state.createTimer = setTimeout(() => {
          state.createTimer = undefined;
          if (!state.matterEndpoint && this.aggregator) {
            this.createMatterEndpoint(state, k, state.colorTemp !== null);
          }
        }, 3500);
      }
      return;
    }

    const dev = this.devices.get(k)!;
    const wasUnreachable = !dev.reachable;
    dev.lastSeen = Date.now();
    dev.reachable = true;
    if (wasUnreachable) {
      logger.notice(`Light reachable again: ${ip}/${seoj}`);
      this.updateReachable(dev, true);
      this.elClient.requestNotification(ip, seoj);
    }

    let powerChanged = false;
    let brightnessChanged = false;
    let colorChanged = false;

    if (powerEdt !== undefined) {
      const newPower = powerEdt === "30";
      if (dev.power !== newPower) {
        dev.power = newPower;
        logger.notice(`[EL→] ${ip} Light: ${newPower ? "ON" : "OFF"}`);
        powerChanged = true;
      }
    }

    if (brightnessEdt !== undefined) {
      const newBrightness = parseInt(brightnessEdt, 16);
      if (!isNaN(newBrightness) && dev.brightness !== newBrightness) {
        dev.brightness = newBrightness;
        logger.notice(`[EL→] ${ip} Brightness: ${newBrightness}%`);
        brightnessChanged = true;
      }
    }

    if (colorEdt !== undefined) {
      const newColor = parseInt(colorEdt, 16);
      if (elColorToMireds(newColor) !== null && dev.colorTemp !== newColor) {
        dev.colorTemp = newColor;
        logger.notice(`[EL→] ${ip} LightColor: 0x${colorEdt}`);
        colorChanged = true;
      }
    }

    // 光色プローブ中に 0xB1 応答が来たら、期限を待たず ColorTemperatureLight として作成
    if (!dev.matterEndpoint) {
      if (dev.createTimer && dev.colorTemp !== null) {
        clearTimeout(dev.createTimer);
        dev.createTimer = undefined;
        if (this.aggregator) await this.createMatterEndpoint(dev, k, true);
      }
      return; // エンドポイント作成時に最新状態が反映されるため個別同期は不要
    }

    if (powerChanged || brightnessChanged || colorChanged) {
      this.syncToMatter(dev, powerChanged, brightnessChanged, colorChanged);
    }
  }

  poll(): void {
    const now = Date.now();
    for (const [, dev] of this.devices) {
      if (now - dev.lastSeen > this.reachableTimeoutMs && dev.reachable) {
        dev.reachable = false;
        logger.warn(`Light unreachable: ${dev.ip}/${dev.eoj}`);
        this.updateReachable(dev, false);
      }
      this.elClient.getProperty(dev.ip, dev.eoj, LIGHT_EPC.OPERATION_STATUS);
      this.elClient.getProperty(dev.ip, dev.eoj, LIGHT_EPC.BRIGHTNESS);
      if (dev.colorTemp !== null) {
        this.elClient.getProperty(dev.ip, dev.eoj, LIGHT_EPC.LIGHT_COLOR);
      }
    }
  }

  private async createMatterEndpoint(dev: LightState, key: string, withColor: boolean): Promise<void> {
    if (!this.aggregator) return;

    // DimmableLight: LevelControl(Lighting+OnOff) + OnOff
    // ColorTemperatureLight: 上記 + ColorControl(ColorTemperature)
    const initialLevel = dev.brightness !== null
      ? elBrightnessToMatter(dev.brightness) : 254;

    const commonConfig = {
      id: `light-${key.replace(/[^a-zA-Z0-9]/g, "-")}`,
      bridgedDeviceBasicInformation: {
        nodeLabel: `照明 (${dev.ip})`,
        vendorName: "reomaru",
        productName: "ECHONET Lite Light",
        serialNumber: key,
        reachable: true,
      },
      onOff: { onOff: dev.power },
      levelControl: {
        currentLevel: initialLevel,
        minLevel: 1,
        maxLevel: 254,
      },
    };

    let ep: Endpoint;
    if (withColor) {
      const initialMireds = elColorToMireds(dev.colorTemp ?? 0x42) ?? 250;
      ep = new Endpoint(
        ColorTemperatureLightDevice.with(BridgedDeviceBasicInformationServer),
        {
          ...commonConfig,
          colorControl: {
            colorMode: ColorControl.ColorMode.ColorTemperatureMireds,
            colorTemperatureMireds: initialMireds,
            colorTempPhysicalMinMireds: 154, // 昼光色 ≈ 6500K
            colorTempPhysicalMaxMireds: 370, // 電球色 ≈ 2700K
            coupleColorTempToLevelMinMireds: 154,
            startUpColorTemperatureMireds: null,
          },
        }
      );

      // 色温度変化 → EL SetC 0xB1 (電球色/白色/昼白色/昼光色の4値に量子化)
      // dev.colorTemp と一致する場合は syncToMatter() 起因の変化なのでスキップ
      (ep as any).events.colorControl.colorTemperatureMireds$Changed.on(async (newMireds: number) => {
        const elColor = miredsToElColor(newMireds);
        if (dev.colorTemp === elColor) return;
        logger.notice(`[→EL] Light color → 0x${elColor.toString(16)} (${newMireds} mireds)`);
        this.elClient.setProperty(
          dev.ip, dev.eoj, LIGHT_EPC.LIGHT_COLOR,
          elColor.toString(16).padStart(2, "0")
        );
        dev.colorTemp = elColor;
      });
    } else {
      ep = new Endpoint(DimmableLightDevice.with(BridgedDeviceBasicInformationServer), commonConfig);
    }

    // ON/OFF 変化 → EL SetC 0x80
    // dev.power と一致する場合は syncToMatter() 起因の変化なのでスキップ
    (ep as any).events.onOff.onOff$Changed.on(async (newVal: boolean) => {
      if (dev.power === newVal) return;
      logger.notice(`[→EL] Light onOff → ${newVal}`);
      this.elClient.setProperty(dev.ip, dev.eoj, LIGHT_EPC.OPERATION_STATUS, newVal ? "30" : "31");
      dev.power = newVal;
    });

    // 輝度変化 → EL SetC 0xB0
    // dev.brightness と一致する場合は syncToMatter() 起因の変化なのでスキップ
    (ep as any).events.levelControl.currentLevel$Changed.on(async (newLevel: number | null) => {
      if (newLevel === null) return;
      const elLevel = matterToElBrightness(newLevel);
      if (dev.brightness === elLevel) return;
      logger.notice(`[→EL] Light brightness → ${elLevel}% (Matter: ${newLevel})`);
      this.elClient.setProperty(dev.ip, dev.eoj, LIGHT_EPC.BRIGHTNESS, elBrightnessToHex(elLevel));
      dev.brightness = elLevel;
    });

    await (this.aggregator as any).add(ep);
    dev.matterEndpoint = ep;
    logger.notice(`Matter ${withColor ? "ColorTemperatureLight" : "DimmableLight"} endpoint created for ${dev.ip}`);
  }

  private syncToMatter(dev: LightState, syncPower: boolean, syncBrightness: boolean, syncColor = false): void {
    if (!dev.matterEndpoint) return;
    try {
      const updates: Record<string, any> = {};
      if (syncPower) updates.onOff = { onOff: dev.power };
      if (syncBrightness && dev.brightness !== null) {
        updates.levelControl = { currentLevel: elBrightnessToMatter(dev.brightness) };
      }
      if (syncColor && dev.colorTemp !== null) {
        const mireds = elColorToMireds(dev.colorTemp);
        if (mireds !== null && "colorControl" in (dev.matterEndpoint as any).state) {
          updates.colorControl = { colorTemperatureMireds: mireds };
        }
      }
      if (Object.keys(updates).length > 0) {
        (dev.matterEndpoint as any).set(updates);
      }
    } catch (e) {
      logger.error("Failed to sync light to Matter:", e);
    }
  }

  private updateReachable(dev: LightState, reachable: boolean): void {
    if (!dev.matterEndpoint) return;
    try {
      (dev.matterEndpoint as any).set({ bridgedDeviceBasicInformation: { reachable } });
    } catch (e) { logger.warn("Failed to update light reachable:", e); }
  }
}

// ============================================================
// ブラインド/雨戸・シャッターマネージャ
// (EL 0x0260 / 0x0263 → Matter WindowCovering)
// ============================================================
class BlindManager {
  private devices = new Map<string, BlindState>();
  private elClient: EchonetClient;
  private aggregator: Endpoint | null = null;
  private reachableTimeoutMs: number;
  private suppressTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private isSuppressed(key: string): boolean {
    return this.suppressTimers.has(key);
  }
  private beginSuppress(key: string, ms = 2000): void {
    const existing = this.suppressTimers.get(key);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => { this.suppressTimers.delete(key); }, ms);
    this.suppressTimers.set(key, t);
  }

  constructor(elClient: EchonetClient, opts: { reachableTimeoutSec?: number } = {}) {
    this.elClient = elClient;
    this.reachableTimeoutMs = (opts.reachableTimeoutSec ?? 120) * 1000;
  }

  setAggregator(agg: Endpoint): void { this.aggregator = agg; }

  private key(ip: string, eoj: string): string { return `${ip}_${eoj}`; }

  async handlePacket(rinfo: RInfo, els: ElData): Promise<void> {
    const ip = rinfo.address;
    const seoj = els.SEOJ;
    const classCode = seoj.substring(0, 4);
    if (classCode !== "0260" && classCode !== "0263") return;
    const kind: BlindState["kind"] = classCode === "0263" ? "shutter" : "blind";

    const k = this.key(ip, seoj);
    const details = els.DETAILs || {};

    // 発見パケットまたは応答から初期状態を抽出
    const openCloseEdt = Object.entries(details)
      .find(([epc]) => epc.toUpperCase() === BLIND_EPC.OPEN_CLOSE)?.[1];
    // 開閉状態 (0xEA、主に 0x0263): 0x41=全開, 0x43=開動作中 → 開 / 0x42=全閉, 0x44=閉動作中 → 閉
    const statusEdt = Object.entries(details)
      .find(([epc]) => epc.toUpperCase() === BLIND_EPC.OPEN_CLOSE_STATUS)?.[1];
    const statusIsOpen = statusEdt === "41" || statusEdt === "43" ? true
      : statusEdt === "42" || statusEdt === "44" ? false : undefined;

    if (!this.devices.has(k)) {
      logger.notice(`Discovered ${kind}: ${ip} (${seoj})`);
      const state: BlindState = {
        ip, eoj: seoj, kind,
        // 初期値: パケットにあれば反映 (0xEA優先)、なければ false
        isOpen: statusIsOpen ?? (openCloseEdt === "41"),
        reachable: true, lastSeen: Date.now(),
      };
      this.devices.set(k, state);
      // 発見パケットに状態が含まれていなければ取得要求
      if (!openCloseEdt && statusIsOpen === undefined) {
        this.elClient.getProperty(ip, seoj, BLIND_EPC.OPEN_CLOSE);
        if (kind === "shutter") this.elClient.getProperty(ip, seoj, BLIND_EPC.OPEN_CLOSE_STATUS);
      } else {
        logger.notice(`[EL→] ${ip} ${kind}: ${state.isOpen ? "OPEN" : "CLOSED"}`);
      }
      if (this.aggregator) await this.createMatterEndpoint(state, k);
      return;
    }

    const dev = this.devices.get(k)!;
    const wasUnreachable = !dev.reachable;
    dev.lastSeen = Date.now();
    dev.reachable = true;
    if (wasUnreachable) {
      logger.notice(`Blind reachable again: ${ip}/${seoj}`);
      this.updateReachable(dev, true);
      this.elClient.requestNotification(ip, seoj);
    }

    if (this.isSuppressed(k)) return;

    // 0xEA (開閉状態) があればそちらを優先、なければ 0xE0 (動作設定) から判定
    const newIsOpen = statusIsOpen ?? (openCloseEdt !== undefined ? openCloseEdt === "41" : undefined);
    if (newIsOpen !== undefined && dev.isOpen !== newIsOpen) {
      dev.isOpen = newIsOpen;
      logger.notice(`[EL→] ${ip} ${dev.kind}: ${newIsOpen ? "OPEN" : "CLOSED"}`);
      this.syncToMatter(dev);
    }
  }

  poll(): void {
    const now = Date.now();
    for (const [, dev] of this.devices) {
      if (now - dev.lastSeen > this.reachableTimeoutMs && dev.reachable) {
        dev.reachable = false;
        logger.warn(`Blind unreachable: ${dev.ip}/${dev.eoj}`);
        this.updateReachable(dev, false);
      }
      this.elClient.getProperty(dev.ip, dev.eoj, BLIND_EPC.OPEN_CLOSE);
      if (dev.kind === "shutter") {
        this.elClient.getProperty(dev.ip, dev.eoj, BLIND_EPC.OPEN_CLOSE_STATUS);
      }
    }
  }

  private async createMatterEndpoint(dev: BlindState, key: string): Promise<void> {
    if (!this.aggregator) return;

    // PositionAwareLift: open=0%, closed=100% のバイナリマッピング
    const initialPos = dev.isOpen ? 0 : 10000;
    const isShutter = dev.kind === "shutter";

    const ep = new Endpoint(
      WindowCoveringDevice.with(
        WindowCoveringServer.with("Lift", "PositionAwareLift"),
        BridgedDeviceBasicInformationServer,
      ),
      {
        id: `${dev.kind}-${key.replace(/[^a-zA-Z0-9]/g, "-")}`,
        bridgedDeviceBasicInformation: {
          nodeLabel: `${isShutter ? "シャッター" : "ブラインド"} (${dev.ip})`,
          vendorName: "reomaru",
          productName: isShutter ? "ECHONET Lite Shutter" : "ECHONET Lite Blind",
          serialNumber: key,
          reachable: true,
        },
        windowCovering: {
          type: isShutter
            ? WindowCovering.WindowCoveringType.Shutter
            : WindowCovering.WindowCoveringType.Rollershade,
          configStatus: {
            operational: true,
            onlineReserved: true,
            liftPositionAware: true,
          },
          endProductType: isShutter
            ? WindowCovering.EndProductType.RollerShutter
            : WindowCovering.EndProductType.RollerShade,
          currentPositionLiftPercent100ths: initialPos,
          targetPositionLiftPercent100ths: initialPos,
          currentPositionLiftPercentage: dev.isOpen ? 0 : 100,
          operationalStatus: {
            global: WindowCovering.MovementStatus.Stopped,
            lift: WindowCovering.MovementStatus.Stopped,
            tilt: WindowCovering.MovementStatus.Stopped,
          },
        },
      }
    );

    // Matter→EL: target position 変化を監視 (0=open, 10000=closed)
    ep.events.windowCovering.targetPositionLiftPercent100ths$Changed.on(
      async (newTarget: number | null) => {
        if (newTarget === null) return;
        // 50% を閾値として open/close を判定
        const shouldOpen = newTarget < 5000;
        if (shouldOpen === dev.isOpen) return;
        logger.notice(`[→EL] Blind → ${shouldOpen ? "OPEN" : "CLOSE"}`);
        this.beginSuppress(key);
        this.elClient.setProperty(
          dev.ip, dev.eoj, BLIND_EPC.OPEN_CLOSE,
          shouldOpen ? "41" : "42"
        );
        dev.isOpen = shouldOpen;
      }
    );

    await (this.aggregator as any).add(ep);
    dev.matterEndpoint = ep;
    logger.notice(`Matter WindowCovering endpoint created for ${dev.ip}`);
  }

  private syncToMatter(dev: BlindState): void {
    if (!dev.matterEndpoint) return;
    this.beginSuppress(this.key(dev.ip, dev.eoj), 1000);
    const pos = dev.isOpen ? 0 : 10000;
    try {
      (dev.matterEndpoint as any).set({
        windowCovering: {
          currentPositionLiftPercent100ths: pos,
          currentPositionLiftPercentage: dev.isOpen ? 0 : 100,
        },
      });
    } catch (e) {
      logger.error("Failed to sync blind to Matter:", e);
    }
  }

  private updateReachable(dev: BlindState, reachable: boolean): void {
    if (!dev.matterEndpoint) return;
    try {
      (dev.matterEndpoint as any).set({ bridgedDeviceBasicInformation: { reachable } });
    } catch (e) { logger.warn("Failed to update blind reachable:", e); }
  }
}

// ============================================================
// 温度センサーマネージャ (EL 0x0011 → Matter TemperatureSensor)
// ============================================================
class TempSensorManager {
  private devices = new Map<string, TempSensorState>();
  private elClient: EchonetClient;
  private aggregator: Endpoint | null = null;
  private reachableTimeoutMs: number;

  constructor(elClient: EchonetClient, opts: { reachableTimeoutSec?: number } = {}) {
    this.elClient = elClient;
    this.reachableTimeoutMs = (opts.reachableTimeoutSec ?? 120) * 1000;
  }

  setAggregator(agg: Endpoint): void { this.aggregator = agg; }

  private key(ip: string, eoj: string): string { return `${ip}_${eoj}`; }

  async handlePacket(rinfo: RInfo, els: ElData): Promise<void> {
    const ip = rinfo.address;
    const seoj = els.SEOJ;
    const classCode = seoj.substring(0, 4);
    if (classCode !== "0011") return;

    const k = this.key(ip, seoj);
    const details = els.DETAILs || {};

    const tempEdt = Object.entries(details)
      .find(([epc]) => epc.toUpperCase() === TEMP_EPC.MEASURED_TEMP)?.[1];

    if (!this.devices.has(k)) {
      logger.notice(`Discovered temperature sensor: ${ip} (${seoj})`);
      const initTemp = tempEdt ? parseTempSensor2Byte(tempEdt) : null;
      const state: TempSensorState = {
        ip, eoj: seoj, temperature: initTemp,
        reachable: true, lastSeen: Date.now(),
      };
      this.devices.set(k, state);
      if (!tempEdt) {
        this.elClient.getProperty(ip, seoj, TEMP_EPC.MEASURED_TEMP);
      } else {
        logger.notice(`[EL→] ${ip} TempSensor: ${initTemp ?? "N/A"}℃`);
      }
      if (this.aggregator) await this.createMatterEndpoint(state, k);
      return;
    }

    const dev = this.devices.get(k)!;
    const wasUnreachable = !dev.reachable;
    dev.lastSeen = Date.now();
    dev.reachable = true;
    if (wasUnreachable) {
      logger.notice(`TempSensor reachable again: ${ip}/${seoj}`);
      this.updateReachable(dev, true);
      this.elClient.requestNotification(ip, seoj);
    }

    if (tempEdt !== undefined) {
      const newTemp = parseTempSensor2Byte(tempEdt);
      if (newTemp !== dev.temperature) {
        dev.temperature = newTemp;
        logger.notice(`[EL→] ${ip} TempSensor: ${newTemp ?? "N/A"}℃`);
        this.syncToMatter(dev);
      }
    }
  }

  poll(): void {
    const now = Date.now();
    for (const [, dev] of this.devices) {
      if (now - dev.lastSeen > this.reachableTimeoutMs && dev.reachable) {
        dev.reachable = false;
        logger.warn(`TempSensor unreachable: ${dev.ip}/${dev.eoj}`);
        this.updateReachable(dev, false);
      }
      this.elClient.getProperty(dev.ip, dev.eoj, TEMP_EPC.MEASURED_TEMP);
    }
  }

  private async createMatterEndpoint(dev: TempSensorState, key: string): Promise<void> {
    if (!this.aggregator) return;

    const ep = new Endpoint(
      TemperatureSensorDevice.with(BridgedDeviceBasicInformationServer),
      {
        id: `tempsensor-${key.replace(/[^a-zA-Z0-9]/g, "-")}`,
        bridgedDeviceBasicInformation: {
          nodeLabel: `温度センサー (${dev.ip})`,
          vendorName: "reomaru",
          productName: "ECHONET Lite Temperature Sensor",
          serialNumber: key,
          reachable: true,
        },
        temperatureMeasurement: {
          measuredValue: dev.temperature !== null ? celsiusToMatter(dev.temperature) : null,
          minMeasuredValue: celsiusToMatter(-10),
          maxMeasuredValue: celsiusToMatter(50),
        },
      }
    );

    await (this.aggregator as any).add(ep);
    dev.matterEndpoint = ep;
    logger.notice(`Matter TemperatureSensor endpoint created for ${dev.ip}`);
  }

  private syncToMatter(dev: TempSensorState): void {
    if (!dev.matterEndpoint) return;
    try {
      (dev.matterEndpoint as any).set({
        temperatureMeasurement: {
          measuredValue: dev.temperature !== null ? celsiusToMatter(dev.temperature) : null,
        },
      });
    } catch (e) {
      logger.error("Failed to sync temp sensor to Matter:", e);
    }
  }

  private updateReachable(dev: TempSensorState, reachable: boolean): void {
    if (!dev.matterEndpoint) return;
    try {
      (dev.matterEndpoint as any).set({ bridgedDeviceBasicInformation: { reachable } });
    } catch (e) { logger.warn("Failed to update temp sensor reachable:", e); }
  }
}

// ============================================================
// 電気錠マネージャ (EL 0x026F → Matter DoorLock)
// ============================================================
class LockManager {
  private devices = new Map<string, LockState>();
  private elClient: EchonetClient;
  private aggregator: Endpoint | null = null;
  private reachableTimeoutMs: number;
  private suppressTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private isSuppressed(key: string): boolean {
    return this.suppressTimers.has(key);
  }
  private beginSuppress(key: string, ms = 2000): void {
    const existing = this.suppressTimers.get(key);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => { this.suppressTimers.delete(key); }, ms);
    this.suppressTimers.set(key, t);
  }

  constructor(elClient: EchonetClient, opts: { reachableTimeoutSec?: number } = {}) {
    this.elClient = elClient;
    this.reachableTimeoutMs = (opts.reachableTimeoutSec ?? 120) * 1000;
  }

  setAggregator(agg: Endpoint): void { this.aggregator = agg; }

  private key(ip: string, eoj: string): string { return `${ip}_${eoj}`; }

  async handlePacket(rinfo: RInfo, els: ElData): Promise<void> {
    const ip = rinfo.address;
    const seoj = els.SEOJ;
    const classCode = seoj.substring(0, 4).toLowerCase();
    if (classCode !== "026f") return;

    const k = this.key(ip, seoj);
    const details = els.DETAILs || {};

    const lockEdt = Object.entries(details)
      .find(([epc]) => epc.toUpperCase() === LOCK_EPC.LOCK_STATUS)?.[1];

    if (!this.devices.has(k)) {
      logger.notice(`Discovered lock: ${ip} (${seoj})`);
      const state: LockState = {
        ip, eoj: seoj,
        locked: lockEdt !== "42", // 初期値: パケットにあれば反映、なければ locked
        reachable: true, lastSeen: Date.now(),
      };
      this.devices.set(k, state);
      if (!lockEdt) {
        this.elClient.getProperty(ip, seoj, LOCK_EPC.LOCK_STATUS);
      } else {
        logger.notice(`[EL→] ${ip} Lock: ${state.locked ? "LOCKED" : "UNLOCKED"}`);
      }
      if (this.aggregator) await this.createMatterEndpoint(state, k);
      return;
    }

    const dev = this.devices.get(k)!;
    const wasUnreachable = !dev.reachable;
    dev.lastSeen = Date.now();
    dev.reachable = true;
    if (wasUnreachable) {
      logger.notice(`Lock reachable again: ${ip}/${seoj}`);
      this.updateReachable(dev, true);
      this.elClient.requestNotification(ip, seoj);
    }

    if (this.isSuppressed(k)) return;

    if (lockEdt !== undefined) {
      const newLocked = lockEdt === "41";
      if (dev.locked !== newLocked) {
        dev.locked = newLocked;
        logger.notice(`[EL→] ${ip} Lock: ${newLocked ? "LOCKED" : "UNLOCKED"}`);
        this.syncToMatter(dev);
      }
    }
  }

  poll(): void {
    const now = Date.now();
    for (const [, dev] of this.devices) {
      if (now - dev.lastSeen > this.reachableTimeoutMs && dev.reachable) {
        dev.reachable = false;
        logger.warn(`Lock unreachable: ${dev.ip}/${dev.eoj}`);
        this.updateReachable(dev, false);
      }
      this.elClient.getProperty(dev.ip, dev.eoj, LOCK_EPC.LOCK_STATUS);
    }
  }

  private async createMatterEndpoint(dev: LockState, key: string): Promise<void> {
    if (!this.aggregator) return;

    const ep = new Endpoint(
      DoorLockDevice.with(BridgedDeviceBasicInformationServer),
      {
        id: `lock-${key.replace(/[^a-zA-Z0-9]/g, "-")}`,
        bridgedDeviceBasicInformation: {
          nodeLabel: `電気錠 (${dev.ip})`,
          vendorName: "reomaru",
          productName: "ECHONET Lite Door Lock",
          serialNumber: key,
          reachable: true,
        },
        doorLock: {
          lockState: dev.locked ? DoorLock.LockState.Locked : DoorLock.LockState.Unlocked,
          lockType: DoorLock.LockType.DeadBolt,
          actuatorEnabled: true,
          operatingMode: DoorLock.OperatingMode.Normal,
          supportedOperatingModes: {
            normal: false,
            vacation: false,
            privacy: false,
            noRemoteLockUnlock: false,
            passage: false,
            alwaysSet: 2047,
          },
        },
      }
    );

    ep.events.doorLock.lockState$Changed.on(async (newState: DoorLock.LockState | null) => {
      if (newState === null) return;
      const shouldLock = newState === DoorLock.LockState.Locked;
      logger.notice(`[→EL] Lock → ${shouldLock ? "LOCKED" : "UNLOCKED"}`);
      this.beginSuppress(key);
      this.elClient.setProperty(dev.ip, dev.eoj, LOCK_EPC.LOCK_STATUS, shouldLock ? "41" : "42");
      dev.locked = shouldLock;
    });

    await (this.aggregator as any).add(ep);
    dev.matterEndpoint = ep;
    logger.notice(`Matter DoorLock endpoint created for ${dev.ip}`);
  }

  private syncToMatter(dev: LockState): void {
    if (!dev.matterEndpoint) return;
    this.beginSuppress(this.key(dev.ip, dev.eoj), 1000);
    try {
      (dev.matterEndpoint as any).set({
        doorLock: {
          lockState: dev.locked ? DoorLock.LockState.Locked : DoorLock.LockState.Unlocked,
        },
      });
    } catch (e) {
      logger.error("Failed to sync lock to Matter:", e);
    }
  }

  private updateReachable(dev: LockState, reachable: boolean): void {
    if (!dev.matterEndpoint) return;
    try {
      (dev.matterEndpoint as any).set({ bridgedDeviceBasicInformation: { reachable } });
    } catch (e) { logger.warn("Failed to update lock reachable:", e); }
  }
}

// ============================================================
// 読み取り専用センサー共通基盤
// ============================================================

/** 読み取り専用センサーの共通状態 */
interface SensorStateBase {
  ip: string;
  eoj: string;
  reachable: boolean;
  lastSeen: number;
  matterEndpoint?: Endpoint;
}

/**
 * EL→Matter 一方向のセンサー系マネージャの共通実装。
 * サブクラスは EPC のパースと Matter エンドポイント定義のみを実装する。
 * (書き込みイベントハンドラなし・Suppress タイマー不要)
 */
abstract class ReadOnlySensorManager<S extends SensorStateBase> {
  protected devices = new Map<string, S>();
  protected elClient: EchonetClient;
  protected aggregator: Endpoint | null = null;
  protected reachableTimeoutMs: number;

  /** EL クラスコード (小文字4桁, 例 "0012") */
  protected abstract readonly classCode: string;
  /** ログ・ラベル表示名 */
  protected abstract readonly displayName: string;
  /** 発見時・ポーリングで取得する EPC (大文字) */
  protected abstract readonly pollEpcs: string[];

  constructor(elClient: EchonetClient, opts: { reachableTimeoutSec?: number } = {}) {
    this.elClient = elClient;
    this.reachableTimeoutMs = (opts.reachableTimeoutSec ?? 120) * 1000;
  }

  setAggregator(agg: Endpoint): void { this.aggregator = agg; }

  protected key(ip: string, eoj: string): string { return `${ip}_${eoj}`; }

  /** 初期状態を生成 */
  protected abstract createState(ip: string, eoj: string): S;
  /** 受信 EDT (EPC 大文字キー) を状態に反映。値が変化したら true */
  protected abstract applyDetails(dev: S, details: Record<string, string>): boolean;
  /** Matter エンドポイントを生成 */
  protected abstract buildEndpoint(dev: S, key: string): Endpoint;
  /** EL 状態 → Matter Attribute 更新オブジェクト */
  protected abstract attributeUpdates(dev: S): Record<string, any>;

  async handlePacket(rinfo: RInfo, els: ElData): Promise<void> {
    const ip = rinfo.address;
    const seoj = els.SEOJ;
    if (seoj.substring(0, 4).toLowerCase() !== this.classCode) return;

    const k = this.key(ip, seoj);
    const details: Record<string, string> = {};
    for (const [epc, edt] of Object.entries(els.DETAILs || {})) {
      details[epc.toUpperCase()] = edt;
    }

    if (!this.devices.has(k)) {
      logger.notice(`Discovered ${this.displayName}: ${ip} (${seoj})`);
      const state = this.createState(ip, seoj);
      this.applyDetails(state, details);
      this.devices.set(k, state);
      this.elClient.getMultiple(ip, seoj, this.pollEpcs);
      if (this.aggregator) {
        const ep = this.buildEndpoint(state, k);
        await (this.aggregator as any).add(ep);
        state.matterEndpoint = ep;
        logger.notice(`Matter ${this.displayName} endpoint created for ${ip}`);
      }
      return;
    }

    const dev = this.devices.get(k)!;
    const wasUnreachable = !dev.reachable;
    dev.lastSeen = Date.now();
    dev.reachable = true;
    if (wasUnreachable) {
      logger.notice(`${this.displayName} reachable again: ${ip}/${seoj}`);
      this.updateReachable(dev, true);
    }

    if (this.applyDetails(dev, details)) this.syncToMatter(dev);
  }

  poll(): void {
    const now = Date.now();
    for (const [, dev] of this.devices) {
      if (now - dev.lastSeen > this.reachableTimeoutMs && dev.reachable) {
        dev.reachable = false;
        logger.warn(`${this.displayName} unreachable: ${dev.ip}/${dev.eoj}`);
        this.updateReachable(dev, false);
      }
      this.elClient.getMultiple(dev.ip, dev.eoj, this.pollEpcs);
    }
  }

  protected syncToMatter(dev: S): void {
    if (!dev.matterEndpoint) return;
    try {
      (dev.matterEndpoint as any).set(this.attributeUpdates(dev));
    } catch (e) {
      logger.error(`Failed to sync ${this.displayName} to Matter:`, e);
    }
  }

  protected updateReachable(dev: S, reachable: boolean): void {
    if (!dev.matterEndpoint) return;
    try {
      (dev.matterEndpoint as any).set({ bridgedDeviceBasicInformation: { reachable } });
    } catch (e) { logger.warn(`Failed to update ${this.displayName} reachable:`, e); }
  }
}

// ============================================================
// 湿度センサーマネージャ (EL 0x0012 → Matter HumiditySensor)
// ============================================================
interface HumiditySensorState extends SensorStateBase { humidity: number | null; }

class HumiditySensorManager extends ReadOnlySensorManager<HumiditySensorState> {
  protected readonly classCode = "0012";
  protected readonly displayName = "湿度センサー";
  protected readonly pollEpcs = ["E0"];

  protected createState(ip: string, eoj: string): HumiditySensorState {
    return { ip, eoj, humidity: null, reachable: true, lastSeen: Date.now() };
  }

  protected applyDetails(dev: HumiditySensorState, details: Record<string, string>): boolean {
    const edt = details["E0"];
    if (edt === undefined) return false;
    const h = parseHumidityPercent(edt);
    if (h === dev.humidity) return false;
    dev.humidity = h;
    logger.notice(`[EL→] ${dev.ip} Humidity: ${h ?? "N/A"}%`);
    return true;
  }

  protected buildEndpoint(dev: HumiditySensorState, key: string): Endpoint {
    return new Endpoint(
      HumiditySensorDevice.with(BridgedDeviceBasicInformationServer),
      {
        id: `humidity-${key.replace(/[^a-zA-Z0-9]/g, "-")}`,
        bridgedDeviceBasicInformation: {
          nodeLabel: `湿度センサー (${dev.ip})`,
          vendorName: "reomaru",
          productName: "ECHONET Lite Humidity Sensor",
          serialNumber: key,
          reachable: true,
        },
        relativeHumidityMeasurement: {
          // Matter は 0.01% 単位 (0-10000)
          measuredValue: dev.humidity !== null ? dev.humidity * 100 : null,
          minMeasuredValue: 0,
          maxMeasuredValue: 10000,
        },
      }
    );
  }

  protected attributeUpdates(dev: HumiditySensorState): Record<string, any> {
    return {
      relativeHumidityMeasurement: {
        measuredValue: dev.humidity !== null ? dev.humidity * 100 : null,
      },
    };
  }
}

// ============================================================
// 人体検知センサーマネージャ (EL 0x0007 → Matter OccupancySensor)
// ============================================================
interface OccupancySensorState extends SensorStateBase { occupied: boolean; }

class OccupancySensorManager extends ReadOnlySensorManager<OccupancySensorState> {
  protected readonly classCode = "0007";
  protected readonly displayName = "人体検知センサー";
  protected readonly pollEpcs = ["B1"];

  protected createState(ip: string, eoj: string): OccupancySensorState {
    return { ip, eoj, occupied: false, reachable: true, lastSeen: Date.now() };
  }

  protected applyDetails(dev: OccupancySensorState, details: Record<string, string>): boolean {
    const edt = details["B1"];
    if (edt !== "41" && edt !== "42") return false;
    const occupied = edt === "41";
    if (occupied === dev.occupied) return false;
    dev.occupied = occupied;
    logger.notice(`[EL→] ${dev.ip} Occupancy: ${occupied ? "DETECTED" : "CLEAR"}`);
    return true;
  }

  protected buildEndpoint(dev: OccupancySensorState, key: string): Endpoint {
    return new Endpoint(
      // OccupancySensorDevice は OccupancySensing がデフォルト合成されないため明示的に追加
      // (クラスターリビジョン5以降は検知方式 Feature の指定が必須)
      OccupancySensorDevice.with(
        OccupancySensingServer.with("PassiveInfrared"),
        BridgedDeviceBasicInformationServer,
      ),
      {
        id: `occupancy-${key.replace(/[^a-zA-Z0-9]/g, "-")}`,
        bridgedDeviceBasicInformation: {
          nodeLabel: `人感センサー (${dev.ip})`,
          vendorName: "reomaru",
          productName: "ECHONET Lite Occupancy Sensor",
          serialNumber: key,
          reachable: true,
        },
        occupancySensing: {
          occupancy: { occupied: dev.occupied },
          occupancySensorType: OccupancySensing.OccupancySensorType.Pir,
          occupancySensorTypeBitmap: { pir: true },
        },
      }
    );
  }

  protected attributeUpdates(dev: OccupancySensorState): Record<string, any> {
    return { occupancySensing: { occupancy: { occupied: dev.occupied } } };
  }
}

// ============================================================
// 照度センサーマネージャ (EL 0x00D0 → Matter LightSensor)
// ============================================================
interface IlluminanceSensorState extends SensorStateBase { lux: number | null; }

class IlluminanceSensorManager extends ReadOnlySensorManager<IlluminanceSensorState> {
  protected readonly classCode = "00d0";
  protected readonly displayName = "照度センサー";
  protected readonly pollEpcs = ["E0", "E1"]; // 0xE0: lux単位, 0xE1: klx単位 (どちらか一方の実装で可)

  protected createState(ip: string, eoj: string): IlluminanceSensorState {
    return { ip, eoj, lux: null, reachable: true, lastSeen: Date.now() };
  }

  protected applyDetails(dev: IlluminanceSensorState, details: Record<string, string>): boolean {
    let newLux: number | null | undefined;
    if (details["E0"] !== undefined) {
      newLux = parseUint16Measurement(details["E0"]);
    } else if (details["E1"] !== undefined) {
      const klx = parseUint16Measurement(details["E1"]);
      newLux = klx !== null ? klx * 1000 : null;
    }
    if (newLux === undefined || newLux === dev.lux) return false;
    dev.lux = newLux;
    logger.notice(`[EL→] ${dev.ip} Illuminance: ${newLux ?? "N/A"} lux`);
    return true;
  }

  protected buildEndpoint(dev: IlluminanceSensorState, key: string): Endpoint {
    return new Endpoint(
      LightSensorDevice.with(BridgedDeviceBasicInformationServer),
      {
        id: `illuminance-${key.replace(/[^a-zA-Z0-9]/g, "-")}`,
        bridgedDeviceBasicInformation: {
          nodeLabel: `照度センサー (${dev.ip})`,
          vendorName: "reomaru",
          productName: "ECHONET Lite Light Sensor",
          serialNumber: key,
          reachable: true,
        },
        illuminanceMeasurement: {
          // Matter は対数値 (10000×log10(lux)+1)
          measuredValue: dev.lux !== null ? luxToMatter(dev.lux) : null,
          minMeasuredValue: 1,
          maxMeasuredValue: 65534,
        },
      }
    );
  }

  protected attributeUpdates(dev: IlluminanceSensorState): Record<string, any> {
    return {
      illuminanceMeasurement: {
        measuredValue: dev.lux !== null ? luxToMatter(dev.lux) : null,
      },
    };
  }
}

// ============================================================
// CO2センサーマネージャ (EL 0x001B → Matter AirQualitySensor)
// ============================================================
interface Co2SensorState extends SensorStateBase { ppm: number | null; }

class Co2SensorManager extends ReadOnlySensorManager<Co2SensorState> {
  protected readonly classCode = "001b";
  protected readonly displayName = "CO2センサー";
  protected readonly pollEpcs = ["E0"];

  protected createState(ip: string, eoj: string): Co2SensorState {
    return { ip, eoj, ppm: null, reachable: true, lastSeen: Date.now() };
  }

  protected applyDetails(dev: Co2SensorState, details: Record<string, string>): boolean {
    const edt = details["E0"];
    if (edt === undefined) return false;
    const ppm = parseUint16Measurement(edt);
    if (ppm === dev.ppm) return false;
    dev.ppm = ppm;
    logger.notice(`[EL→] ${dev.ip} CO2: ${ppm ?? "N/A"} ppm`);
    return true;
  }

  protected buildEndpoint(dev: Co2SensorState, key: string): Endpoint {
    return new Endpoint(
      AirQualitySensorDevice.with(
        AirQualityServer.with("Fair", "Moderate"),
        CarbonDioxideConcentrationMeasurementServer.with("NumericMeasurement"),
        BridgedDeviceBasicInformationServer,
      ),
      {
        id: `co2-${key.replace(/[^a-zA-Z0-9]/g, "-")}`,
        bridgedDeviceBasicInformation: {
          nodeLabel: `CO2センサー (${dev.ip})`,
          vendorName: "reomaru",
          productName: "ECHONET Lite CO2 Sensor",
          serialNumber: key,
          reachable: true,
        },
        airQuality: {
          airQuality: dev.ppm !== null ? co2ToAirQuality(dev.ppm) : AirQuality.AirQualityEnum.Unknown,
        },
        carbonDioxideConcentrationMeasurement: {
          measuredValue: dev.ppm,
          minMeasuredValue: 0,
          maxMeasuredValue: 65533,
          measurementUnit: ConcentrationMeasurement.MeasurementUnit.Ppm,
          measurementMedium: ConcentrationMeasurement.MeasurementMedium.Air,
        },
      }
    );
  }

  protected attributeUpdates(dev: Co2SensorState): Record<string, any> {
    return {
      airQuality: {
        airQuality: dev.ppm !== null ? co2ToAirQuality(dev.ppm) : AirQuality.AirQualityEnum.Unknown,
      },
      carbonDioxideConcentrationMeasurement: { measuredValue: dev.ppm },
    };
  }
}

// ============================================================
// 防犯センサーマネージャ (EL 0x0002 → Matter ContactSensor)
// ============================================================
interface ContactSensorState extends SensorStateBase { intrusion: boolean; }

class SecuritySensorManager extends ReadOnlySensorManager<ContactSensorState> {
  protected readonly classCode = "0002";
  protected readonly displayName = "防犯センサー";
  protected readonly pollEpcs = ["B1"];

  protected createState(ip: string, eoj: string): ContactSensorState {
    return { ip, eoj, intrusion: false, reachable: true, lastSeen: Date.now() };
  }

  protected applyDetails(dev: ContactSensorState, details: Record<string, string>): boolean {
    const edt = details["B1"]; // 侵入発生状態: 0x41=検知, 0x42=非検知
    if (edt !== "41" && edt !== "42") return false;
    const intrusion = edt === "41";
    if (intrusion === dev.intrusion) return false;
    dev.intrusion = intrusion;
    logger.notice(`[EL→] ${dev.ip} Security: ${intrusion ? "INTRUSION DETECTED" : "CLEAR"}`);
    return true;
  }

  protected buildEndpoint(dev: ContactSensorState, key: string): Endpoint {
    return new Endpoint(
      ContactSensorDevice.with(BridgedDeviceBasicInformationServer),
      {
        id: `security-${key.replace(/[^a-zA-Z0-9]/g, "-")}`,
        bridgedDeviceBasicInformation: {
          nodeLabel: `防犯センサー (${dev.ip})`,
          vendorName: "reomaru",
          productName: "ECHONET Lite Security Sensor",
          serialNumber: key,
          reachable: true,
        },
        // Matter BooleanState: true=閉(正常) / false=開。侵入検知を「開」として通知する
        booleanState: { stateValue: !dev.intrusion },
      }
    );
  }

  protected attributeUpdates(dev: ContactSensorState): Record<string, any> {
    return { booleanState: { stateValue: !dev.intrusion } };
  }
}

// ============================================================
// 単機能照明マネージャ (EL 0x0291 → Matter OnOffLight)
// ============================================================
class MonoLightManager {
  private devices = new Map<string, MonoLightState>();
  private elClient: EchonetClient;
  private aggregator: Endpoint | null = null;
  private reachableTimeoutMs: number;

  constructor(elClient: EchonetClient, opts: { reachableTimeoutSec?: number } = {}) {
    this.elClient = elClient;
    this.reachableTimeoutMs = (opts.reachableTimeoutSec ?? 120) * 1000;
  }

  setAggregator(agg: Endpoint): void { this.aggregator = agg; }

  private key(ip: string, eoj: string): string { return `${ip}_${eoj}`; }

  async handlePacket(rinfo: RInfo, els: ElData): Promise<void> {
    const ip = rinfo.address;
    const seoj = els.SEOJ;
    if (seoj.substring(0, 4) !== "0291") return;

    const k = this.key(ip, seoj);
    const details = els.DETAILs || {};

    const powerEdt = Object.entries(details)
      .find(([epc]) => epc.toUpperCase() === LIGHT_EPC.OPERATION_STATUS)?.[1];

    if (!this.devices.has(k)) {
      logger.notice(`Discovered mono light: ${ip} (${seoj})`);
      const state: MonoLightState = {
        ip, eoj: seoj,
        power: powerEdt === "30",
        reachable: true, lastSeen: Date.now(),
      };
      this.devices.set(k, state);
      if (!powerEdt) this.elClient.getProperty(ip, seoj, LIGHT_EPC.OPERATION_STATUS);
      else logger.notice(`[EL→] ${ip} MonoLight: ${state.power ? "ON" : "OFF"}`);
      if (this.aggregator) await this.createMatterEndpoint(state, k);
      return;
    }

    const dev = this.devices.get(k)!;
    const wasUnreachable = !dev.reachable;
    dev.lastSeen = Date.now();
    dev.reachable = true;
    if (wasUnreachable) {
      logger.notice(`MonoLight reachable again: ${ip}/${seoj}`);
      this.updateReachable(dev, true);
      this.elClient.requestNotification(ip, seoj);
    }

    if (powerEdt !== undefined) {
      const newPower = powerEdt === "30";
      if (dev.power !== newPower) {
        dev.power = newPower;
        logger.notice(`[EL→] ${ip} MonoLight: ${newPower ? "ON" : "OFF"}`);
        this.syncToMatter(dev);
      }
    }
  }

  poll(): void {
    const now = Date.now();
    for (const [, dev] of this.devices) {
      if (now - dev.lastSeen > this.reachableTimeoutMs && dev.reachable) {
        dev.reachable = false;
        logger.warn(`MonoLight unreachable: ${dev.ip}/${dev.eoj}`);
        this.updateReachable(dev, false);
      }
      this.elClient.getProperty(dev.ip, dev.eoj, LIGHT_EPC.OPERATION_STATUS);
    }
  }

  private async createMatterEndpoint(dev: MonoLightState, key: string): Promise<void> {
    if (!this.aggregator) return;

    const ep = new Endpoint(
      OnOffLightDevice.with(BridgedDeviceBasicInformationServer),
      {
        id: `monolight-${key.replace(/[^a-zA-Z0-9]/g, "-")}`,
        bridgedDeviceBasicInformation: {
          nodeLabel: `照明 (${dev.ip})`,
          vendorName: "reomaru",
          productName: "ECHONET Lite Mono Light",
          serialNumber: key,
          reachable: true,
        },
        onOff: { onOff: dev.power },
      }
    );

    // ON/OFF 変化 → EL SetC 0x80
    // dev.power と一致する場合は syncToMatter() 起因の変化なのでスキップ
    ep.events.onOff.onOff$Changed.on(async (newVal: boolean) => {
      if (dev.power === newVal) return;
      logger.notice(`[→EL] MonoLight onOff → ${newVal}`);
      this.elClient.setProperty(dev.ip, dev.eoj, LIGHT_EPC.OPERATION_STATUS, newVal ? "30" : "31");
      dev.power = newVal;
    });

    await (this.aggregator as any).add(ep);
    dev.matterEndpoint = ep;
    logger.notice(`Matter OnOffLight endpoint created for ${dev.ip}`);
  }

  private syncToMatter(dev: MonoLightState): void {
    if (!dev.matterEndpoint) return;
    try {
      (dev.matterEndpoint as any).set({ onOff: { onOff: dev.power } });
    } catch (e) {
      logger.error("Failed to sync mono light to Matter:", e);
    }
  }

  private updateReachable(dev: MonoLightState, reachable: boolean): void {
    if (!dev.matterEndpoint) return;
    try {
      (dev.matterEndpoint as any).set({ bridgedDeviceBasicInformation: { reachable } });
    } catch (e) { logger.warn("Failed to update mono light reachable:", e); }
  }
}

// ============================================================
// 換気扇/空気清浄器マネージャ
// (EL 0x0133 → Matter Fan / EL 0x0135 → Matter AirPurifier)
// ============================================================
class FanDeviceManager {
  private devices = new Map<string, FanLikeState>();
  private elClient: EchonetClient;
  private aggregator: Endpoint | null = null;
  private reachableTimeoutMs: number;
  private suppressTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private isSuppressed(key: string): boolean {
    return this.suppressTimers.has(key);
  }
  private beginSuppress(key: string, ms = 2000): void {
    const existing = this.suppressTimers.get(key);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => { this.suppressTimers.delete(key); }, ms);
    this.suppressTimers.set(key, t);
  }

  constructor(elClient: EchonetClient, opts: { reachableTimeoutSec?: number } = {}) {
    this.elClient = elClient;
    this.reachableTimeoutMs = (opts.reachableTimeoutSec ?? 120) * 1000;
  }

  setAggregator(agg: Endpoint): void { this.aggregator = agg; }

  private key(ip: string, eoj: string): string { return `${ip}_${eoj}`; }

  async handlePacket(rinfo: RInfo, els: ElData): Promise<void> {
    const ip = rinfo.address;
    const seoj = els.SEOJ;
    const classCode = seoj.substring(0, 4);
    if (classCode !== "0133" && classCode !== "0135") return;
    const kind: FanLikeState["kind"] = classCode === "0135" ? "airPurifier" : "fan";

    const k = this.key(ip, seoj);
    const details = els.DETAILs || {};

    const powerEdt = Object.entries(details)
      .find(([epc]) => epc.toUpperCase() === FAN_EPC.OPERATION_STATUS)?.[1];
    const airFlowEdt = Object.entries(details)
      .find(([epc]) => epc.toUpperCase() === FAN_EPC.AIR_FLOW)?.[1];

    if (!this.devices.has(k)) {
      logger.notice(`Discovered ${kind}: ${ip} (${seoj})`);
      const initAirFlow = airFlowEdt !== undefined ? parseInt(airFlowEdt, 16) : NaN;
      const state: FanLikeState = {
        ip, eoj: seoj, kind,
        power: powerEdt === "30",
        airFlow: !isNaN(initAirFlow) ? initAirFlow : 0x41, // 既定: 自動
        reachable: true, lastSeen: Date.now(),
      };
      this.devices.set(k, state);
      this.elClient.getMultiple(ip, seoj, [FAN_EPC.OPERATION_STATUS, FAN_EPC.AIR_FLOW]);
      if (this.aggregator) await this.createMatterEndpoint(state, k);
      return;
    }

    const dev = this.devices.get(k)!;
    const wasUnreachable = !dev.reachable;
    dev.lastSeen = Date.now();
    dev.reachable = true;
    if (wasUnreachable) {
      logger.notice(`${dev.kind} reachable again: ${ip}/${seoj}`);
      this.updateReachable(dev, true);
      this.elClient.requestNotification(ip, seoj);
    }

    if (this.isSuppressed(k)) return;

    let changed = false;
    if (powerEdt !== undefined) {
      const newPower = powerEdt === "30";
      if (dev.power !== newPower) {
        dev.power = newPower;
        logger.notice(`[EL→] ${ip} ${dev.kind}: ${newPower ? "ON" : "OFF"}`);
        changed = true;
      }
    }
    if (airFlowEdt !== undefined) {
      const newAirFlow = parseInt(airFlowEdt, 16);
      const valid = newAirFlow === 0x41 || (newAirFlow >= 0x31 && newAirFlow <= 0x38);
      if (valid && dev.airFlow !== newAirFlow) {
        dev.airFlow = newAirFlow;
        logger.notice(`[EL→] ${ip} ${dev.kind} airflow: ${newAirFlow === 0x41 ? "Auto" : `Lv${newAirFlow - 0x30}`}`);
        changed = true;
      }
    }

    if (changed) this.syncToMatter(dev);
  }

  poll(): void {
    const now = Date.now();
    for (const [, dev] of this.devices) {
      if (now - dev.lastSeen > this.reachableTimeoutMs && dev.reachable) {
        dev.reachable = false;
        logger.warn(`${dev.kind} unreachable: ${dev.ip}/${dev.eoj}`);
        this.updateReachable(dev, false);
      }
      this.elClient.getMultiple(dev.ip, dev.eoj, [FAN_EPC.OPERATION_STATUS, FAN_EPC.AIR_FLOW]);
    }
  }

  private async createMatterEndpoint(dev: FanLikeState, key: string): Promise<void> {
    if (!this.aggregator) return;

    const isFan = dev.kind === "fan";
    const fanControlInit = {
      fanMode: dev.power ? elAirFlowToFanMode(dev.airFlow) : FanControl.FanMode.Off,
      fanModeSequence: FanControl.FanModeSequence.OffLowMedHighAuto,
      // 自動運転中の実風量は EL から取得できないため 50% を表示値とする
      percentSetting: !dev.power ? 0 : dev.airFlow === 0x41 ? null : elAirFlowToPercent(dev.airFlow),
      percentCurrent: !dev.power ? 0 : dev.airFlow === 0x41 ? 50 : elAirFlowToPercent(dev.airFlow),
    };
    const config = {
      id: `${isFan ? "fan" : "airpurifier"}-${key.replace(/[^a-zA-Z0-9]/g, "-")}`,
      bridgedDeviceBasicInformation: {
        nodeLabel: `${isFan ? "換気扇" : "空気清浄機"} (${dev.ip})`,
        vendorName: "reomaru",
        productName: isFan ? "ECHONET Lite Ventilation Fan" : "ECHONET Lite Air Purifier",
        serialNumber: key,
        reachable: true,
      },
      fanControl: fanControlInit,
    };

    const ep = isFan
      ? new Endpoint(
          FanDevice.with(FanControlServer.with("Auto"), BridgedDeviceBasicInformationServer),
          config as any)
      : new Endpoint(
          AirPurifierDevice.with(FanControlServer.with("Auto"), BridgedDeviceBasicInformationServer),
          config as any);

    // FanMode 変化 → EL 0x80 (電源) + 0xA0 (風量)
    (ep as any).events.fanControl.fanMode$Changed.on(async (newMode: FanControl.FanMode) => {
      const expected = dev.power ? elAirFlowToFanMode(dev.airFlow) : FanControl.FanMode.Off;
      if (newMode === expected) return; // syncToMatter() 起因の変化
      logger.notice(`[→EL] ${dev.kind} fanMode → ${newMode}`);
      this.beginSuppress(key);

      if (newMode === FanControl.FanMode.Off) {
        this.elClient.setProperty(dev.ip, dev.eoj, FAN_EPC.OPERATION_STATUS, "31");
        dev.power = false;
        return;
      }
      if (!dev.power) {
        this.elClient.setProperty(dev.ip, dev.eoj, FAN_EPC.OPERATION_STATUS, "30");
        dev.power = true;
      }
      // Low/Medium/High は代表レベル (Lv2/Lv5/Lv8) に割り当てる
      let airFlow: number | null = null;
      switch (newMode) {
        case FanControl.FanMode.Auto:   airFlow = 0x41; break;
        case FanControl.FanMode.Low:    airFlow = 0x32; break;
        case FanControl.FanMode.Medium: airFlow = 0x35; break;
        case FanControl.FanMode.High:   airFlow = 0x38; break;
        default: break; // On 等は電源ONのみ
      }
      if (airFlow !== null && airFlow !== dev.airFlow) {
        this.elClient.setProperty(
          dev.ip, dev.eoj, FAN_EPC.AIR_FLOW, airFlow.toString(16).padStart(2, "0"));
        dev.airFlow = airFlow;
      }
    });

    // パーセント指定 → EL 0xA0 (8段階に量子化)。0% は電源OFF
    (ep as any).events.fanControl.percentSetting$Changed.on(async (newPercent: number | null) => {
      if (newPercent === null) return;
      if (newPercent === 0) {
        if (!dev.power) return;
        logger.notice(`[→EL] ${dev.kind} percent → 0 (OFF)`);
        this.beginSuppress(key);
        this.elClient.setProperty(dev.ip, dev.eoj, FAN_EPC.OPERATION_STATUS, "31");
        dev.power = false;
        return;
      }
      const airFlow = percentToElAirFlow(newPercent);
      if (dev.power && airFlow === dev.airFlow) return;
      logger.notice(`[→EL] ${dev.kind} percent → ${newPercent}% (Lv${airFlow - 0x30})`);
      this.beginSuppress(key);
      if (!dev.power) {
        this.elClient.setProperty(dev.ip, dev.eoj, FAN_EPC.OPERATION_STATUS, "30");
        dev.power = true;
      }
      this.elClient.setProperty(
        dev.ip, dev.eoj, FAN_EPC.AIR_FLOW, airFlow.toString(16).padStart(2, "0"));
      dev.airFlow = airFlow;
    });

    await (this.aggregator as any).add(ep);
    dev.matterEndpoint = ep;
    logger.notice(`Matter ${isFan ? "Fan" : "AirPurifier"} endpoint created for ${dev.ip}`);
  }

  private syncToMatter(dev: FanLikeState): void {
    if (!dev.matterEndpoint) return;
    this.beginSuppress(this.key(dev.ip, dev.eoj), 1000);
    try {
      const fc: Record<string, any> = {};
      if (!dev.power) {
        fc.fanMode = FanControl.FanMode.Off;
        fc.percentSetting = 0;
        fc.percentCurrent = 0;
      } else if (dev.airFlow === 0x41) {
        fc.fanMode = FanControl.FanMode.Auto;
        fc.percentSetting = null;
        fc.percentCurrent = 50; // 自動運転中の実風量は不明
      } else {
        const percent = elAirFlowToPercent(dev.airFlow);
        fc.fanMode = elAirFlowToFanMode(dev.airFlow);
        fc.percentSetting = percent;
        fc.percentCurrent = percent;
      }
      (dev.matterEndpoint as any).set({ fanControl: fc });
    } catch (e) {
      logger.error(`Failed to sync ${dev.kind} to Matter:`, e);
    }
  }

  private updateReachable(dev: FanLikeState, reachable: boolean): void {
    if (!dev.matterEndpoint) return;
    try {
      (dev.matterEndpoint as any).set({ bridgedDeviceBasicInformation: { reachable } });
    } catch (e) { logger.warn(`Failed to update ${dev.kind} reachable:`, e); }
  }
}

// ============================================================
// 床暖房マネージャ (EL 0x027B → Matter Thermostat, Heating専用)
// ============================================================

/** 床暖房 温度設定2 (レベル 1-15) → ℃ の近似変換 (10-38℃ に線形写像) */
function floorHeaterLevelToTemp(level: number): number {
  return 10 + (Math.max(1, Math.min(15, level)) - 1) * 2;
}

/** ℃ → 床暖房 温度設定2 (レベル 1-15) */
function floorHeaterTempToLevel(temp: number): number {
  return Math.max(1, Math.min(15, Math.round((temp - 10) / 2) + 1));
}

class FloorHeaterManager {
  private devices = new Map<string, FloorHeaterState>();
  private elClient: EchonetClient;
  private aggregator: Endpoint | null = null;
  private reachableTimeoutMs: number;
  private suppressTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private isSuppressed(key: string): boolean {
    return this.suppressTimers.has(key);
  }
  private beginSuppress(key: string, ms = 2000): void {
    const existing = this.suppressTimers.get(key);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => { this.suppressTimers.delete(key); }, ms);
    this.suppressTimers.set(key, t);
  }

  constructor(elClient: EchonetClient, opts: { reachableTimeoutSec?: number } = {}) {
    this.elClient = elClient;
    this.reachableTimeoutMs = (opts.reachableTimeoutSec ?? 120) * 1000;
  }

  setAggregator(agg: Endpoint): void { this.aggregator = agg; }

  private key(ip: string, eoj: string): string { return `${ip}_${eoj}`; }

  async handlePacket(rinfo: RInfo, els: ElData): Promise<void> {
    const ip = rinfo.address;
    const seoj = els.SEOJ;
    if (seoj.substring(0, 4).toLowerCase() !== "027b") return;

    const k = this.key(ip, seoj);
    const details: Record<string, string> = {};
    for (const [epc, edt] of Object.entries(els.DETAILs || {})) {
      details[epc.toUpperCase()] = edt;
    }

    if (!this.devices.has(k)) {
      logger.notice(`Discovered floor heater: ${ip} (${seoj})`);
      const state: FloorHeaterState = {
        ip, eoj: seoj,
        power: details[FLOOR_HEATER_EPC.OPERATION_STATUS] === "30",
        targetTemp: 25,
        usesLevelSetpoint: false,
        roomTemp: null,
        reachable: true, lastSeen: Date.now(),
      };
      this.applyDetails(state, details);
      this.devices.set(k, state);
      this.elClient.getMultiple(ip, seoj, [
        FLOOR_HEATER_EPC.OPERATION_STATUS,
        FLOOR_HEATER_EPC.TEMP_SETTING_1,
        FLOOR_HEATER_EPC.TEMP_SETTING_2,
        FLOOR_HEATER_EPC.ROOM_TEMP,
      ]);
      if (this.aggregator) await this.createMatterEndpoint(state, k);
      return;
    }

    const dev = this.devices.get(k)!;
    const wasUnreachable = !dev.reachable;
    dev.lastSeen = Date.now();
    dev.reachable = true;
    if (wasUnreachable) {
      logger.notice(`Floor heater reachable again: ${ip}/${seoj}`);
      this.updateReachable(dev, true);
      this.elClient.requestNotification(ip, seoj);
    }

    if (this.isSuppressed(k)) return;

    if (this.applyDetails(dev, details)) this.syncToMatter(dev);
  }

  /** 受信 EDT を状態に反映。変化があれば true */
  private applyDetails(dev: FloorHeaterState, details: Record<string, string>): boolean {
    let changed = false;

    const powerEdt = details[FLOOR_HEATER_EPC.OPERATION_STATUS];
    if (powerEdt !== undefined) {
      const newPower = powerEdt === "30";
      if (dev.power !== newPower) {
        dev.power = newPower;
        logger.notice(`[EL→] ${dev.ip} FloorHeater: ${newPower ? "ON" : "OFF"}`);
        changed = true;
      }
    }

    // 温度設定1 (℃型) を優先。0x41 (自動) は現在値を維持
    const temp1Edt = details[FLOOR_HEATER_EPC.TEMP_SETTING_1];
    if (temp1Edt !== undefined) {
      const raw = parseInt(temp1Edt, 16);
      if (raw >= 0 && raw <= 50) {
        dev.usesLevelSetpoint = false;
        if (dev.targetTemp !== raw) {
          dev.targetTemp = raw;
          logger.notice(`[EL→] ${dev.ip} FloorHeater target: ${raw}℃`);
          changed = true;
        }
      }
    } else {
      // ℃型の応答がない機器はレベル型 (温度設定2) を使用
      const temp2Edt = details[FLOOR_HEATER_EPC.TEMP_SETTING_2];
      if (temp2Edt !== undefined) {
        const raw = parseInt(temp2Edt, 16);
        if (raw >= 0x31 && raw <= 0x3f) {
          dev.usesLevelSetpoint = true;
          const temp = floorHeaterLevelToTemp(raw - 0x30);
          if (dev.targetTemp !== temp) {
            dev.targetTemp = temp;
            logger.notice(`[EL→] ${dev.ip} FloorHeater target: Lv${raw - 0x30} (≈${temp}℃)`);
            changed = true;
          }
        }
      }
    }

    const roomEdt = details[FLOOR_HEATER_EPC.ROOM_TEMP];
    if (roomEdt !== undefined) {
      const t = parseTemperature(roomEdt);
      if (t !== dev.roomTemp) {
        dev.roomTemp = t;
        logger.debug(`[EL→] ${dev.ip} FloorHeater room: ${t ?? "N/A"}℃`);
        changed = true;
      }
    }

    return changed;
  }

  poll(): void {
    const now = Date.now();
    for (const [, dev] of this.devices) {
      if (now - dev.lastSeen > this.reachableTimeoutMs && dev.reachable) {
        dev.reachable = false;
        logger.warn(`Floor heater unreachable: ${dev.ip}/${dev.eoj}`);
        this.updateReachable(dev, false);
      }
      this.elClient.getMultiple(dev.ip, dev.eoj, [
        FLOOR_HEATER_EPC.OPERATION_STATUS,
        dev.usesLevelSetpoint ? FLOOR_HEATER_EPC.TEMP_SETTING_2 : FLOOR_HEATER_EPC.TEMP_SETTING_1,
        FLOOR_HEATER_EPC.ROOM_TEMP,
      ]);
    }
  }

  private async createMatterEndpoint(dev: FloorHeaterState, key: string): Promise<void> {
    if (!this.aggregator) return;

    const MIN_HEAT = celsiusToMatter(10);
    const MAX_HEAT = celsiusToMatter(40);
    const clampSetpoint = (c: number) =>
      Math.max(MIN_HEAT, Math.min(MAX_HEAT, celsiusToMatter(c)));

    const ep = new Endpoint(
      ThermostatDevice.with(
        ThermostatServer.with("Heating"),
        BridgedDeviceBasicInformationServer,
      ),
      {
        id: `floorheater-${key.replace(/[^a-zA-Z0-9]/g, "-")}`,
        bridgedDeviceBasicInformation: {
          nodeLabel: `床暖房 (${dev.ip})`,
          vendorName: "reomaru",
          productName: "ECHONET Lite Floor Heater",
          serialNumber: key,
          reachable: true,
        },
        thermostat: {
          localTemperature: celsiusToMatter(dev.roomTemp ?? dev.targetTemp),
          occupiedHeatingSetpoint: clampSetpoint(dev.targetTemp),
          systemMode: dev.power ? Thermostat.SystemMode.Heat : Thermostat.SystemMode.Off,
          controlSequenceOfOperation: Thermostat.ControlSequenceOfOperation.HeatingOnly,
          // absMax のデフォルトは 30℃ のため、40℃ まで許容するよう明示設定
          absMinHeatSetpointLimit: MIN_HEAT,
          absMaxHeatSetpointLimit: MAX_HEAT,
          minHeatSetpointLimit: MIN_HEAT,
          maxHeatSetpointLimit: MAX_HEAT,
        },
      }
    );

    // SystemMode 変更 → EL 0x80 (Heat=ON / Off=OFF)
    ep.events.thermostat.systemMode$Changed.on(async (newMode: Thermostat.SystemMode) => {
      const newPower = newMode !== Thermostat.SystemMode.Off;
      if (newPower === dev.power) return;
      logger.notice(`[→EL] FloorHeater → ${newPower ? "ON" : "OFF"}`);
      this.beginSuppress(key);
      this.elClient.setProperty(
        dev.ip, dev.eoj, FLOOR_HEATER_EPC.OPERATION_STATUS, newPower ? "30" : "31");
      dev.power = newPower;
    });

    // 暖房設定温度変更 → EL 0xE0 (℃型) または 0xE1 (レベル型)
    ep.events.thermostat.occupiedHeatingSetpoint$Changed.on(async (newVal: number) => {
      const celsius = matterToCelsius(newVal);
      if (Math.round(celsius) === Math.round(dev.targetTemp)) return;
      logger.notice(`[→EL] FloorHeater setpoint → ${celsius}℃`);
      this.beginSuppress(key);
      if (dev.usesLevelSetpoint) {
        const level = floorHeaterTempToLevel(celsius);
        this.elClient.setProperty(
          dev.ip, dev.eoj, FLOOR_HEATER_EPC.TEMP_SETTING_2,
          (0x30 + level).toString(16).padStart(2, "0"));
        dev.targetTemp = floorHeaterLevelToTemp(level);
      } else {
        this.elClient.setProperty(
          dev.ip, dev.eoj, FLOOR_HEATER_EPC.TEMP_SETTING_1, celsiusToElHex(celsius));
        dev.targetTemp = Math.round(celsius);
      }
    });

    await (this.aggregator as any).add(ep);
    dev.matterEndpoint = ep;
    logger.notice(`Matter Thermostat (heating) endpoint created for ${dev.ip}`);
  }

  private syncToMatter(dev: FloorHeaterState): void {
    if (!dev.matterEndpoint) return;
    this.beginSuppress(this.key(dev.ip, dev.eoj), 1000);
    try {
      const MIN_HEAT = celsiusToMatter(10);
      const MAX_HEAT = celsiusToMatter(40);
      (dev.matterEndpoint as any).set({
        thermostat: {
          localTemperature: celsiusToMatter(dev.roomTemp ?? dev.targetTemp),
          occupiedHeatingSetpoint:
            Math.max(MIN_HEAT, Math.min(MAX_HEAT, celsiusToMatter(dev.targetTemp))),
          systemMode: dev.power ? Thermostat.SystemMode.Heat : Thermostat.SystemMode.Off,
        },
      });
    } catch (e) {
      logger.error("Failed to sync floor heater to Matter:", e);
    }
  }

  private updateReachable(dev: FloorHeaterState, reachable: boolean): void {
    if (!dev.matterEndpoint) return;
    try {
      (dev.matterEndpoint as any).set({ bridgedDeviceBasicInformation: { reachable } });
    } catch (e) { logger.warn("Failed to update floor heater reachable:", e); }
  }
}

// ============================================================
// メインエントリポイント
// ============================================================
async function main() {
  // ---- 設定 ----
  const MATTER_PORT = 5540;         // Alexa互換のため5540推奨
  const POLL_INTERVAL_SEC = 30;     // ポーリング間隔
  const SEARCH_INTERVAL_SEC = 60;   // デバイス探索間隔
  const REACHABLE_TIMEOUT_SEC = 120;// 到達不能判定

  // ---- Echonet Lite クライアント ----
  const elClient = new EchonetClient();

  // ---- 全デバイスマネージャ ----
  const airconManager = new AirconManager(elClient, {
    pollIntervalSec: POLL_INTERVAL_SEC,
    reachableTimeoutSec: REACHABLE_TIMEOUT_SEC,
  });
  const lightManager = new LightManager(elClient, {
    reachableTimeoutSec: REACHABLE_TIMEOUT_SEC,
  });
  const blindManager = new BlindManager(elClient, {
    reachableTimeoutSec: REACHABLE_TIMEOUT_SEC,
  });
  const tempSensorManager = new TempSensorManager(elClient, {
    reachableTimeoutSec: REACHABLE_TIMEOUT_SEC,
  });
  const lockManager = new LockManager(elClient, {
    reachableTimeoutSec: REACHABLE_TIMEOUT_SEC,
  });
  const monoLightManager = new MonoLightManager(elClient, {
    reachableTimeoutSec: REACHABLE_TIMEOUT_SEC,
  });
  const humiditySensorManager = new HumiditySensorManager(elClient, {
    reachableTimeoutSec: REACHABLE_TIMEOUT_SEC,
  });
  const occupancySensorManager = new OccupancySensorManager(elClient, {
    reachableTimeoutSec: REACHABLE_TIMEOUT_SEC,
  });
  const illuminanceSensorManager = new IlluminanceSensorManager(elClient, {
    reachableTimeoutSec: REACHABLE_TIMEOUT_SEC,
  });
  const co2SensorManager = new Co2SensorManager(elClient, {
    reachableTimeoutSec: REACHABLE_TIMEOUT_SEC,
  });
  const securitySensorManager = new SecuritySensorManager(elClient, {
    reachableTimeoutSec: REACHABLE_TIMEOUT_SEC,
  });
  const fanDeviceManager = new FanDeviceManager(elClient, {
    reachableTimeoutSec: REACHABLE_TIMEOUT_SEC,
  });
  const floorHeaterManager = new FloorHeaterManager(elClient, {
    reachableTimeoutSec: REACHABLE_TIMEOUT_SEC,
  });

  const allManagers = [
    airconManager, lightManager, blindManager, tempSensorManager, lockManager,
    monoLightManager, humiditySensorManager, occupancySensorManager,
    illuminanceSensorManager, co2SensorManager, securitySensorManager,
    fanDeviceManager, floorHeaterManager,
  ];

  // ---- EL初期化: classCode ベースのディスパッチ ----
  // 1デバイスの処理失敗 (エンドポイント初期化エラー等) でブリッジ全体を
  // 落とさないよう、handlePacket の Promise は必ずここで捕捉する
  await elClient.initialize((rinfo, els) => {
    const classCode = els.SEOJ.substring(0, 4).toLowerCase();
    const dispatch = async (): Promise<void> => {
      switch (classCode) {
        case "0130": await airconManager.handlePacket(rinfo, els); break;
        case "0290": await lightManager.handlePacket(rinfo, els); break;
        case "0291": await monoLightManager.handlePacket(rinfo, els); break;
        case "0260":
        case "0263": await blindManager.handlePacket(rinfo, els); break;
        case "0011": await tempSensorManager.handlePacket(rinfo, els); break;
        case "0012": await humiditySensorManager.handlePacket(rinfo, els); break;
        case "0007": await occupancySensorManager.handlePacket(rinfo, els); break;
        case "00d0": await illuminanceSensorManager.handlePacket(rinfo, els); break;
        case "001b": await co2SensorManager.handlePacket(rinfo, els); break;
        case "0002": await securitySensorManager.handlePacket(rinfo, els); break;
        case "026f": await lockManager.handlePacket(rinfo, els); break;
        case "0133":
        case "0135": await fanDeviceManager.handlePacket(rinfo, els); break;
        case "027b": await floorHeaterManager.handlePacket(rinfo, els); break;
        default:
          logger.debug(`EL packet from ${rinfo.address} class:${classCode} ESV:${els.ESV}`);
          break;
      }
    };
    dispatch().catch((e) => {
      logger.error(`EL packet handling failed (${rinfo.address}/${els.SEOJ}):`, e);
    });
  });

  // ---- Matter ServerNode ----
  // matter.js 標準の environment 変数でペアリング情報を固定できる
  // (例: `--passcode 20202021 --discriminator 3840` または環境変数
  //  MATTER_PASSCODE / MATTER_DISCRIMINATOR)。未指定時は自動生成。
  const matterVars = Environment.default.vars;
  const fixedPasscode = matterVars.number("passcode");
  const fixedDiscriminator = matterVars.number("discriminator");

  const server = await ServerNode.create({
    id: "matter-echonet-bridge",
    network: { port: MATTER_PORT },
    commissioning: {
      ...(fixedPasscode !== undefined ? { passcode: fixedPasscode } : {}),
      ...(fixedDiscriminator !== undefined ? { discriminator: fixedDiscriminator } : {}),
    },
    productDescription: {
      name: "Echonet Matter Bridge",
      deviceType: AggregatorEndpoint.deviceType,
    },
    basicInformation: {
      // 0xFFF1 は CSA がテスト・開発用に予約している Vendor ID (未認証用)
      vendorId: VendorId(0xfff1),
      vendorName: "reomaru",
      productId: 0x8000,
      productName: "Echonet-Matter Bridge",
      serialNumber: "ECHONET-BRIDGE-001",
      softwareVersion: 1,
      softwareVersionString: "1.0.0",
      hardwareVersion: 1,
      hardwareVersionString: "1.0.0",
    },
  });

  // ---- Aggregator (ブリッジ集約ポイント) ----
  const aggregator = new Endpoint(AggregatorEndpoint, { id: "bridge" });
  await server.add(aggregator);

  // 全マネージャにアグリゲータを設定
  for (const manager of allManagers) manager.setAggregator(aggregator);

  // ---- デバイス探索開始 ----
  logger.notice("Starting Echonet Lite device discovery...");
  elClient.search();

  // 起動時は短い間隔で複数回探索 (UDP パケットロスト対策)
  for (const delaySec of [3, 6, 10, 20]) {
    setTimeout(() => elClient.search(), delaySec * 1000);
  }

  // 定期探索
  setInterval(() => {
    elClient.search();
  }, SEARCH_INTERVAL_SEC * 1000);

  // 定期ポーリング: 全マネージャ
  setInterval(() => {
    for (const manager of allManagers) manager.poll();
  }, POLL_INTERVAL_SEC * 1000);

  // デバッグ用: 定期状態ダンプ (quiet モードでは無効)
  if (!QUIET_MODE) {
    setInterval(() => {
      airconManager.dumpState();
    }, 60_000);
  }

  // ---- Matter サーバー起動 ----
  await server.start();
  logger.notice("=".repeat(60));
  logger.notice("Matter Bridge is running on port " + MATTER_PORT);
  logger.notice("Supported: Aircon, Light (dimmable/color), MonoLight, Blind/Shutter, Lock,");
  logger.notice("           Temp/Humidity/Occupancy/Illuminance/CO2/Security sensors,");
  logger.notice("           Ventilation Fan, Air Purifier, Floor Heater");
  logger.notice("Pair this bridge with your Matter controller.");
  logger.notice("After restart, controllers may take 30-60s to re-establish sessions.");
  if (QUIET_MODE) logger.notice("Quiet mode: showing only control & discovery messages");
  logger.notice("=".repeat(60));

  // ---- シャットダウン処理 ----
  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) {
      logger.notice("Force exit.");
      process.exit(1);
    }
    isShuttingDown = true;
    logger.notice("Shutting down gracefully (press Ctrl+C again to force)...");
    try {
      await server.close();
    } catch (e) {
      logger.error("Error during shutdown:", e);
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// ============================================================
// 起動
// ============================================================
main().catch((err) => {
  logger.error("Fatal error:", err);
  process.exit(1);
});