/**
 * E2E テスト: EL エミュレータ ↔ ブリッジ ↔ matter.js コントローラ
 *
 * 構成 (すべて同一ホスト):
 *   ElDeviceSim (UDP 3611 受信 / 3610 へ返信)
 *     ↕ ECHONET Lite
 *   ブリッジ子プロセス (UDP 3610 受信 / --el-port 3611 で送信, Matter 5540)
 *     ↕ Matter
 *   TestController (matter.js ClientNode, 5580)
 *
 * 実行: npm test  (= node --import tsx --test test/e2e.test.ts)
 *
 * 方針: README に載る全 EL クラスを 1 台以上立て、
 *   (1) 発見・デバイスタイプ判定
 *   (2) EL → Matter (初期値・状変通知)
 *   (3) Matter → EL (コマンド・属性書き込み)
 * を各クラスについて検証する。過去に作り込んだ不具合の回帰テストには
 * 「回帰:」を付けている。
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ElDeviceSim } from "./harness/el-device.js";
import { BridgeProcess } from "./harness/bridge-process.js";
import { TestController, primaryInterface } from "./harness/controller.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(HERE, ".tmp");
const EL_SIM_PORT = 3611;
const PASSCODE = 20202021;
const DISCRIMINATOR = 3840;

/** 立ち上げる EL デバイスの EOJ 一覧 (発見テストと個数待ちで共用) */
const ALL_EOJS = [
  "029001", // 照明 (光色なし) OFF/50%
  "029002", // 照明 (光色あり) ON/100%/白色
  "029003", // 照明 (光色なし) OFF … Matter からの点灯テスト専用
  "029101", // 単機能照明 ON
  "013001", // エアコン ON/冷房/26℃/室温24℃/風量自動
  "013002", // エアコン OFF … 同一 IP・同一クラスの別インスタンス
  "026001", // ブラインド 開
  "026301", // 雨戸・シャッター 閉
  "001101", // 温度センサー 24.0℃
  "001201", // 湿度センサー 55%
  "000701", // 人感センサー 検知なし
  "00d001", // 照度センサー 100 lux
  "001b01", // CO2 センサー 500ppm
  "000201", // 防犯センサー 正常
  "026f01", // 電気錠 施錠
  "013301", // 換気扇 ON/Lv3
  "013501", // 空気清浄器 ON/自動
  "027b01", // 床暖房 ON/25℃/室温20℃
] as const;

/** Matter Thermostat.SystemMode */
const MODE = { Off: 0, Auto: 1, Cool: 3, Heat: 4, FanOnly: 7 } as const;
/** Matter FanControl.FanMode */
const FAN = { Off: 0, Low: 1, Medium: 2, High: 3, On: 4, Auto: 5 } as const;
/** Matter DoorLock.LockState */
const LOCK = { NotFullyLocked: 0, Locked: 1, Unlocked: 2 } as const;

let sim: ElDeviceSim;
let bridge: BridgeProcess;
let controller: TestController;

/** 属性が「変化しないこと」を確認するための待機 */
const settle = (ms = 2500) => new Promise(r => setTimeout(r, ms));

before(async () => {
  const iface = primaryInterface();

  sim = new ElDeviceSim(EL_SIM_PORT);
  // ---- 照明系 ----
  sim.addDevice({ eoj: "029001", props: { "80": "31", "B0": "32" } });
  sim.addDevice({ eoj: "029002", props: { "80": "30", "B0": "64", "B1": "42" } });
  sim.addDevice({ eoj: "029003", props: { "80": "31", "B0": "32" } });
  sim.addDevice({ eoj: "029101", props: { "80": "30" } });
  // ---- 空調系 ----
  sim.addDevice({
    eoj: "013001",
    props: { "80": "30", "B0": "42", "B3": "1a", "BB": "18", "A0": "41" },
    settable: ["80", "B0", "B3", "A0"],
  });
  sim.addDevice({
    eoj: "013002",
    props: { "80": "31", "B0": "41", "B3": "1c", "BB": "16" },
    settable: ["80", "B0", "B3"],
  });
  sim.addDevice({ eoj: "027b01", props: { "80": "30", "E0": "19", "E2": "14" }, settable: ["80", "E0"] });
  sim.addDevice({ eoj: "013301", props: { "80": "30", "A0": "33" }, settable: ["80", "A0"] });
  sim.addDevice({ eoj: "013501", props: { "80": "30", "A0": "41" }, settable: ["80", "A0"] });
  // ---- 開閉系 ----
  sim.addDevice({ eoj: "026001", props: { "E0": "41" }, settable: ["E0"] });
  sim.addDevice({ eoj: "026301", props: { "E0": "42", "EA": "42" }, settable: ["E0"] });
  sim.addDevice({ eoj: "026f01", props: { "E0": "41" }, settable: ["E0"] });
  // ---- センサー系 (読み取り専用) ----
  sim.addDevice({ eoj: "001101", props: { "E0": "00f0" }, settable: [] });
  sim.addDevice({ eoj: "001201", props: { "E0": "37" }, settable: [] });
  sim.addDevice({ eoj: "000701", props: { "B1": "42" }, settable: [] });
  sim.addDevice({ eoj: "00d001", props: { "E0": "0064" }, settable: [] });
  sim.addDevice({ eoj: "001b01", props: { "E0": "01f4" }, settable: [] });
  sim.addDevice({ eoj: "000201", props: { "B1": "42" }, settable: [] });
  await sim.start();

  // ---- コントローラを先に起動し、スキャンを開始してからブリッジを立ち上げる ----
  controller = await TestController.create({
    storagePath: path.join(TMP, "controller-storage"),
    mdnsInterface: iface,
  });
  const commissioned = controller.beginCommission(PASSCODE, DISCRIMINATOR);

  bridge = new BridgeProcess({
    storagePath: path.join(TMP, "bridge-storage"),
    mdnsInterface: iface,
    passcode: PASSCODE,
    discriminator: DISCRIMINATOR,
    elPort: EL_SIM_PORT,
  });
  await bridge.start();

  sim.announceAll();
  await commissioned;

  // 全デバイスぶんのブリッジ配下エンドポイントが見えるまで待つ
  // (光色なし照明は 0xB1 プローブの 3.5 秒待ちを経て作成される)
  await controller.waitForBridgedEndpoints(ALL_EOJS.length, 60000);
});

after(async () => {
  await controller?.close();
  await bridge?.stop();
  sim?.stop();
});

// ============================================================
// 1. 発見とデバイスタイプ判定
// ============================================================

test("全 EL デバイスがブリッジ配下の Matter エンドポイントとして公開される", () => {
  for (const eoj of ALL_EOJS) {
    assert.ok(controller.findByEoj(eoj), `EOJ ${eoj} のエンドポイントが見つからない`);
  }
  assert.equal(controller.bridgedEndpoints().length, ALL_EOJS.length);
});

test("同一 IP 上の同一クラス複数インスタンスが別エンドポイントとして識別される", () => {
  const a = controller.findByEoj("013001")!;
  const b = controller.findByEoj("013002")!;
  assert.notEqual(a.id, b.id, "013001 と 013002 が同じエンドポイントに潰れている");

  const serialOf = (e: any) => e.state?.bridgedDeviceBasicInformation?.serialNumber;
  assert.ok(String(serialOf(a)).endsWith("_013001"));
  assert.ok(String(serialOf(b)).endsWith("_013002"));

  // 照明も 3 インスタンスが個別に見えていること
  const lights = ["029001", "029002", "029003"].map(e => controller.findByEoj(e)!.id);
  assert.equal(new Set(lights).size, 3);
});

test("光色対応の有無で DimmableLight / ColorTemperatureLight が出し分けられる", () => {
  const plain = controller.findByEoj("029001")!;
  const color = controller.findByEoj("029002")!;
  const behaviorsOf = (e: any) => Object.keys(e.behaviors?.supported ?? {});
  assert.ok(!behaviorsOf(plain).includes("colorControl"), "0xB1 なしの照明に colorControl がある");
  assert.ok(behaviorsOf(color).includes("colorControl"), "0xB1 ありの照明に colorControl がない");
});

test("EL クラスごとに適切な Matter クラスタが生える", () => {
  const behaviorsOf = (eoj: string) =>
    Object.keys((controller.findByEoj(eoj) as any).behaviors?.supported ?? {});

  // 単機能照明は調光クラスタを持たない
  assert.ok(behaviorsOf("029101").includes("onOff"));
  assert.ok(!behaviorsOf("029101").includes("levelControl"), "単機能照明に levelControl がある");
  // 調光照明は levelControl を持つ
  assert.ok(behaviorsOf("029001").includes("levelControl"));

  assert.ok(behaviorsOf("026001").includes("windowCovering"));
  assert.ok(behaviorsOf("026301").includes("windowCovering"));
  assert.ok(behaviorsOf("026f01").includes("doorLock"));
  assert.ok(behaviorsOf("013301").includes("fanControl"));
  assert.ok(behaviorsOf("013501").includes("fanControl"));
  assert.ok(behaviorsOf("013001").includes("thermostat"));
  assert.ok(behaviorsOf("027b01").includes("thermostat"));
  assert.ok(behaviorsOf("001101").includes("temperatureMeasurement"));
  assert.ok(behaviorsOf("001201").includes("relativeHumidityMeasurement"));
  assert.ok(behaviorsOf("000701").includes("occupancySensing"));
  assert.ok(behaviorsOf("00d001").includes("illuminanceMeasurement"));
  assert.ok(behaviorsOf("001b01").includes("carbonDioxideConcentrationMeasurement"));
  assert.ok(behaviorsOf("000201").includes("booleanState"));
});

// ============================================================
// 2. EL → Matter (初期値)
// ============================================================

test("EL → Matter: 照明・エアコン・電気錠の初期状態が反映される", async () => {
  const light = controller.findByEoj("029001")!;
  await controller.waitForState(light, "onOff", s => s.onOff === false);
  await controller.waitForState(light, "levelControl", s => s.currentLevel === 127); // 50% → 127

  const colorLight = controller.findByEoj("029002")!;
  await controller.waitForState(colorLight, "onOff", s => s.onOff === true);
  await controller.waitForState(colorLight, "levelControl", s => s.currentLevel === 254); // 100%
  await controller.waitForState(colorLight, "colorControl", s => s.colorTemperatureMireds === 250); // 白色

  const mono = controller.findByEoj("029101")!;
  await controller.waitForState(mono, "onOff", s => s.onOff === true);

  const aircon = controller.findByEoj("013001")!;
  await controller.waitForState(aircon, "thermostat", s => s.systemMode === MODE.Cool);
  await controller.waitForState(aircon, "thermostat", s => s.occupiedCoolingSetpoint === 2600);
  await controller.waitForState(aircon, "thermostat", s => s.localTemperature === 2400);

  // 電源 OFF の 2 台目は systemMode=Off に畳まれる (EL は 0x80 と 0xB0 が独立)
  const aircon2 = controller.findByEoj("013002")!;
  await controller.waitForState(aircon2, "thermostat", s => s.systemMode === MODE.Off);

  const lock = controller.findByEoj("026f01")!;
  await controller.waitForState(lock, "doorLock", s => s.lockState === LOCK.Locked);
});

test("EL → Matter: 全センサーの初期値が正しい単位で反映される", async () => {
  const temp = controller.findByEoj("001101")!;
  await controller.waitForState(temp, "temperatureMeasurement", s => s.measuredValue === 2400);

  const humidity = controller.findByEoj("001201")!;
  await controller.waitForState(humidity, "relativeHumidityMeasurement", s => s.measuredValue === 5500);

  const occupancy = controller.findByEoj("000701")!;
  await controller.waitForState(occupancy, "occupancySensing", s => s.occupancy?.occupied === false);

  // 照度は Matter 仕様の対数エンコード: 10000*log10(100)+1 = 20001
  const illuminance = controller.findByEoj("00d001")!;
  await controller.waitForState(illuminance, "illuminanceMeasurement", s => s.measuredValue === 20001);

  const co2 = controller.findByEoj("001b01")!;
  await controller.waitForState(co2, "carbonDioxideConcentrationMeasurement", s => s.measuredValue === 500);

  // 防犯センサーは Matter BooleanState の true = 接点閉 = 正常
  const security = controller.findByEoj("000201")!;
  await controller.waitForState(security, "booleanState", s => s.stateValue === true);
});

test("EL → Matter: 開閉系の初期状態が Matter の向き (0=全開/10000=全閉) で反映される", async () => {
  const blind = controller.findByEoj("026001")!; // 0xE0=0x41 開
  await controller.waitForState(blind, "windowCovering",
    s => s.currentPositionLiftPercent100ths === 0);

  const shutter = controller.findByEoj("026301")!; // 0xEA=0x42 全閉
  await controller.waitForState(shutter, "windowCovering",
    s => s.currentPositionLiftPercent100ths === 10000);
});

test("EL → Matter: 換気扇・空気清浄器・床暖房の初期状態が反映される", async () => {
  // 換気扇 Lv3 → Low / 38%
  const fan = controller.findByEoj("013301")!;
  await controller.waitForState(fan, "fanControl", s => s.fanMode === FAN.Low);
  await controller.waitForState(fan, "fanControl", s => s.percentSetting === 38);

  // 空気清浄器 0xA0=0x41 (自動) → Auto / percentSetting は null
  const purifier = controller.findByEoj("013501")!;
  await controller.waitForState(purifier, "fanControl", s => s.fanMode === FAN.Auto);
  await controller.waitForState(purifier, "fanControl", s => s.percentSetting === null);

  // 床暖房 25℃設定 / 室温20℃ / 運転中
  const heater = controller.findByEoj("027b01")!;
  await controller.waitForState(heater, "thermostat", s => s.systemMode === MODE.Heat);
  await controller.waitForState(heater, "thermostat", s => s.occupiedHeatingSetpoint === 2500);
  await controller.waitForState(heater, "thermostat", s => s.localTemperature === 2000);
});

// ============================================================
// 3. EL → Matter (状変通知 INF の同期)
// ============================================================

// ブリッジは状態を 1 つ反映するたび EL→Matter を約 1 秒抑止する (ポーリング応答との
// 競合防止)。その窓に入った INF は捨てられるので、実機の再通知と同じように
// 反映されるまで INF を送り直しながら待つ。
const SYNC_TIMEOUT = 45000;

async function notifyAndWait(
  eoj: string, epc: string, edt: string,
  endpoint: any, behaviorId: string, predicate: (s: any) => boolean,
  timeoutMs = SYNC_TIMEOUT,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: any;
  while (Date.now() < deadline) {
    sim.setPropAndNotify(eoj, epc, edt);
    const retryAt = Math.min(Date.now() + 3000, deadline);
    while (Date.now() < retryAt) {
      last = controller.readState(endpoint, behaviorId);
      if (last !== undefined && predicate(last)) return;
      await settle(300);
    }
  }
  throw new Error(
    `INF ${eoj}/${epc}=${edt} が ${timeoutMs}ms 以内に反映されない: ${behaviorId}=${JSON.stringify(last)}`);
}

test("EL → Matter: INF (状変通知) が各クラスで同期される", async () => {
  await notifyAndWait("001101", "E0", "0104", // 26.0℃
    controller.findByEoj("001101"), "temperatureMeasurement", s => s.measuredValue === 2600);

  await notifyAndWait("029001", "80", "30", // 点灯
    controller.findByEoj("029001"), "onOff", s => s.onOff === true);

  await notifyAndWait("000701", "B1", "41", // 検知あり
    controller.findByEoj("000701"), "occupancySensing", s => s.occupancy?.occupied === true);

  await notifyAndWait("000201", "B1", "41", // 侵入あり → 接点開 = false
    controller.findByEoj("000201"), "booleanState", s => s.stateValue === false);

  await notifyAndWait("001b01", "E0", "0320", // 800ppm
    controller.findByEoj("001b01"), "carbonDioxideConcentrationMeasurement",
    s => s.measuredValue === 800);

  await notifyAndWait("026001", "E0", "42", // 閉
    controller.findByEoj("026001"), "windowCovering",
    s => s.currentPositionLiftPercent100ths === 10000);
});

test("回帰: 氷点下の室温が符号付きで Matter に渡る (2 の補数)", async () => {
  const aircon = controller.findByEoj("013001")!;
  await notifyAndWait("013001", "BB", "fb", // -5℃ (1 バイト)
    aircon, "thermostat", s => s.localTemperature === -500);

  // 温度センサー側は 2 バイト符号付き (0xFFCE = -5.0℃)
  await notifyAndWait("001101", "E0", "ffce",
    controller.findByEoj("001101"), "temperatureMeasurement", s => s.measuredValue === -500);

  // 後続テストのために戻す
  await notifyAndWait("013001", "BB", "18",
    aircon, "thermostat", s => s.localTemperature === 2400);
});

// ============================================================
// 4. Matter → EL (コマンド・属性書き込み)
// ============================================================

test("Matter → EL: OnOff コマンドが EL の SetC 0x80 になる", async () => {
  // 029002 は初期状態 ON なので off() で必ず属性変化が起きる (他テストと独立)
  const light = controller.findByEoj("029002")!;
  sim.receivedSets.length = 0;

  await controller.invoke(light, "onOff", onOff => onOff.off());

  await bridge.waitForLog(/\[→EL\] Light onOff → false/);
  const set = await sim.waitForSet("029002", "80");
  assert.equal(set.edt, "31");
  assert.equal(sim.getProp("029002", "80"), "31");
});

test("回帰: Matter からの点灯後も ON 状態が維持される (Set_Res の空 EDT を消灯と誤読しない)", async () => {
  // 029003 は消灯状態。ブリッジは SetC 0x80=30 を送り、機器は Set_Res(0x71, PDC=0) を返す。
  // ESV を見ずに EDT="" を状態値として取り込むと「消灯」と誤判定し、Matter 側が OFF に戻る。
  const light = controller.findByEoj("029003")!;
  sim.receivedSets.length = 0;

  await controller.invoke(light, "onOff", onOff => onOff.on());

  await bridge.waitForLog(/\[→EL\] Light onOff → true/);
  const set = await sim.waitForSet("029003", "80");
  assert.equal(set.edt, "30");
  assert.equal(sim.getProp("029003", "80"), "30");

  // Set_Res 受信後も ON のままであること (誤読すると数十 ms で false に戻る)
  await settle();
  assert.equal(controller.readState(light, "onOff").onOff, true,
    "Set_Res の空 EDT を消灯と誤読して Matter 側が OFF に戻っている");
});

test("Matter → EL: 明るさ変更が EL の SetC 0xB0 になる", async () => {
  // 029001 の初期値は 50%。変化を確実に起こすため 25% (level 64) を指定する
  const light = controller.findByEoj("029001")!; // 直前のテストで点灯済み
  sim.receivedSets.length = 0;

  await controller.invoke(light, "levelControl", lc =>
    lc.moveToLevelWithOnOff({ level: 64, transitionTime: 0, optionsMask: {}, optionsOverride: {} }));

  await bridge.waitForLog(/\[→EL\] Light brightness → 25%/);
  const set = await sim.waitForSet("029001", "B0");
  assert.equal(set.edt, "19"); // 25%
});

test("回帰: 最小レベルでも EL 照度レベルが 1% 以上になる (0x00 は EL 仕様外)", async () => {
  const light = controller.findByEoj("029001")!;
  sim.receivedSets.length = 0;

  await controller.invoke(light, "levelControl", lc =>
    lc.moveToLevelWithOnOff({ level: 1, transitionTime: 0, optionsMask: {}, optionsOverride: {} }));

  const set = await sim.waitForSet("029001", "B0");
  const pct = parseInt(set.edt, 16);
  assert.ok(pct >= 1 && pct <= 100,
    `EL 0xB0 の有効範囲は 1-100% だが ${pct}% (0x${set.edt}) を送っている`);
});

test("Matter → EL: 色温度変更が EL の SetC 0xB1 になる", async () => {
  const light = controller.findByEoj("029002")!;
  // ColorControl コマンドは消灯中だと Matter 仕様上無視される (ExecuteIfOff 未指定)。
  // 直前のテストで消灯しているので EL 側から点灯させておく。
  sim.setPropAndNotify("029002", "80", "30");
  await controller.waitForState(light, "onOff", s => s.onOff === true);
  sim.receivedSets.length = 0;

  await controller.invoke(light, "colorControl", cc =>
    cc.moveToColorTemperature({
      colorTemperatureMireds: 370, transitionTime: 0, optionsMask: {}, optionsOverride: {},
    }));

  await bridge.waitForLog(/\[→EL\] Light color → 0x41/);
  const set = await sim.waitForSet("029002", "B1");
  assert.equal(set.edt, "41"); // 電球色
});

test("Matter → EL: 単機能照明の OnOff が EL の SetC 0x80 になる", async () => {
  const mono = controller.findByEoj("029101")!; // 初期 ON
  sim.receivedSets.length = 0;

  await controller.invoke(mono, "onOff", onOff => onOff.off());

  await bridge.waitForLog(/\[→EL\] MonoLight onOff → false/);
  const set = await sim.waitForSet("029101", "80");
  assert.equal(set.edt, "31");
});

test("Matter → EL: Thermostat 設定温度書き込みが EL の SetC 0xB3 になる", async () => {
  const aircon = controller.findByEoj("013001")!;
  sim.receivedSets.length = 0;

  await controller.writeState(aircon, { thermostat: { occupiedCoolingSetpoint: 2800 } });

  await bridge.waitForLog(/CoolingSetpoint → 28/);
  const set = await sim.waitForSet("013001", "B3");
  assert.equal(set.edt, "1c"); // 28℃
});

test("Matter → EL: SystemMode 変更が EL の運転モード 0xB0 / 電源 0x80 になる", async () => {
  const aircon = controller.findByEoj("013001")!;

  // 暖房へ
  sim.receivedSets.length = 0;
  await controller.writeState(aircon, { thermostat: { systemMode: MODE.Heat } });
  const heat = await sim.waitForSet("013001", "B0");
  assert.equal(heat.edt, "43");

  // 停止 → EL は 0xB0 ではなく電源 0x80 を落とす
  sim.receivedSets.length = 0;
  await controller.writeState(aircon, { thermostat: { systemMode: MODE.Off } });
  const off = await sim.waitForSet("013001", "80");
  assert.equal(off.edt, "31");
});

test("回帰: Auto モードで設定温度が勝手に下がり続けない", async () => {
  // Auto では冷房/暖房セットポイントの両方を Matter へ書く。その派生値 (target-1℃) を
  // そのまま EL へ書き戻すと、EL 状態が更新されるたびに 1℃ ずつ低下し続ける。
  const aircon = controller.findByEoj("013001")!;

  // 1 段ずつ反映を確認しながら Auto / 26℃ の状態を作る
  await settle(3000);
  await notifyAndWait("013001", "80", "30", aircon, "thermostat", s => s.systemMode !== MODE.Off);
  await notifyAndWait("013001", "B0", "41", aircon, "thermostat", s => s.systemMode === MODE.Auto);
  await notifyAndWait("013001", "B3", "1a", aircon, "thermostat",
    s => s.occupiedCoolingSetpoint === 2600);

  sim.receivedSets.length = 0;

  // EL 側の状変を数回起こす (実機では室温変化のたびに毎回起きる)
  for (const t of ["17", "18", "19"]) {
    sim.setPropAndNotify("013001", "BB", t);
    await settle(1200);
  }

  const setpointWrites = sim.receivedSets.filter(s =>
    s.eoj.toLowerCase() === "013001" && s.epc === "B3");
  assert.deepEqual(setpointWrites, [],
    `Auto 中に設定温度が書き戻されている: ${JSON.stringify(setpointWrites)}`);
  assert.equal(sim.getProp("013001", "B3"), "1a",
    `Auto 中に EL の設定温度が ${parseInt(sim.getProp("013001", "B3")!, 16)}℃ へ変化した (26℃ のままであるべき)`);
});

test("Matter → EL: WindowCovering の開閉指示が EL の SetC 0xE0 になる", async () => {
  const blind = controller.findByEoj("026001")!;
  // 他テストの結果に依存しないよう、まず EL 側から閉状態にしておく
  await notifyAndWait("026001", "E0", "42", blind, "windowCovering",
    s => s.currentPositionLiftPercent100ths === 10000);
  sim.receivedSets.length = 0;

  await controller.invoke(blind, "windowCovering", wc =>
    wc.goToLiftPercentage({ liftPercent100thsValue: 0 })); // 0 = 全開

  await bridge.waitForLog(/\[→EL\] Blind → OPEN/);
  const set = await sim.waitForSet("026001", "E0");
  assert.equal(set.edt, "41");
});

test("Matter → EL: DoorLock コマンドが EL の SetC 0xE0 になる", async () => {
  const lock = controller.findByEoj("026f01")!;

  sim.receivedSets.length = 0;
  await controller.invoke(lock, "doorLock", doorLock => doorLock.unlockDoor({}));
  await bridge.waitForLog(/\[→EL\] Lock → UNLOCKED/);
  assert.equal((await sim.waitForSet("026f01", "E0")).edt, "42");

  sim.receivedSets.length = 0;
  await controller.invoke(lock, "doorLock", doorLock => doorLock.lockDoor({}));
  await bridge.waitForLog(/\[→EL\] Lock → LOCKED/);
  assert.equal((await sim.waitForSet("026f01", "E0")).edt, "41");
});

test("Matter → EL: FanControl の風量指定が EL の SetC 0xA0 になる", async () => {
  const fan = controller.findByEoj("013301")!;
  sim.receivedSets.length = 0;

  // 75% → Lv6 (ceil(75*8/100)=6 → 0x36)
  await controller.writeState(fan, { fanControl: { percentSetting: 75 } });
  const set = await sim.waitForSet("013301", "A0");
  assert.equal(set.edt, "36");

  // 0% は電源 OFF に落とす
  sim.receivedSets.length = 0;
  await controller.writeState(fan, { fanControl: { percentSetting: 0 } });
  const off = await sim.waitForSet("013301", "80");
  assert.equal(off.edt, "31");
});

test("Matter → EL: 床暖房の設定温度・電源が EL の SetC になる", async () => {
  const heater = controller.findByEoj("027b01")!;
  sim.receivedSets.length = 0;

  await controller.writeState(heater, { thermostat: { occupiedHeatingSetpoint: 2800 } });
  await bridge.waitForLog(/\[→EL\] FloorHeater setpoint → 28/);
  assert.equal((await sim.waitForSet("027b01", "E0")).edt, "1c");

  sim.receivedSets.length = 0;
  await controller.writeState(heater, { thermostat: { systemMode: MODE.Off } });
  await bridge.waitForLog(/\[→EL\] FloorHeater → OFF/);
  assert.equal((await sim.waitForSet("027b01", "80")).edt, "31");
});

// ============================================================
// 5. 異常系・全体の健全性
// ============================================================

test("読み取り専用センサーへ Set が飛ばない", async () => {
  sim.receivedSets.length = 0;
  await settle(1500);
  const sensorSets = sim.receivedSets.filter(s =>
    ["001101", "001201", "000701", "00d001", "001b01", "000201"]
      .includes(s.eoj.toLowerCase()));
  assert.deepEqual(sensorSets, [], `センサーへ Set が飛んでいる: ${JSON.stringify(sensorSets)}`);
});

test("ブリッジが致命的エラーを出さずに稼働し続けている", () => {
  const fatal = bridge.logs.filter(l =>
    /unhandledRejection|UnhandledPromiseRejection|FATAL|ValidationError|ConstraintError/.test(l));
  assert.deepEqual(fatal, [], `致命的エラーがログに出ている:\n${fatal.slice(0, 5).join("\n")}`);
});
