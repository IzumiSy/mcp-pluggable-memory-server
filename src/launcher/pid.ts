import { existsSync, promises as fsPromises } from "fs";
import { z } from "zod";
import { defaultAppDir } from "../path";
import { join } from "path";

const fileSchema = z.object({
  pids: z.array(z.number()),
});

type PIDManager = {
  get: () => number;
  kill: (pid: number, signal?: string | number) => void;
};

export class PIDListManager {
  private pidListFilePath: string;
  private onNoActivePids: () => void;
  private pidManager: PIDManager;

  constructor(props: { onNoActivePids: () => void; manager?: PIDManager }) {
    this.pidManager = props.manager ?? nodejsPidManager;
    this.pidListFilePath = join(defaultAppDir, ".mcp_servers.json");
    this.onNoActivePids = props.onNoActivePids;
  }

  /**
   * A function to add the current PID to the list
   */
  async addPid() {
    const pids = await this.read();
    const pid = this.pidManager.get();
    if (!pids.includes(pid)) {
      pids.push(pid);
      await this.write(pids);
    }
  }

  /**
   * A function to remove the PID from the list
   */
  async removePid() {
    const activePids = (await this.read())
      .filter((pid) => pid !== this.pidManager.get())
      .filter(this.isPidActive);

    if (activePids.length === 0) {
      this.onNoActivePids();
    }

    await this.write(activePids);
  }

  /**
   * A function to read PID list
   */
  private async read() {
    try {
      if (!existsSync(this.pidListFilePath)) {
        return [];
      }

      const data = await fsPromises.readFile(this.pidListFilePath, "utf8");
      if (!data || data.trim() === "") {
        return [];
      }

      const jsonData = JSON.parse(data);
      const validatedData = fileSchema.parse(jsonData);
      return validatedData.pids;
    } catch (error) {
      if (error instanceof Error && error.message.includes("ENOENT")) {
        return [];
      }
      throw error;
    }
  }

  /**
   * A function to write PID list
   */
  private async write(pids: number[]) {
    await fsPromises.writeFile(
      this.pidListFilePath,
      JSON.stringify({ pids }),
      "utf8"
    );
  }

  /**
   * A function to check if a PID is active
   */
  private isPidActive(pid: number) {
    try {
      this.pidManager.kill(pid, 0);
      return true;
    } catch (error) {
      return false;
    }
  }
}

const nodejsPidManager: PIDManager = {
  get: () => process.pid,
  kill: (pid: number, signal?: string | number) => process.kill(pid, signal),
};
