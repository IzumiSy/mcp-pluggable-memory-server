import {
  KnowledgeGraphManagerInterface,
  Entity,
  Relation,
  Observation,
  KnowledgeGraph,
} from "./types";
import { DuckDBInstance, DuckDBConnection } from "@duckdb/node-api";
import Fuse from "fuse.js";
import { dirname } from "path";
import { existsSync, mkdirSync } from "fs";

/**
 * An implementation of the KnowledgeGraphManagerInterface that uses DuckDB and Fuse.js
 */
export class DuckDBKnowledgeGraphManager
  implements KnowledgeGraphManagerInterface
{
  private instance: DuckDBInstance;
  private conn: DuckDBConnection;
  private fuse: Fuse<Entity>;
  private initialized: boolean = false;
  private dbPath: string;

  /**
   * Constructor
   * @param dbPath Path to the database file
   */
  constructor(dbPath: string) {
    this.dbPath = dbPath;

    // ディレクトリが存在しない場合は作成
    if (!existsSync(dirname(dbPath))) {
      mkdirSync(dirname(dbPath), { recursive: true });
    }

    // DuckDBの初期化は非同期なので、constructorでは初期化せず、initialize()メソッドで行う
    this.instance = null as any;
    this.conn = null as any;

    // Fuse.jsの初期化
    this.fuse = new Fuse<Entity>([], {
      keys: ["name", "entityType", "observations"],
      includeScore: true,
      threshold: 0.4, // Search strictness (closer to 0 means more strict)
    });
  }

  /**
   * Initialize the database
   * @private
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // DuckDBの初期化
      if (!this.instance) {
        this.instance = await DuckDBInstance.create(this.dbPath);
        this.conn = await this.instance.connect();
      }

      // テーブルの作成
      await this.conn.run(`
        CREATE TABLE IF NOT EXISTS entities (
          name VARCHAR PRIMARY KEY,
          entityType VARCHAR
        );
      `);

      await this.conn.run(`
        CREATE TABLE IF NOT EXISTS observations (
          entityName VARCHAR,
          content VARCHAR,
          FOREIGN KEY (entityName) REFERENCES entities(name),
          PRIMARY KEY (entityName, content)
        );
      `);

      await this.conn.run(`
        CREATE TABLE IF NOT EXISTS relations (
          from_entity VARCHAR,
          to_entity VARCHAR,
          relationType VARCHAR,
          FOREIGN KEY (from_entity) REFERENCES entities(name),
          FOREIGN KEY (to_entity) REFERENCES entities(name),
          PRIMARY KEY (from_entity, to_entity, relationType)
        );
      `);

      // インデックスの作成
      await this.conn.run(`
        CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entityType);
      `);

      await this.conn.run(`
        CREATE INDEX IF NOT EXISTS idx_observations_entity ON observations(entityName);
        CREATE INDEX IF NOT EXISTS idx_observations_content ON observations(content);
      `);

      await this.conn.run(`
        CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_entity);
        CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_entity);
        CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(relationType);
      `);

      // Fuse.jsのインデックスを構築
      const entities = await this.getAllEntities();
      this.fuse.setCollection(entities);

      this.initialized = true;
    } catch (error) {
      console.error("Failed to initialize database:", error);
      this.initialized = true;
    }
  }

  /**
   * Get all entities from the database
   * @private
   */
  private async getAllEntities(): Promise<Entity[]> {
    try {
      // LEFT JOINを使用してエンティティと観察を一度に取得
      const reader = await this.conn.runAndReadAll(`
        SELECT e.name, e.entityType, o.content
        FROM entities e
        LEFT JOIN observations o ON e.name = o.entityName
      `);
      const rows = reader.getRows();

      // 結果をエンティティごとにグループ化
      const entitiesMap = new Map<string, Entity>();

      for (const row of rows) {
        const name = row[0] as string;
        const entityType = row[1] as string;
        const content = row[2] as string | null;

        if (!entitiesMap.has(name)) {
          // 新しいエンティティを作成
          entitiesMap.set(name, {
            name,
            entityType,
            observations: content ? [content] : [],
          });
        } else if (content) {
          // 既存のエンティティに観察を追加
          entitiesMap.get(name)!.observations.push(content);
        }
      }

      return Array.from(entitiesMap.values());
    } catch (error) {
      console.error("Error getting all entities:", error);
      return [];
    }
  }

  /**
   * Create entities
   * @param entities Array of entities to create
   * @returns Array of created entities
   */
  async createEntities(entities: Entity[]): Promise<Entity[]> {
    await this.initialize();

    const createdEntities: Entity[] = [];

    // トランザクションを開始
    await this.conn.run("BEGIN TRANSACTION");

    try {
      // 既存のエンティティ名を取得
      const existingEntitiesReader = await this.conn.runAndReadAll(
        "SELECT name FROM entities"
      );
      const existingEntitiesData = existingEntitiesReader.getRows();
      const nameColumnIndex = 0; // name列は最初の列
      const existingNames = new Set(
        existingEntitiesData.map((row) => row[nameColumnIndex] as string)
      );

      // 新しいエンティティをフィルタリング
      const newEntities = entities.filter(
        (entity) => !existingNames.has(entity.name)
      );

      // 新しいエンティティを挿入
      for (const entity of newEntities) {
        // エンティティを挿入
        await this.conn.run(
          "INSERT INTO entities (name, entityType) VALUES (?, ?)",
          [entity.name, entity.entityType]
        );

        // 観察を挿入
        for (const observation of entity.observations) {
          await this.conn.run(
            "INSERT INTO observations (entityName, content) VALUES (?, ?)",
            [entity.name, observation]
          );
        }

        createdEntities.push(entity);
      }

      // トランザクションをコミット
      await this.conn.run("COMMIT");

      // Fuse.jsのインデックスを更新
      const allEntities = await this.getAllEntities();
      this.fuse.setCollection(allEntities);

      return createdEntities;
    } catch (error) {
      // エラーが発生した場合はロールバック
      await this.conn.run("ROLLBACK");
      console.error("Error creating entities:", error);
      throw error;
    }
  }

  /**
   * Create relations
   * @param relations Array of relations to create
   * @returns Array of created relations
   */
  async createRelations(relations: Relation[]): Promise<Relation[]> {
    await this.initialize();

    // トランザクションを開始
    await this.conn.run("BEGIN TRANSACTION");

    try {
      // エンティティ名のセットを取得
      const entityNamesReader = await this.conn.runAndReadAll(
        "SELECT name FROM entities"
      );
      const entityNamesData = entityNamesReader.getRows();
      const nameColumnIndex = 0; // name列は最初の列
      const entityNames = new Set(
        entityNamesData.map((row) => row[nameColumnIndex] as string)
      );

      // 有効なリレーションをフィルタリング（fromとtoの両方のエンティティが存在する必要がある）
      const validRelations = relations.filter(
        (relation) =>
          entityNames.has(relation.from) && entityNames.has(relation.to)
      );

      // 既存のリレーションを取得
      const existingRelationsReader = await this.conn.runAndReadAll(
        'SELECT from_entity as "from", to_entity as "to", relationType FROM relations'
      );
      const existingRelationsData = existingRelationsReader.getRows();

      // 結果をRelationオブジェクトの配列に変換
      const existingRelations = existingRelationsData.map((row) => {
        return {
          from: row[0] as string,
          to: row[1] as string,
          relationType: row[2] as string,
        };
      });

      // 新しいリレーションをフィルタリング
      const newRelations = validRelations.filter(
        (newRel) =>
          !existingRelations.some(
            (existingRel) =>
              existingRel.from === newRel.from &&
              existingRel.to === newRel.to &&
              existingRel.relationType === newRel.relationType
          )
      );

      // 新しいリレーションを挿入
      for (const relation of newRelations) {
        await this.conn.run(
          "INSERT INTO relations (from_entity, to_entity, relationType) VALUES (?, ?, ?)",
          [relation.from, relation.to, relation.relationType]
        );
      }

      // トランザクションをコミット
      await this.conn.run("COMMIT");

      return newRelations;
    } catch (error) {
      // エラーが発生した場合はロールバック
      await this.conn.run("ROLLBACK");
      console.error("Error creating relations:", error);
      throw error;
    }
  }

  /**
   * Add observations to entities
   * @param observations Array of observations to add
   * @returns Array of added observations
   */
  async addObservations(
    observations: Array<Observation>
  ): Promise<Observation[]> {
    await this.initialize();

    const addedObservations: Observation[] = [];

    // トランザクションを開始
    await this.conn.run("BEGIN TRANSACTION");

    try {
      // 各観察を処理
      for (const observation of observations) {
        // エンティティが存在するか確認
        const entityReader = await this.conn.runAndReadAll(
          "SELECT name FROM entities WHERE name = ?",
          [observation.entityName as string]
        );
        const entityRows = entityReader.getRows();
        // 行数で存在確認

        // エンティティが存在する場合
        if (entityRows.length > 0) {
          // 既存の観察を取得
          const existingObservationsReader = await this.conn.runAndReadAll(
            "SELECT content FROM observations WHERE entityName = ?",
            [observation.entityName as string]
          );
          const existingObservationsData = existingObservationsReader.getRows();
          const contentColumnIndex = 0; // content列は最初の列
          const existingObservations = new Set(
            existingObservationsData.map(
              (row) => row[contentColumnIndex] as string
            )
          );

          // 新しい観察をフィルタリング
          const newContents = observation.contents.filter(
            (content) => !existingObservations.has(content)
          );

          // 新しい観察を挿入
          if (newContents.length > 0) {
            for (const content of newContents) {
              await this.conn.run(
                "INSERT INTO observations (entityName, content) VALUES (?, ?)",
                [observation.entityName, content]
              );
            }

            addedObservations.push({
              entityName: observation.entityName,
              contents: newContents,
            });
          }
        }
      }

      // トランザクションをコミット
      await this.conn.run("COMMIT");

      // Fuse.jsのインデックスを更新
      const allEntities = await this.getAllEntities();
      this.fuse.setCollection(allEntities);

      return addedObservations;
    } catch (error) {
      // エラーが発生した場合はロールバック
      await this.conn.run("ROLLBACK");
      console.error("Error adding observations:", error);
      throw error;
    }
  }

  /**
   * Delete entities
   * @param entityNames Array of entity names to delete
   */
  async deleteEntities(entityNames: string[]): Promise<void> {
    await this.initialize();

    if (entityNames.length === 0) return;

    try {
      // プレースホルダーを作成
      const placeholders = entityNames.map(() => "?").join(",");

      // 関連する観察を先に削除
      try {
        await this.conn.run(
          `DELETE FROM observations WHERE entityName IN (${placeholders})`,
          entityNames
        );
      } catch (error) {
        console.error("Error deleting observations:", error);
        // エラーを無視して続行
      }

      // 関連するリレーションを削除
      try {
        await this.conn.run(
          `DELETE FROM relations WHERE from_entity IN (${placeholders}) OR to_entity IN (${placeholders})`,
          [...entityNames, ...entityNames]
        );
      } catch (error) {
        console.error("Error deleting relations:", error);
        // エラーを無視して続行
      }

      // エンティティを削除
      await this.conn.run(
        `DELETE FROM entities WHERE name IN (${placeholders})`,
        entityNames
      );

      // Fuse.jsのインデックスを更新
      const allEntities = await this.getAllEntities();
      this.fuse.setCollection(allEntities);
    } catch (error) {
      console.error("Error deleting entities:", error);
      throw error;
    }
  }

  /**
   * Delete observations from entities
   * @param deletions Array of observations to delete
   */
  async deleteObservations(deletions: Array<Observation>): Promise<void> {
    await this.initialize();

    // トランザクションを開始
    await this.conn.run("BEGIN TRANSACTION");

    try {
      // 各削除を処理
      for (const deletion of deletions) {
        // 削除する観察がある場合
        if (deletion.contents.length > 0) {
          for (const content of deletion.contents) {
            await this.conn.run(
              "DELETE FROM observations WHERE entityName = ? AND content = ?",
              [deletion.entityName, content]
            );
          }
        }
      }

      // トランザクションをコミット
      await this.conn.run("COMMIT");

      // Fuse.jsのインデックスを更新
      const allEntities = await this.getAllEntities();
      this.fuse.setCollection(allEntities);
    } catch (error) {
      // エラーが発生した場合はロールバック
      await this.conn.run("ROLLBACK");
      console.error("Error deleting observations:", error);
      throw error;
    }
  }

  /**
   * Delete relations
   * @param relations Array of relations to delete
   */
  async deleteRelations(relations: Relation[]): Promise<void> {
    await this.initialize();

    // トランザクションを開始
    await this.conn.run("BEGIN TRANSACTION");

    try {
      // 各リレーションを削除
      for (const relation of relations) {
        await this.conn.run(
          "DELETE FROM relations WHERE from_entity = ? AND to_entity = ? AND relationType = ?",
          [relation.from, relation.to, relation.relationType]
        );
      }

      // トランザクションをコミット
      await this.conn.run("COMMIT");
    } catch (error) {
      // エラーが発生した場合はロールバック
      await this.conn.run("ROLLBACK");
      console.error("Error deleting relations:", error);
      throw error;
    }
  }

  /**
   * Search for entities
   * @param query Search query
   * @returns Knowledge graph with matching entities and their relations
   */
  async searchNodes(query: string): Promise<KnowledgeGraph> {
    await this.initialize();

    if (!query || query.trim() === "") {
      return { entities: [], relations: [] };
    }

    // 全てのエンティティを取得
    const allEntities = await this.getAllEntities();

    // Fuse.jsのコレクションを更新
    this.fuse.setCollection(allEntities);

    // 検索を実行
    const results = this.fuse.search(query);

    // 検索結果からエンティティを抽出（重複を除去）
    const uniqueEntities = new Map<string, Entity>();
    for (const result of results) {
      if (!uniqueEntities.has(result.item.name)) {
        uniqueEntities.set(result.item.name, result.item);
      }
    }

    const entities = Array.from(uniqueEntities.values());

    // エンティティ名のセットを作成
    const entityNames = entities.map((entity) => entity.name);

    if (entityNames.length === 0) {
      return { entities: [], relations: [] };
    }

    // プレースホルダーを作成
    const placeholders = entityNames.map(() => "?").join(",");

    // 関連するリレーションを取得
    const relationsReader = await this.conn.runAndReadAll(
      `
      SELECT from_entity as "from", to_entity as "to", relationType
      FROM relations
      WHERE from_entity IN (${placeholders})
      OR to_entity IN (${placeholders})
      `,
      [...entityNames, ...entityNames]
    );
    const relationsData = relationsReader.getRows();

    // 結果をRelationオブジェクトの配列に変換
    const relations = relationsData.map((row) => {
      return {
        from: row[0] as string,
        to: row[1] as string,
        relationType: row[2] as string,
      };
    });

    return {
      entities,
      relations,
    };
  }

  /**
   * Read the entire knowledge graph
   * @returns The complete knowledge graph
   */
  async readGraph(): Promise<KnowledgeGraph> {
    await this.initialize();

    // 全てのエンティティを取得
    const entities = await this.getAllEntities();

    // 全てのリレーションを取得
    const relationsReader = await this.conn.runAndReadAll(
      'SELECT from_entity as "from", to_entity as "to", relationType FROM relations'
    );
    const relationsData = relationsReader.getRows();

    // 結果をRelationオブジェクトの配列に変換
    const relations = relationsData.map((row) => {
      return {
        from: row[0] as string,
        to: row[1] as string,
        relationType: row[2] as string,
      };
    });

    return {
      entities,
      relations,
    };
  }

  /**
   * Get entities by name
   * @param names Array of entity names
   * @returns Knowledge graph with matching entities and their relations
   */
  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    await this.initialize();

    if (names.length === 0) {
      return { entities: [], relations: [] };
    }

    try {
      // プレースホルダーを作成
      const placeholders = names.map(() => "?").join(",");

      // LEFT JOINを使用してエンティティと観察を一度に取得
      const reader = await this.conn.runAndReadAll(
        `
        SELECT e.name, e.entityType, o.content
        FROM entities e
        LEFT JOIN observations o ON e.name = o.entityName
        WHERE e.name IN (${placeholders})
      `,
        names
      );
      const rows = reader.getRows();

      // 結果をエンティティごとにグループ化
      const entitiesMap = new Map<string, Entity>();

      for (const row of rows) {
        const name = row[0] as string;
        const entityType = row[1] as string;
        const content = row[2] as string | null;

        if (!entitiesMap.has(name)) {
          // 新しいエンティティを作成
          entitiesMap.set(name, {
            name,
            entityType,
            observations: content ? [content] : [],
          });
        } else if (content) {
          // 既存のエンティティに観察を追加
          entitiesMap.get(name)!.observations.push(content);
        }
      }

      const entities = Array.from(entitiesMap.values());

      // エンティティ名のセットを作成
      const entityNames = entities.map((entity) => entity.name);

      // 関連するリレーションを取得
      if (entityNames.length > 0) {
        const placeholders = entityNames.map(() => "?").join(",");
        const relationsReader = await this.conn.runAndReadAll(
          `
        SELECT from_entity as "from", to_entity as "to", relationType
        FROM relations
        WHERE from_entity IN (${placeholders})
        OR to_entity IN (${placeholders})
        `,
          [...entityNames, ...entityNames]
        );
        const relationsData = relationsReader.getRows();

        // 結果をRelationオブジェクトの配列に変換
        const relations = relationsData.map((row) => {
          return {
            from: row[0] as string,
            to: row[1] as string,
            relationType: row[2] as string,
          };
        });

        return {
          entities,
          relations,
        };
      } else {
        return {
          entities,
          relations: [],
        };
      }
    } catch (error) {
      console.error("Error opening nodes:", error);
      return { entities: [], relations: [] };
    }
  }
}
