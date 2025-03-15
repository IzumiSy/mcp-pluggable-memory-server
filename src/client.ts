import {
  KnowledgeGraphManagerInterface,
  Entity,
  Relation,
  Observation,
  KnowledgeGraph,
} from "./db-server/types";
import { join } from "path";
import { homedir } from "os";
import { Client } from "undici";

export const defaultSocketPath = join(
  homedir(),
  ".local",
  "share",
  "duckdb-memory-server",
  "db-server.sock"
);

/**
 * JSON-RPCを使用してDBサーバーと通信するクライアント
 */
export class KnowledgeGraphClient implements KnowledgeGraphManagerInterface {
  private client: Client;

  constructor(socketPath?: string) {
    this.client = new Client("http://localhost", {
      socketPath: socketPath ?? defaultSocketPath,
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
  private async jsonRpcRequest<T>(method: string, params: unknown) {
    const { statusCode, body } = await this.client.request({
      method: "POST",
      path: "/rpc",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method,
        params,
      }),
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
  }

  // KnowledgeGraphManagerInterfaceの実装

  async createEntities(entities: Entity[]): Promise<Entity[]> {
    return this.jsonRpcRequest<Entity[]>("createEntities", {
      entities,
    });
  }

  async createRelations(relations: Relation[]): Promise<Relation[]> {
    return this.jsonRpcRequest<Relation[]>("createRelations", {
      relations,
    });
  }

  async addObservations(
    observations: Array<Observation>
  ): Promise<Observation[]> {
    return this.jsonRpcRequest<Observation[]>("addObservations", {
      observations,
    });
  }

  async deleteEntities(entityNames: string[]): Promise<void> {
    await this.jsonRpcRequest<{ success: boolean }>("deleteEntities", {
      entityNames,
    });
  }

  async deleteObservations(deletions: Array<Observation>): Promise<void> {
    await this.jsonRpcRequest<{ success: boolean }>("deleteObservations", {
      deletions,
    });
  }

  async deleteRelations(relations: Relation[]): Promise<void> {
    await this.jsonRpcRequest<{ success: boolean }>("deleteRelations", {
      relations,
    });
  }

  async searchNodes(query: string): Promise<KnowledgeGraph> {
    return this.jsonRpcRequest<KnowledgeGraph>("searchNodes", {
      query,
    });
  }

  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    return this.jsonRpcRequest<KnowledgeGraph>("openNodes", { names });
  }
}
