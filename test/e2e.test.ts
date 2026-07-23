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

let sim: ElDeviceSim;
let bridge: BridgeProcess;
let controller: TestController;

before(async () => {
  const iface = primaryInterface();

  // ---- EL エミュレータ: 8 クラスのデバイスを定義 ----
  sim = new ElDeviceSim(EL_SIM_PORT);
  sim.addDevice({ eoj: "029001", props: { "80": "31", "B0": "32" } });                      // 照明 OFF/50% (光色なし)
  sim.addDevice({ eoj: "029002", props: { "80": "30", "B0": "64", "B1": "42" } });          // 照明 ON/100%/白色
  sim.addDevice({
    eoj: "013001",
    props: { "80": "30", "B0": "42", "B3": "1a", "BB": "18" },                              // エアコン ON/冷房/26℃/室温24℃
    settable: ["80", "B0", "B3"],
  });
  sim.addDevice({ eoj: "001101", props: { "E0": "00f0" }, settable: [] });                  // 温度センサー 24.0℃
  sim.addDevice({ eoj: "001201", props: { "E0": "37" }, settable: [] });                    // 湿度センサー 55%
  sim.addDevice({ eoj: "026f01", props: { "E0": "41" } });                                  // 電気錠 施錠
  sim.addDevice({ eoj: "013301", props: { "80": "30", "A0": "33" } });                      // 換気扇 ON/Lv3
  sim.addDevice({ eoj: "027b01", props: { "80": "30", "E0": "19", "E2": "14" } });          // 床暖房 ON/25℃/室温20℃
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

  // 8 デバイスぶんのブリッジ配下エンドポイントが見えるまで待つ
  // (光色なし照明は 0xB1 プローブの 3.5 秒待ちを経て作成される)
  await controller.waitForBridgedEndpoints(8, 45000);
});

after(async () => {
  await controller?.close();
  await bridge?.stop();
  sim?.stop();
});

// ------------------------------------------------------------
// 発見と構造
// ------------------------------------------------------------

test("全 EL デバイスがブリッジ配下の Matter エンドポイントとして公開される", () => {
  const eojs = ["029001", "029002", "013001", "001101", "001201", "026f01", "013301", "027b01"];
  for (const eoj of eojs) {
    assert.ok(controller.findByEoj(eoj), `EOJ ${eoj} のエンドポイントが見つからない`);
  }
  assert.equal(controller.bridgedEndpoints().length, 8);
});

test("光色対応の有無で DimmableLight / ColorTemperatureLight が出し分けられる", () => {
  const plain = controller.findByEoj("029001")!;
  const color = controller.findByEoj("029002")!;
  const behaviorsOf = (e: any) => Object.keys(e.behaviors?.supported ?? {});
  assert.ok(!behaviorsOf(plain).includes("colorControl"), "0xB1 なしの照明に colorControl がある");
  assert.ok(behaviorsOf(color).includes("colorControl"), "0xB1 ありの照明に colorControl がない");
});

// ------------------------------------------------------------
// EL → Matter (初期値)
// ------------------------------------------------------------

test("EL の初期状態が Matter Attribute に反映される", async () => {
  const light = controller.findByEoj("029001")!;
  await controller.waitForState(light, "onOff", s => s.onOff === false);

  const tempSensor = controller.findByEoj("001101")!;
  await controller.waitForState(tempSensor, "temperatureMeasurement", s => s.measuredValue === 2400);

  const humidity = controller.findByEoj("001201")!;
  await controller.waitForState(humidity, "relativeHumidityMeasurement", s => s.measuredValue === 5500);

  const aircon = controller.findByEoj("013001")!;
  await controller.waitForState(aircon, "thermostat", s => s.systemMode === 3 /* Cool */);
  await controller.waitForState(aircon, "thermostat", s => s.occupiedCoolingSetpoint === 2600);

  const lock = controller.findByEoj("026f01")!;
  await controller.waitForState(lock, "doorLock", s => s.lockState === 1 /* Locked */);
});

// ------------------------------------------------------------
// EL → Matter (状変通知の同期)
// ------------------------------------------------------------

test("EL の INF (状変通知) が Matter へ同期される", async () => {
  const tempSensor = controller.findByEoj("001101")!;
  sim.setPropAndNotify("001101", "E0", "0104"); // 26.0℃
  await controller.waitForState(tempSensor, "temperatureMeasurement", s => s.measuredValue === 2600);

  const light = controller.findByEoj("029001")!;
  sim.setPropAndNotify("029001", "80", "30"); // 点灯
  await controller.waitForState(light, "onOff", s => s.onOff === true);
});

// ------------------------------------------------------------
// Matter → EL (コマンド・属性書き込み)
// ------------------------------------------------------------

test("Matter の OnOff コマンドが EL の SetC になる", async () => {
  // 029002 は初期状態 ON なので off() で必ず属性変化が起きる (他テストと独立)
  const light = controller.findByEoj("029002")!;
  sim.receivedSets.length = 0;

  await controller.invoke(light, "onOff", onOff => onOff.off());

  await bridge.waitForLog(/\[→EL\] Light onOff → false/);
  const set = await sim.waitForSet("029002", "80");
  assert.equal(set.edt, "31");
  assert.equal(sim.getProp("029002", "80"), "31");
});

test("Matter の Thermostat 設定温度書き込みが EL の SetC 0xB3 になる", async () => {
  const aircon = controller.findByEoj("013001")!;
  sim.receivedSets.length = 0;

  await controller.writeState(aircon, { thermostat: { occupiedCoolingSetpoint: 2800 } });

  await bridge.waitForLog(/CoolingSetpoint → 28/);
  const set = await sim.waitForSet("013001", "B3");
  assert.equal(set.edt, "1c"); // 28℃
});

test("Matter の DoorLock コマンドが EL の SetC 0xE0 になる", async () => {
  const lock = controller.findByEoj("026f01")!;
  sim.receivedSets.length = 0;

  await controller.invoke(lock, "doorLock", doorLock => doorLock.unlockDoor({}));

  await bridge.waitForLog(/\[→EL\] Lock → UNLOCKED/);
  const set = await sim.waitForSet("026f01", "E0");
  assert.equal(set.edt, "42");
});
