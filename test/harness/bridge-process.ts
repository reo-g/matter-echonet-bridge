/**
 * E2E テスト用: ブリッジを子プロセスとして起動・管理する
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(HERE, "..", "..");

export interface BridgeOptions {
  /** Matter ストレージディレクトリ (毎回削除して開始) */
  storagePath: string;
  /** mDNS を出すネットワークインターフェース名 */
  mdnsInterface: string;
  /** 固定パスコード / ディスクリミネータ */
  passcode: number;
  discriminator: number;
  /** EL 送信先ポート (エミュレータの bind ポート) */
  elPort?: number;
}

export class BridgeProcess {
  private proc: ChildProcess | null = null;
  readonly logs: string[] = [];
  private listeners: Array<{ re: RegExp; resolve: (line: string) => void }> = [];

  constructor(private options: BridgeOptions) {}

  async start(): Promise<void> {
    fs.rmSync(this.options.storagePath, { recursive: true, force: true });
    // 調査用にブリッジの全ログを test/.tmp/bridge.log にも書き出す
    const logFile = path.join(path.dirname(this.options.storagePath), "bridge.log");
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const logStream = fs.createWriteStream(logFile, { flags: "w" });
    const args = [path.join(PROJECT_ROOT, "dist", "bridge.js"), "--allow-self"];
    if (this.options.elPort) args.push("--el-port", String(this.options.elPort));

    this.proc = spawn("node", args, {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        MATTER_STORAGE_PATH: this.options.storagePath,
        MATTER_MDNS_NETWORKINTERFACE: this.options.mdnsInterface,
        MATTER_PASSCODE: String(this.options.passcode),
        MATTER_DISCRIMINATOR: String(this.options.discriminator),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const onData = (buf: Buffer) => {
      // ANSI エスケープを除去 (色コード内の数字がパターンマッチを壊すため)
      const text = buf.toString().replace(/\x1b\[[0-9;]*m/g, "");
      logStream.write(text);
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        this.logs.push(line);
        for (let i = this.listeners.length - 1; i >= 0; i--) {
          if (this.listeners[i].re.test(line)) {
            this.listeners[i].resolve(line);
            this.listeners.splice(i, 1);
          }
        }
      }
    };
    this.proc.stdout!.on("data", onData);
    this.proc.stderr!.on("data", onData);

    await this.waitForLog(/Matter Bridge is running/, 30000);
  }

  /** 指定パターンのログ行を待つ (過去ログも対象) */
  waitForLog(re: RegExp, timeoutMs = 15000): Promise<string> {
    const hit = this.logs.find(l => re.test(l));
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const entry = { re, resolve };
      this.listeners.push(entry);
      setTimeout(() => {
        const idx = this.listeners.indexOf(entry);
        if (idx >= 0) this.listeners.splice(idx, 1);
        reject(new Error(`bridge log not found in ${timeoutMs}ms: ${re}\n--- last logs ---\n${this.logs.slice(-15).join("\n")}`));
      }, timeoutMs).unref();
    });
  }

  async stop(): Promise<void> {
    if (!this.proc) return;
    const proc = this.proc;
    this.proc = null;
    proc.kill("SIGINT");
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => { proc.kill("SIGKILL"); resolve(); }, 5000);
      proc.on("exit", () => { clearTimeout(t); resolve(); });
    });
  }
}
