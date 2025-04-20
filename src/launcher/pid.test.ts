import { vi, describe, it, expect, beforeEach } from "vitest";
import { PIDListManager, PIDManager } from "./pid";
import { join } from "path";
import * as fs from "fs";
import { defaultAppDir } from "../path";

// Mock the fs module
vi.mock("fs", () => {
  return {
    existsSync: vi.fn(),
    promises: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
    },
  };
});

// Create properly typed mock functions
const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFile = vi.mocked(fs.promises.readFile);
const mockWriteFile = vi.mocked(fs.promises.writeFile);

const buildMockPidManager = (override?: {
  get?: PIDManager["get"];
  kill?: PIDManager["kill"];
}) => {
  return {
    get: override?.get ?? (() => 12345),
    kill: vi.fn(override?.kill),
  };
};

describe("PIDListManager", () => {
  const expectedFilePath = join(defaultAppDir, ".mcp_servers.json");

  beforeEach(() => {
    vi.resetAllMocks();

    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(JSON.stringify({ pids: [] }));
    mockWriteFile.mockResolvedValue(undefined);
  });

  const mockNoActivePidsCallback = vi.fn();
  const manager = new PIDListManager({
    onNoActivePids: mockNoActivePidsCallback,
    manager: buildMockPidManager(),
  });

  describe("addPid", () => {
    it("should add current PID to the list when list is empty", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ pids: [] }));

      await manager.addPid();

      expect(mockWriteFile).toHaveBeenCalledWith(
        expectedFilePath,
        JSON.stringify({ pids: [12345] }),
        "utf8"
      );
    });

    it("should add current PID to the list when list has other PIDs", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ pids: [9999, 8888] }));

      await manager.addPid();

      expect(mockWriteFile).toHaveBeenCalledWith(
        expectedFilePath,
        JSON.stringify({ pids: [9999, 8888, 12345] }),
        "utf8"
      );
    });

    it("should not add duplicate PIDs", async () => {
      // Setup mock to return a list that already includes the current PID
      mockReadFile.mockResolvedValue(
        JSON.stringify({ pids: [9999, 12345, 8888] })
      );

      await manager.addPid();

      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it("should handle file creation if file doesn't exist", async () => {
      // Mock existsSync to return false (file doesn't exist)
      mockExistsSync.mockReturnValue(false);

      await manager.addPid();

      expect(mockWriteFile).toHaveBeenCalledWith(
        expectedFilePath,
        JSON.stringify({ pids: [12345] }),
        "utf8"
      );
    });

    it("should handle read errors gracefully", async () => {
      // Mock readFile to throw the error
      const enoentError = new Error("ENOENT: no such file or directory");
      mockReadFile.mockRejectedValue(enoentError);

      await expect(manager.addPid()).resolves.not.toThrow();

      expect(mockWriteFile).toHaveBeenCalledWith(
        expectedFilePath,
        JSON.stringify({ pids: [12345] }),
        "utf8"
      );
    });
  });

  describe("removePid", () => {
    // Create instance with mock manager
    const manager = new PIDListManager({
      onNoActivePids: mockNoActivePidsCallback,
      manager: buildMockPidManager(),
    });

    it("should remove current PID from the list", async () => {
      // Setup mock to return a list with multiple PIDs including the current one
      mockReadFile.mockResolvedValue(
        JSON.stringify({ pids: [9999, 12345, 8888] })
      );

      await manager.removePid();

      // Verify writeFile was called with the list excluding the current PID
      expect(mockWriteFile).toHaveBeenCalledWith(
        expectedFilePath,
        JSON.stringify({ pids: [9999, 8888] }),
        "utf8"
      );

      // Verify onNoActivePids was not called since there are still active PIDs
      expect(mockNoActivePidsCallback).not.toHaveBeenCalled();
    });

    it("should call onNoActivePids when no active PIDs remain", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ pids: [12345] }));

      await manager.removePid();

      expect(mockWriteFile).toHaveBeenCalledWith(
        expectedFilePath,
        JSON.stringify({ pids: [] }),
        "utf8"
      );

      // Verify onNoActivePids was called
      expect(mockNoActivePidsCallback).toHaveBeenCalled();
    });

    it("should filter out inactive PIDs", async () => {
      // Setup mock to return a list with multiple PIDs
      mockReadFile.mockResolvedValue(
        JSON.stringify({ pids: [9999, 12345, 8888] })
      );

      const manager = new PIDListManager({
        onNoActivePids: mockNoActivePidsCallback,
        manager: buildMockPidManager({
          kill: (pid, signal) => {
            // When checking if active (signal === 0), throw error for inactive PIDs (9999)
            if (signal === 0 && pid === 9999) {
              throw new Error("No such process");
            }
          },
        }),
      });

      await manager.removePid();

      // Verify writeFile was called with only the active PID (8888)
      expect(mockWriteFile).toHaveBeenCalledWith(
        expectedFilePath,
        JSON.stringify({ pids: [8888] }),
        "utf8"
      );

      // Verify onNoActivePids was not called since there is still an active PID
      expect(mockNoActivePidsCallback).not.toHaveBeenCalled();
    });

    it("should call onNoActivePids when all PIDs are inactive", async () => {
      // Setup mock to return a list with multiple PIDs
      mockReadFile.mockResolvedValue(
        JSON.stringify({ pids: [9999, 12345, 8888] })
      );

      const manager = new PIDListManager({
        onNoActivePids: mockNoActivePidsCallback,
        manager: buildMockPidManager({
          kill: (pid, signal) => {
            // When checking if active (signal === 0), throw error for all PIDs except the current one
            if (signal === 0 && pid !== 12345) {
              throw new Error("No such process");
            }
          },
        }),
      });

      await manager.removePid();

      // Verify writeFile was called with an empty list
      expect(mockWriteFile).toHaveBeenCalledWith(
        expectedFilePath,
        JSON.stringify({ pids: [] }),
        "utf8"
      );

      // Verify onNoActivePids was called
      expect(mockNoActivePidsCallback).toHaveBeenCalled();
    });
  });
});
