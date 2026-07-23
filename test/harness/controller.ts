/**
 * E2E テスト用: matter.js の ClientNode API を使うテストコントローラ
 *
 * 重要な知見:
 * - mDNS はインターフェースを固定しないと ap1/awdl 等の到達不能アドレスを拾うことがある
 * - commission() のスキャンは「ブリッジ起動前」に開始すると起動時アナウンスを確実に捕まえる
 *   (起動済みデバイスに対する後追い discovery は待ちに入ることがある)
 */
import fs from "node:fs";
import os from "node:os";
import { Environment, ServerNode } from "@matter/main";
import { ControllerBehavior } from "@matter/main";
import type { Endpoint } from "@matter/main";

/** 実 LAN 側のインターフェースを自動検出 (TEST_MDNS_IFACE で上書き可) */
export function primaryInterface(): string {
  if (process.env.TEST_MDNS_IFACE) return process.env.TEST_MDNS_IFACE;
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (!addrs) continue;
    if (addrs.some(a => a.family === "IPv4" && !a.internal)) return name;
  }
  throw new Error("no external IPv4 interface found (set TEST_MDNS_IFACE)");
}

export interface ControllerOptions {
  storagePath: string;
  mdnsInterface: string;
  port?: number;
}

export class TestController {
  private node!: ServerNode;
  client: any = null; // ClientNode (コミッショニング後)

  static async create(options: ControllerOptions): Promise<TestController> {
    const c = new TestController();
    fs.rmSync(options.storagePath, { recursive: true, force: true });
    const env = Environment.default;
    env.vars.set("storage.path", options.storagePath);
    env.vars.set("mdns.networkInterface", options.mdnsInterface);
    c.node = await ServerNode.create(ServerNode.RootEndpoint.with(ControllerBehavior), {
      id: "e2e-controller",
      network: { port: options.port ?? 5580 },
    });
    await c.node.start();
    return c;
  }

  /**
   * コミッショニングのスキャンを開始する (await しないこと)。
   * ブリッジをこの後に起動し、返り値の Promise を await して完了を待つ。
   */
  beginCommission(passcode: number, discriminator: number): Promise<any> {
    const p = (this.node as any).peers.commission({ passcode, discriminator });
    p.then((client: any) => { this.client = client; }).catch(() => {});
    return p;
  }

  /** ブリッジ配下の子エンドポイント (Aggregator の下) が count 個揃うまで待つ */
  async waitForBridgedEndpoints(count: number, timeoutMs = 30000): Promise<Endpoint[]> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const children = this.bridgedEndpoints();
      if (children.length >= count) return children;
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`bridged endpoints did not reach ${count} in ${timeoutMs}ms (current: ${this.bridgedEndpoints().map(e => e.id).join(", ")})`);
  }

  /** 現在見えているブリッジ配下の子エンドポイント一覧 */
  bridgedEndpoints(): Endpoint[] {
    if (!this.client) return [];
    const result: Endpoint[] = [];
    for (const part of this.client.parts ?? []) {
      for (const child of part.parts ?? []) result.push(child);
    }
    return result;
  }

  /**
   * EL の EOJ でブリッジ配下エンドポイントを検索する。
   * クライアント側のエンドポイント ID はサーバー側の ID とは別物 (ep2 等) のため、
   * ブリッジが serialNumber に設定する `${ip}_${eoj}` で識別する。
   */
  findByEoj(eoj: string): Endpoint | undefined {
    return this.bridgedEndpoints().find(e => {
      const serial = (e as any).state?.bridgedDeviceBasicInformation?.serialNumber;
      return typeof serial === "string" && serial.toLowerCase().endsWith(`_${eoj.toLowerCase()}`);
    });
  }

  /** クライアント側キャッシュ (サブスクリプション) から属性値を読む */
  readState(endpoint: Endpoint, behaviorId: string): any {
    return (endpoint as any).state[behaviorId];
  }

  /** 属性値が条件を満たすまで待つ (サブスクリプション更新をポーリング) */
  async waitForState(
    endpoint: Endpoint, behaviorId: string, predicate: (state: any) => boolean, timeoutMs = 15000,
  ): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    let last: any;
    while (Date.now() < deadline) {
      last = this.readState(endpoint, behaviorId);
      if (last !== undefined && predicate(last)) return last;
      await new Promise(r => setTimeout(r, 300));
    }
    throw new Error(`state condition not met in ${timeoutMs}ms: ${behaviorId} = ${JSON.stringify(last)}`);
  }

  /** コマンド呼び出し (例: invoke(ep, "onOff", agentOnOff => agentOnOff.on())) */
  async invoke(endpoint: Endpoint, behaviorId: string, fn: (behavior: any) => Promise<any>): Promise<any> {
    return await (endpoint as any).act(async (agent: any) => {
      return await fn(agent[behaviorId]);
    });
  }

  /** 属性書き込み */
  async writeState(endpoint: Endpoint, updates: Record<string, any>): Promise<void> {
    await (endpoint as any).set(updates);
  }

  async close(): Promise<void> {
    await this.node?.close();
  }
}
