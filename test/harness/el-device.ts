/**
 * スクリプタブル ECHONET Lite デバイスエミュレータ (テスト用)
 *
 * ブリッジと同一ホストで動かすための二重ポート方式:
 *   - ブリッジ: 3610 で受信 / `--el-port 3611` で 3611 へ送信
 *   - 本エミュレータ: 3611 で受信 / 3610 へ返信・通知
 *
 * Get / SetC / SetI / INF_REQ に応答し、プロパティマップ (0x9D/9E/9F) と
 * ノードプロファイル (0EF001) のインスタンスリスト (0xD6) も提供する。
 * SetC の受信履歴を記録するので、Matter→EL の検証に使える。
 */
import dgram from "node:dgram";
import { EventEmitter } from "node:events";

const EL_MULTICAST = "224.0.23.0";

export interface ElDeviceConfig {
  /** EOJ (6 hex, 例 "029001") */
  eoj: string;
  /** EPC (2 hex 大文字) → EDT (hex)。0x80 等を含める */
  props: Record<string, string>;
  /** Set 可能な EPC (大文字)。省略時は props の全キー */
  settable?: string[];
}

export interface ReceivedSet {
  eoj: string;
  epc: string;
  edt: string;
  esv: string;
}

export class ElDeviceSim extends EventEmitter {
  private sock: dgram.Socket | null = null;
  private devices = new Map<string, ElDeviceConfig>(); // eoj (小文字) → config
  private tid = 1;
  /** ブリッジから受信した Set の履歴 */
  readonly receivedSets: ReceivedSet[] = [];

  constructor(
    private bindPort = 3611,
    private peerHost = "127.0.0.1",
    private peerPort = 3610,
  ) {
    super();
  }

  addDevice(config: ElDeviceConfig): void {
    this.devices.set(config.eoj.toLowerCase(), {
      ...config,
      props: { ...config.props },
      settable: config.settable ?? Object.keys(config.props),
    });
  }

  getProp(eoj: string, epc: string): string | undefined {
    return this.devices.get(eoj.toLowerCase())?.props[epc.toUpperCase()];
  }

  /** SetC/SetI の受信を待つ (既に受信済みなら即 resolve) */
  waitForSet(eoj: string, epc: string, timeoutMs = 5000): Promise<ReceivedSet> {
    const matches = (s: ReceivedSet) =>
      s.eoj.toLowerCase() === eoj.toLowerCase() && s.epc === epc.toUpperCase();
    const hit = this.receivedSets.find(matches);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const onSet = (s: ReceivedSet) => { if (matches(s)) { cleanup(); resolve(s); } };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`SetC ${eoj}/${epc} not received in ${timeoutMs}ms (received: ${JSON.stringify(this.receivedSets)})`));
      }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); this.off("set", onSet); };
      this.on("set", onSet);
    });
  }

  /** プロパティ値を変更し、INF (状変通知) をブリッジへ送る */
  setPropAndNotify(eoj: string, epc: string, edt: string): void {
    const dev = this.devices.get(eoj.toLowerCase());
    if (!dev) throw new Error(`unknown eoj: ${eoj}`);
    dev.props[epc.toUpperCase()] = edt;
    this.sendPacket(dev.eoj, "05ff01", "73", [[epc, edt]]);
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
      this.sock.on("error", reject);
      this.sock.on("message", (buf, rinfo) => this.handlePacket(buf, rinfo));
      this.sock.bind(this.bindPort, () => {
        try {
          this.sock!.addMembership(EL_MULTICAST, "127.0.0.1");
        } catch {
          try { this.sock!.addMembership(EL_MULTICAST); } catch { /* multicast 不可でも unicast で動作可能 */ }
        }
        resolve();
      });
    });
  }

  stop(): void {
    this.sock?.close();
    this.sock = null;
  }

  /** 全デバイスを INF でアナウンス (発見トリガー) */
  announceAll(): void {
    for (const dev of this.devices.values()) {
      const epcs = Object.entries(dev.props).slice(0, 4); // 先頭数個で十分
      this.sendPacket(dev.eoj, "05ff01", "73", epcs);
    }
  }

  // ---- パケット処理 ----

  private handlePacket(buf: Buffer, rinfo: dgram.RemoteInfo): void {
    const hex = buf.toString("hex");
    if (hex.length < 24 || !hex.startsWith("1081")) return;
    const tid = hex.substring(4, 8);
    const seoj = hex.substring(8, 14);
    const deoj = hex.substring(14, 20).toLowerCase();
    const esv = hex.substring(20, 22);
    const opc = parseInt(hex.substring(22, 24), 16);

    // プロパティ部をパース
    const props: Array<[epc: string, edt: string]> = [];
    let pos = 24;
    for (let i = 0; i < opc && pos + 4 <= hex.length; i++) {
      const epc = hex.substring(pos, pos + 2).toUpperCase();
      const pdc = parseInt(hex.substring(pos + 2, pos + 4), 16);
      const edt = hex.substring(pos + 4, pos + 4 + pdc * 2);
      props.push([epc, edt]);
      pos += 4 + pdc * 2;
    }

    // 対象デバイス解決 (インスタンスコード 00 は一斉同報 → 全該当クラス)
    const targets: ElDeviceConfig[] = [];
    if (deoj.endsWith("00")) {
      for (const dev of this.devices.values()) {
        if (dev.eoj.toLowerCase().startsWith(deoj.substring(0, 4))) targets.push(dev);
      }
    } else {
      const dev = this.devices.get(deoj);
      if (dev) targets.push(dev);
    }
    if (targets.length === 0) return;

    for (const dev of targets) {
      switch (esv) {
        case "62": this.handleGet(dev, seoj, tid, props); break;
        case "61": this.handleSet(dev, seoj, tid, props, true); break;
        case "60": this.handleSet(dev, seoj, tid, props, false); break;
        case "63": {
          // INF_REQ → INF
          const epcs = props.map(([epc]) => epc)
            .filter(epc => this.resolveProp(dev, epc) !== undefined)
            .map(epc => [epc, this.resolveProp(dev, epc)!] as [string, string]);
          if (epcs.length > 0) this.sendPacket(dev.eoj, seoj, "73", epcs);
          break;
        }
      }
    }
  }

  /** プロパティマップ (9D/9E/9F) と D6 は動的に生成する */
  private resolveProp(dev: ElDeviceConfig, epc: string): string | undefined {
    const direct = dev.props[epc];
    if (direct !== undefined) return direct;
    switch (epc) {
      case "9F": return propertyMap([...Object.keys(dev.props), "9D", "9E", "9F"]);
      case "9E": return propertyMap(dev.settable ?? []);
      case "9D": return propertyMap(Object.keys(dev.props).filter(e => e === "80"));
      case "D6": if (dev.eoj.toLowerCase().startsWith("0ef0")) return this.instanceListS();
    }
    return undefined;
  }

  private handleGet(dev: ElDeviceConfig, seoj: string, tid: string, props: Array<[string, string]>): void {
    const results = props.map(([epc]) => [epc, this.resolveProp(dev, epc)] as const);
    const ok = results.every(([, edt]) => edt !== undefined);
    // 1つでも不可なら Get_SNA (0x52)、可のものは EDT 付き・不可のものは PDC=0
    const esv = ok ? "72" : "52";
    this.sendReply(dev.eoj, seoj, tid, esv, results.map(([epc, edt]) => [epc, edt ?? ""]));
  }

  private handleSet(dev: ElDeviceConfig, seoj: string, tid: string, props: Array<[string, string]>, needsRes: boolean): void {
    const results: Array<[string, string]> = [];
    let allOk = true;
    for (const [epc, edt] of props) {
      const ok = (dev.settable ?? []).includes(epc);
      if (ok) {
        dev.props[epc] = edt;
        this.receivedSets.push({ eoj: dev.eoj, epc, edt, esv: needsRes ? "61" : "60" });
        this.emit("set", { eoj: dev.eoj, epc, edt });
        results.push([epc, ""]); // 成功: PDC=0
      } else {
        allOk = false;
        results.push([epc, edt]); // 失敗: EDT を残す
      }
    }
    if (needsRes) {
      this.sendReply(dev.eoj, seoj, tid, allOk ? "71" : "51", results);
    }
  }

  /** 応答: TID を維持して 3610 へ返す */
  private sendReply(seoj: string, deoj: string, tid: string, esv: string, props: Array<[string, string]>): void {
    const body = props.map(([epc, edt]) =>
      epc + (edt.length / 2).toString(16).padStart(2, "0") + edt).join("");
    const pkt = "1081" + tid + seoj + deoj + esv +
      props.length.toString(16).padStart(2, "0") + body;
    this.send(Buffer.from(pkt, "hex"));
  }

  /** 自発送信 (INF 等): 新規 TID */
  private sendPacket(seoj: string, deoj: string, esv: string, props: Array<[string, string]>): void {
    const tid = (this.tid++ % 0xffff).toString(16).padStart(4, "0");
    this.sendReply(seoj, deoj, tid, esv, props);
  }

  private send(buf: Buffer): void {
    this.sock?.send(buf, this.peerPort, this.peerHost);
  }

  private instanceListS(): string {
    const eojs = [...this.devices.keys()].filter(e => !e.startsWith("0ef0"));
    return eojs.length.toString(16).padStart(2, "0") + eojs.join("");
  }
}

/** プロパティマップ EDT を生成 (16個未満: カウント+EPC列挙 / 16個以上: ビットマップ形式) */
function propertyMap(epcs: string[]): string {
  const unique = [...new Set(epcs.map(e => e.toUpperCase()))];
  if (unique.length < 16) {
    return unique.length.toString(16).padStart(2, "0") + unique.join("").toLowerCase();
  }
  const bitmap = new Uint8Array(16);
  for (const epc of unique) {
    const code = parseInt(epc, 16);
    bitmap[code & 0x0f] |= 1 << ((code >> 4) - 8);
  }
  return unique.length.toString(16).padStart(2, "0") +
    [...bitmap].map(b => b.toString(16).padStart(2, "0")).join("");
}
