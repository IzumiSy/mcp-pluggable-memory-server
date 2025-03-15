#!/usr/bin/env node
import Fastify from "fastify";
import { join } from "path";
import { homedir } from "os";
import { DuckDBKnowledgeGraphManager } from "./manager";
import { NullLogger } from "./logger";
import { existsSync, mkdirSync } from "fs";
import { Entity, Relation, Observation } from "./types";
import { defaultSocketPath } from "../client/client";

// ソケットファイルのパス
const SOCKET_PATH = process.env.SOCKET_PATH ?? defaultSocketPath;

// ロガーの設定
const logger = new NullLogger();

// DuckDBマネージャーの初期化
const knowledgeGraphManager = new DuckDBKnowledgeGraphManager(() => {
  // 既存のコードと同様のDB初期化ロジック
  const defaultDir = join(homedir(), ".local", "share", "duckdb-memory-server");
  const defaultPath = join(defaultDir, "knowledge-graph.data");

  if (!existsSync(defaultDir)) {
    mkdirSync(defaultDir, { recursive: true });
  }

  return process.env.MEMORY_FILE_PATH || defaultPath;
}, logger);

// JSON-RPCエラーコード定義
const JsonRpcErrorCode = {
  // 標準エラーコード
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,

  // カスタムエラーコード
  DATABASE_ERROR: -32000,
  ENTITY_NOT_FOUND: -32001,
  DUPLICATE_ENTITY: -32002,
  VALIDATION_ERROR: -32003,
} as const;

// エラーレスポンス生成ヘルパー
const createErrorResponse = (
  id: string | number | null,
  code: (typeof JsonRpcErrorCode)[keyof typeof JsonRpcErrorCode],
  message: string,
  data?: unknown
) => ({
  jsonrpc: "2.0",
  id,
  error: {
    code,
    message,
    data,
  },
});

// JSON-RPCメソッドの実装
const methods: Record<string, (params: any) => Promise<any>> = {
  // エンティティ作成
  async createEntities(params: { entities: Entity[] }) {
    return await knowledgeGraphManager.createEntities(params.entities);
  },

  // リレーション作成
  async createRelations(params: { relations: Relation[] }) {
    return await knowledgeGraphManager.createRelations(params.relations);
  },

  // 観察追加
  async addObservations(params: { observations: Observation[] }) {
    return await knowledgeGraphManager.addObservations(params.observations);
  },

  // エンティティ削除
  async deleteEntities(params: { entityNames: string[] }) {
    await knowledgeGraphManager.deleteEntities(params.entityNames);
    return { success: true };
  },

  // 観察削除
  async deleteObservations(params: { deletions: Observation[] }) {
    await knowledgeGraphManager.deleteObservations(params.deletions);
    return { success: true };
  },

  // リレーション削除
  async deleteRelations(params: { relations: Relation[] }) {
    await knowledgeGraphManager.deleteRelations(params.relations);
    return { success: true };
  },

  // ノード検索
  async searchNodes(params: { query: string }) {
    return await knowledgeGraphManager.searchNodes(params.query);
  },

  // ノード取得
  async openNodes(params: { names: string[] }) {
    return await knowledgeGraphManager.openNodes(params.names);
  },

  // ヘルスチェック
  async health() {
    return { status: "ok" };
  },
};

const server = Fastify();

// JSON-RPCエンドポイント
server.post("/rpc", async (request, reply) => {
  const rpcRequest = request.body as {
    jsonrpc: string;
    id: string | number;
    method: string;
    params: any;
  };

  // JSON-RPC 2.0の検証
  if (rpcRequest.jsonrpc !== "2.0") {
    return reply
      .status(400)
      .send(
        createErrorResponse(
          rpcRequest.id || null,
          JsonRpcErrorCode.INVALID_REQUEST,
          "Invalid Request"
        )
      );
  }

  // メソッドの存在確認
  const method = methods[rpcRequest.method];
  if (!method) {
    return reply.send(
      createErrorResponse(
        rpcRequest.id,
        JsonRpcErrorCode.METHOD_NOT_FOUND,
        "Method not found"
      )
    );
  }

  try {
    // メソッド実行
    const result = await method(rpcRequest.params);

    // 成功レスポンス
    return reply.send({
      jsonrpc: "2.0",
      id: rpcRequest.id,
      result,
    });
  } catch (error) {
    // エラーレスポンス
    return reply.send(
      createErrorResponse(
        rpcRequest.id,
        JsonRpcErrorCode.INTERNAL_ERROR,
        error instanceof Error ? error.message : "Unknown error"
      )
    );
  }
});

// サーバー起動
const start = async () => {
  const socketDir = join(homedir(), ".local", "share", "duckdb-memory-server");

  try {
    // ソケットディレクトリの作成
    if (!existsSync(socketDir)) {
      mkdirSync(socketDir, { recursive: true });
    }

    await server.listen({ path: SOCKET_PATH });
  } catch (err) {
    process.exit(1);
  }
};

start();
