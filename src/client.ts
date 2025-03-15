import {
  KnowledgeGraphManagerInterface,
  Entity,
  Relation,
  Observation,
  KnowledgeGraph,
} from "./types";
import { Logger, ConsoleLogger } from "./logger";
import { join } from "path";
import { homedir } from "os";
import { Client, Dispatcher } from "undici";
import { extractError } from "./utils";

/**
 * JSON-RPCを使用してDBサーバーと通信するクライアント
 */
export class KnowledgeGraphClient implements KnowledgeGraphManagerInterface {
  private logger: Logger;
  private socketPath: string;
  private client: Client;
  private requestId: number = 0;

  constructor(socketPath?: string, logger?: Logger) {
    this.socketPath =
      socketPath ||
      join(
        homedir(),
        ".local",
        "share",
        "duckdb-memory-server",
        "db-server.sock"
      );
    this.logger = logger || new ConsoleLogger();

    // Unix socketに接続するundiciクライアントを作成
    this.client = new Client("http://localhost", {
      socketPath: this.socketPath,
      keepAliveTimeout: 10000, // 10秒
      keepAliveMaxTimeout: 60000, // 1分
    });
  }

  /**
   * リソース解放
   */
  async close(): Promise<void> {
    await this.client.close();
  }

  /**
   * JSON-RPCリクエストを送信
   */
  private async jsonRpcRequest<T>(method: string, params: any): Promise<T> {
    try {
      // リクエストIDをインクリメント
      const id = ++this.requestId;

      // JSON-RPCリクエストの構築
      const rpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      // リクエスト送信
      const { statusCode, body } = await this.client.request({
        method: "POST",
        path: "/rpc",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(rpcRequest),
      });

      // HTTPエラーのチェック
      if (statusCode >= 400) {
        const errorText = await body.text();
        throw new Error(`HTTP error ${statusCode}: ${errorText}`);
      }

      // JSON-RPCレスポンスのパース
      const response = (await body.json()) as {
        jsonrpc: string;
        id: number;
        result?: T;
        error?: {
          code: number;
          message: string;
        };
      };

      // JSON-RPCエラーのチェック
      if (response.error) {
        throw new Error(
          `JSON-RPC error ${response.error.code}: ${response.error.message}`
        );
      }

      // 結果を返す
      return response.result as T;
    } catch (error) {
      this.logger.error(
        `Error in JSON-RPC request to method ${method}`,
        extractError(error)
      );
      throw error;
    }
  }

  /**
   * リトライ機能付きJSON-RPCリクエスト
   */
  private async jsonRpcRequestWithRetry<T>(
    method: string,
    params: any,
    retries: number = 3
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await this.jsonRpcRequest<T>(method, params);
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(
          `Request failed (attempt ${attempt + 1}/${retries})`,
          extractError(error)
        );

        // 最後の試行以外は待機してから再試行
        if (attempt < retries - 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * Math.pow(2, attempt))
          );
        }
      }
    }

    throw lastError;
  }

  // KnowledgeGraphManagerInterfaceの実装

  async createEntities(entities: Entity[]): Promise<Entity[]> {
    return this.jsonRpcRequestWithRetry<Entity[]>("createEntities", {
      entities,
    });
  }

  async createRelations(relations: Relation[]): Promise<Relation[]> {
    return this.jsonRpcRequestWithRetry<Relation[]>("createRelations", {
      relations,
    });
  }

  async addObservations(
    observations: Array<Observation>
  ): Promise<Observation[]> {
    return this.jsonRpcRequestWithRetry<Observation[]>("addObservations", {
      observations,
    });
  }

  async deleteEntities(entityNames: string[]): Promise<void> {
    await this.jsonRpcRequestWithRetry<{ success: boolean }>("deleteEntities", {
      entityNames,
    });
  }

  async deleteObservations(deletions: Array<Observation>): Promise<void> {
    await this.jsonRpcRequestWithRetry<{ success: boolean }>(
      "deleteObservations",
      { deletions }
    );
  }

  async deleteRelations(relations: Relation[]): Promise<void> {
    await this.jsonRpcRequestWithRetry<{ success: boolean }>(
      "deleteRelations",
      { relations }
    );
  }

  async searchNodes(query: string): Promise<KnowledgeGraph> {
    return this.jsonRpcRequestWithRetry<KnowledgeGraph>("searchNodes", {
      query,
    });
  }

  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    return this.jsonRpcRequestWithRetry<KnowledgeGraph>("openNodes", { names });
  }
}
