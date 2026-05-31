import { spawn, execSync, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync } from "node:fs";
import { homedir, networkInterfaces, platform } from "node:os";
import { delimiter, join } from "node:path";

/**
 * Locate a system Node.js binary. Required for `next dev` because Tailwind v4
 * ships native bindings (Lightning CSS) compiled against the system Node ABI,
 * which doesn't match Electron's bundled Node version.
 */
function findSystemNode(): string | null {
  // 1. PATH search via the platform's "which" equivalent
  try {
    const cmd = platform() === "win32" ? "where node" : "command -v node";
    const out = execSync(cmd, { encoding: "utf-8" }).split(/\r?\n/)[0].trim();
    if (out && existsSync(out)) return out;
  } catch {
    /* not found via shell */
  }
  // 2. Common install locations
  const candidates =
    platform() === "win32"
      ? [
          "C:\\Program Files\\nodejs\\node.exe",
          "C:\\Program Files (x86)\\nodejs\\node.exe",
        ]
      : ["/usr/local/bin/node", "/usr/bin/node", "/opt/homebrew/bin/node"];
  for (const c of candidates) if (existsSync(c)) return c;
  // 3. PATH scan
  const path = process.env.PATH || "";
  const exe = platform() === "win32" ? "node.exe" : "node";
  for (const dir of path.split(delimiter)) {
    const p = join(dir, exe);
    if (existsSync(p)) return p;
  }
  return null;
}

export type ServerPhase = "stopped" | "starting" | "running" | "error";

export interface ServerStatus {
  phase: ServerPhase;
  port: number;
  lanUrls: string[];
  error: string | null;
}

export interface ServerLog {
  ts: number;
  level: "info" | "warn" | "err";
  message: string;
}

interface ManagerEvents {
  status: (s: ServerStatus) => void;
  log: (l: ServerLog) => void;
}

export declare interface ServerManager {
  on<E extends keyof ManagerEvents>(event: E, listener: ManagerEvents[E]): this;
  emit<E extends keyof ManagerEvents>(event: E, ...args: Parameters<ManagerEvents[E]>): boolean;
}

const RING = 500;

function getDataDir(): string {
  if (process.env.NEXUS_DATA_DIR) return process.env.NEXUS_DATA_DIR;
  if (platform() === "win32") {
    const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    return join(appData, "Nexus");
  }
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "Nexus");
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "nexus");
}

function lanIps(): string[] {
  const out: string[] = [];
  const ifaces = networkInterfaces();
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const info of list) {
      if (info.family !== "IPv4" || info.internal) continue;
      // Skip APIPA / VMware-style adapters by convention; keep everything else.
      if (info.address.startsWith("169.254.")) continue;
      out.push(info.address);
    }
  }
  return out;
}

/**
 * Locate the Next.js server. Three modes:
 *  - packaged:   <resources>/next-server/server.js (electron-builder output)
 *  - dev:        `next dev` from the repo root (hot reload, no build)
 *  - prod-local: ../.next/standalone/server.js (only if next dev is missing)
 *
 * When running unpackaged (dev-launcher.cmd, `npm run dev:launcher`), prefer
 * `next dev` over any local `.next/standalone/`. The standalone build is only
 * fully wired up when bundled by electron-builder (which copies `.next/static`
 * + `public` next to `server.js`); when the user just ran `npm run build` at
 * the repo root, those static dirs aren't copied so every CSS / JS chunk
 * 404s and the GUI renders without styles.
 */
type ServerEntry =
  | { mode: "standalone"; entry: string; cwd: string }
  | { mode: "dev"; nextBin: string; cwd: string }
  | { mode: "missing" };

function findServerEntry(): ServerEntry {
  // 1. Packaged build inside the .exe — always use standalone.
  const resourcesPath = (process as unknown as { resourcesPath?: string }).resourcesPath;
  if (resourcesPath && !resourcesPath.includes("node_modules")) {
    const packaged = join(resourcesPath, "next-server", "server.js");
    if (existsSync(packaged)) {
      return { mode: "standalone", entry: packaged, cwd: join(resourcesPath, "next-server") };
    }
  }

  const repoRoot = join(__dirname, "..", "..");

  // 2. Running unpackaged → prefer `next dev` for hot reload + correct static
  //    file resolution. Falls through to local standalone only if next is
  //    not installed.
  const nextBin = join(repoRoot, "node_modules", "next", "dist", "bin", "next");
  if (existsSync(nextBin)) {
    return { mode: "dev", nextBin, cwd: repoRoot };
  }

  // 3. Last resort: local standalone (likely missing static assets).
  const localStandalone = join(repoRoot, ".next", "standalone", "server.js");
  if (existsSync(localStandalone)) {
    return {
      mode: "standalone",
      entry: localStandalone,
      cwd: join(repoRoot, ".next", "standalone"),
    };
  }

  return { mode: "missing" };
}

export class ServerManager extends EventEmitter {
  private proc: ChildProcess | null = null;
  private ring: ServerLog[] = [];
  private hostname = "0.0.0.0";
  private status: ServerStatus = {
    phase: "stopped",
    port: 9088,
    lanUrls: [],
    error: null,
  };
  private stopping = false;
  /** The optimistic "declare running after 2s" timer — tracked so stop()/
   *  exit can cancel it (otherwise it could flip a just-stopped server's
   *  phase back to "running"). */
  private runningTimer: ReturnType<typeof setTimeout> | null = null;

  setPort(port: number) {
    this.status.port = port;
  }

  setHostname(ip: string) {
    this.hostname = ip;
  }

  getStatus(): ServerStatus {
    return { ...this.status, lanUrls: this.computeLanUrls() };
  }

  getLogs(): ServerLog[] {
    return this.ring.slice();
  }

  private log(level: ServerLog["level"], message: string) {
    const entry: ServerLog = { ts: Date.now(), level, message };
    this.ring.push(entry);
    if (this.ring.length > RING) this.ring.shift();
    this.emit("log", entry);
  }

  private updateStatus(partial: Partial<ServerStatus>) {
    this.status = { ...this.status, ...partial };
    this.emit("status", this.getStatus());
  }

  private computeLanUrls(): string[] {
    // If bound to a specific IP, only show that URL. Otherwise show
    // every reachable LAN IP plus localhost.
    if (this.hostname !== "0.0.0.0") {
      return [`http://${this.hostname}:${this.status.port}`];
    }
    const ips = lanIps();
    return ips.length > 0
      ? ips.map((ip) => `http://${ip}:${this.status.port}`)
      : [`http://127.0.0.1:${this.status.port}`];
  }

  async start(): Promise<void> {
    if (this.proc) return;
    this.stopping = false;
    this.updateStatus({ phase: "starting", error: null });

    const dataDir = getDataDir();
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

    const entry = findServerEntry();
    if (entry.mode === "missing") {
      this.log(
        "err",
        "No Next.js server found. Run `npm install` at the repo root, or `npm run build` for the standalone build."
      );
      this.updateStatus({ phase: "error", error: "Server build missing" });
      return;
    }

    // Standalone runs through Electron's bundled Node — no system Node needed
    // at runtime. Dev mode (next dev) needs system Node because Tailwind v4
    // ships native Lightning CSS bindings compiled against Node 22, not
    // Electron's Node 20.
    const baseEnv = {
      ...process.env,
      PORT: String(this.status.port),
      HOSTNAME: this.hostname,
      NEXUS_DATA_DIR: dataDir,
    } as NodeJS.ProcessEnv;

    if (entry.mode === "standalone") {
      this.log("info", `Spawning Next.js standalone on ${this.hostname}:${this.status.port}`);
      this.proc = spawn(process.execPath, [entry.entry], {
        cwd: entry.cwd,
        env: {
          ...baseEnv,
          ELECTRON_RUN_AS_NODE: "1",
          NODE_ENV: "production",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } else {
      const systemNode = findSystemNode();
      if (!systemNode) {
        this.log(
          "err",
          "Dev mode needs system Node.js — install Node 22 from nodejs.org or run `npm run build` once to use the standalone build instead."
        );
        this.updateStatus({ phase: "error", error: "Node.js not found" });
        return;
      }
      this.log(
        "info",
        `Spawning Next.js dev (hot reload) via ${systemNode} on ${this.hostname}:${this.status.port}`
      );
      this.proc = spawn(
        systemNode,
        [entry.nextBin, "dev", "-p", String(this.status.port), "-H", this.hostname],
        {
          cwd: entry.cwd,
          env: { ...baseEnv, NODE_ENV: "development" },
          stdio: ["ignore", "pipe", "pipe"],
        }
      );
    }

    this.proc.stdout?.on("data", (buf: Buffer) => {
      const text = buf.toString().trim();
      if (!text) return;
      for (const line of text.split(/\r?\n/)) {
        this.log("info", line);
        if (/ready|started|listening/i.test(line) && this.status.phase !== "running") {
          this.updateStatus({ phase: "running" });
        }
      }
    });

    this.proc.stderr?.on("data", (buf: Buffer) => {
      const text = buf.toString().trim();
      if (!text) return;
      for (const line of text.split(/\r?\n/)) this.log("warn", line);
    });

    // Capture THIS spawn so the exit handler reads a per-process "was this
    // an intentional stop?" flag instead of the shared `this.stopping`
    // (which a racing restart could flip, misattributing a clean stop as a
    // crash).
    const proc = this.proc as ChildProcess & { __stopping?: boolean };

    proc.on("error", (err) => {
      this.log("err", `Server process failed to start: ${err.message}`);
      if (this.runningTimer) {
        clearTimeout(this.runningTimer);
        this.runningTimer = null;
      }
      this.updateStatus({ phase: "error", error: err.message });
      if (this.proc === proc) this.proc = null;
    });

    proc.on("exit", (code, signal) => {
      this.log("warn", `Server exited (code=${code}, signal=${signal ?? "-"})`);
      if (this.runningTimer) {
        clearTimeout(this.runningTimer);
        this.runningTimer = null;
      }
      const wasStopping = proc.__stopping === true;
      // Only clear the live handle if it's still THIS process (a newer
      // start may have already replaced it).
      if (this.proc === proc) this.proc = null;
      // Don't clobber a newer process's status with this old one's exit.
      if (this.proc !== null) return;
      if (!wasStopping) {
        this.updateStatus({
          phase: "error",
          error: `Server exited unexpectedly (code ${code})`,
        });
      } else {
        this.updateStatus({ phase: "stopped" });
      }
    });

    // Optimistic: declare running after a short delay if no errors fired.
    // Tracked so stop()/exit can cancel it.
    this.runningTimer = setTimeout(() => {
      this.runningTimer = null;
      if (this.proc === proc && this.status.phase === "starting") {
        this.updateStatus({ phase: "running" });
      }
    }, 2000);
  }

  async stop(): Promise<void> {
    if (!this.proc) return;
    if (this.runningTimer) {
      clearTimeout(this.runningTimer);
      this.runningTimer = null;
    }
    this.stopping = true;
    const p = this.proc as ChildProcess & { __stopping?: boolean };
    p.__stopping = true;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      p.once("exit", finish);
      if (platform() === "win32" && p.pid) {
        // `next dev` forks a worker that actually binds the port; a plain
        // kill() signals only the immediate child and orphans the worker
        // (port stays held). Kill the whole process tree on Windows.
        try {
          execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: "ignore" });
        } catch {
          /* already gone / not found */
        }
      } else {
        p.kill();
      }
      // Failsafe in case the process refuses to die.
      setTimeout(() => {
        try {
          p.kill("SIGKILL");
        } catch {}
        finish();
      }, 3000);
    });
    this.proc = null;
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }
}

