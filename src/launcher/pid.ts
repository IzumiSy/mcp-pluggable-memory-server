import { existsSync, unlinkSync, promises as fsPromises } from "fs";
import { join } from "path";
import { homedir } from "os";
const PID_LIST_PATH = join(
  homedir(),
  ".local",
  "share",
  "duckdb-memory-server",
  ".mcp_servers.json"
);

/**
 * PIDリストを読み込む関数
 * @returns 接続中のMCPサーバーのPIDリスト
 */
export async function readPidList(): Promise<number[]> {
  try {
    if (existsSync(PID_LIST_PATH)) {
      const data = await fsPromises.readFile(PID_LIST_PATH, "utf8");
      return JSON.parse(data);
    }
    return [];
  } catch (error) {
    console.error("Error reading PID list:", error);
    return [];
  }
}

/**
 * PIDリストを書き込む関数
 * @param pids 書き込むPIDリスト
 */
export async function writePidList(pids: number[]): Promise<void> {
  try {
    await fsPromises.writeFile(PID_LIST_PATH, JSON.stringify(pids), "utf8");
  } catch (error) {
    console.error("Error writing PID list:", error);
  }
}

/**
 * PIDが有効かチェックする関数
 * @param pid チェックするプロセスID
 * @returns プロセスが存在する場合はtrue、存在しない場合はfalse
 */
export function isPidActive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * 起動時にPIDを追加
 */
export async function addPid(): Promise<void> {
  // PIDリストファイルのディレクトリが存在することを確認
  const pidListDir = join(homedir(), ".local", "share", "duckdb-memory-server");
  if (!existsSync(pidListDir)) {
    await fsPromises.mkdir(pidListDir, { recursive: true });
  }

  const pids = await readPidList();
  if (!pids.includes(process.pid)) {
    pids.push(process.pid);
    await writePidList(pids);
  }
}

/**
 * シャットダウン時にPIDを削除し、必要に応じてソケットファイルを削除
 * @param socketPath ソケットファイルのパス
 */
export async function removePid(socketPath: string): Promise<void> {
  let pids = await readPidList();

  // 自身のPIDを削除
  pids = pids.filter((pid) => pid !== process.pid);

  // 存在しないプロセスのPIDを削除
  pids = pids.filter((pid) => isPidActive(pid));

  // リストが空になった場合のみソケットファイルを削除
  if (pids.length === 0 && existsSync(socketPath)) {
    console.log(`Cleaning up socket file: ${socketPath}`);
    unlinkSync(socketPath);
  }

  // 更新されたリストを書き込み
  await writePidList(pids);
}
