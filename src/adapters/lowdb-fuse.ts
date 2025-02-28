import {
  KnowledgeGraphManagerInterface,
  Entity,
  Relation,
  Observation,
  KnowledgeGraph,
} from "../types";
import { join } from "path";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import Fuse from "fuse.js";

/**
 * LowDBのデータ型定義
 */
type LowDBData = {
  entities: Entity[];
  relations: Relation[];
};

/**
 * An implementation of the KnowledgeGraphManagerInterface that uses LowDB and Fuse.js
 */
export class LowDBFuseKnowledgeGraphManager
  implements KnowledgeGraphManagerInterface
{
  private db: Low<LowDBData>;
  private fuse: Fuse<Entity>;
  private initialized: boolean = false;

  /**
   * コンストラクタ
   * @param dbPath データベースファイルのパス（デフォルトは./knowledge-graph.json）
   */
  constructor(dbPath: string = join(process.cwd(), "knowledge-graph.json")) {
    // LowDBの初期化
    const adapter = new JSONFile<LowDBData>(dbPath);
    this.db = new Low<LowDBData>(adapter, { entities: [], relations: [] });

    // Fuse.jsの初期化（空の状態で初期化し、後でデータをロードする）
    this.fuse = new Fuse<Entity>([], {
      keys: ["name", "entityType", "observations"],
      includeScore: true,
      threshold: 0.4, // 検索の厳密さ（0に近いほど厳密）
    });
  }

  /**
   * データベースの初期化
   * @private
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // データベースの読み込み
      await this.db.read();

      // データベースが空の場合は初期化
      if (this.db.data === null) {
        this.db.data = { entities: [], relations: [] };
        await this.db.write();
      }

      // Fuse.jsのインデックスを構築
      this.fuse.setCollection(this.db.data.entities);

      this.initialized = true;
    } catch (error) {
      console.error("Failed to initialize database:", error);
      // 初期化に失敗した場合は空のデータで初期化
      this.db.data = { entities: [], relations: [] };
      this.fuse.setCollection([]);
      this.initialized = true;
    }
  }

  /**
   * データベースを保存する
   * @private
   */
  private async saveDatabase(): Promise<void> {
    await this.db.write();
    // 検索インデックスを更新
    this.fuse.setCollection(this.db.data!.entities);
  }

  /**
   * エンティティを作成する
   * @param entities 作成するエンティティの配列
   * @returns 作成されたエンティティの配列
   */
  async createEntities(entities: Entity[]): Promise<Entity[]> {
    await this.initialize();

    // 既存のエンティティ名を取得
    const existingNames = new Set(this.db.data!.entities.map((e) => e.name));

    // 新しいエンティティをフィルタリング（既存のものは除外）
    const newEntities = entities.filter(
      (entity) => !existingNames.has(entity.name)
    );

    // 新しいエンティティを追加
    if (newEntities.length > 0) {
      this.db.data!.entities.push(...newEntities);
      await this.saveDatabase();
    }

    return newEntities;
  }

  /**
   * リレーションを作成する
   * @param relations 作成するリレーションの配列
   * @returns 作成されたリレーションの配列
   */
  async createRelations(relations: Relation[]): Promise<Relation[]> {
    await this.initialize();

    // エンティティ名のセットを作成
    const entityNames = new Set(this.db.data!.entities.map((e) => e.name));

    // 有効なリレーションをフィルタリング（fromとtoの両方が存在するもの）
    const validRelations = relations.filter(
      (relation) =>
        entityNames.has(relation.from) && entityNames.has(relation.to)
    );

    // 既存のリレーションと重複しないものをフィルタリング
    const existingRelations = this.db.data!.relations;
    const newRelations = validRelations.filter(
      (newRel) =>
        !existingRelations.some(
          (existingRel) =>
            existingRel.from === newRel.from &&
            existingRel.to === newRel.to &&
            existingRel.relationType === newRel.relationType
        )
    );

    // 新しいリレーションを追加
    if (newRelations.length > 0) {
      this.db.data!.relations.push(...newRelations);
      await this.saveDatabase();
    }

    return newRelations;
  }

  /**
   * 観察を追加する
   * @param observations 追加する観察の配列
   * @returns 追加された観察の配列
   */
  async addObservations(
    observations: Array<Observation>
  ): Promise<Observation[]> {
    await this.initialize();

    const addedObservations: Observation[] = [];

    // 各観察に対して処理
    for (const observation of observations) {
      // エンティティを検索
      const entityIndex = this.db.data!.entities.findIndex(
        (e) => e.name === observation.entityName
      );

      // エンティティが存在する場合
      if (entityIndex !== -1) {
        const entity = this.db.data!.entities[entityIndex];
        const existingObservations = new Set(entity.observations);

        // 新しい観察のみを追加
        const newContents = observation.contents.filter(
          (content) => !existingObservations.has(content)
        );

        if (newContents.length > 0) {
          entity.observations.push(...newContents);
          addedObservations.push({
            entityName: observation.entityName,
            contents: newContents,
          });
        }
      }
    }

    // 変更があれば保存
    if (addedObservations.length > 0) {
      await this.saveDatabase();
    }

    return addedObservations;
  }

  /**
   * エンティティを削除する
   * @param entityNames 削除するエンティティ名の配列
   */
  async deleteEntities(entityNames: string[]): Promise<void> {
    await this.initialize();

    const nameSet = new Set(entityNames);

    // エンティティを削除
    this.db.data!.entities = this.db.data!.entities.filter(
      (entity) => !nameSet.has(entity.name)
    );

    // 関連するリレーションも削除
    this.db.data!.relations = this.db.data!.relations.filter(
      (relation) => !nameSet.has(relation.from) && !nameSet.has(relation.to)
    );

    await this.saveDatabase();
  }

  /**
   * 観察を削除する
   * @param deletions 削除する観察の配列
   */
  async deleteObservations(deletions: Array<Observation>): Promise<void> {
    await this.initialize();

    let hasChanges = false;

    // 各削除対象に対して処理
    for (const deletion of deletions) {
      // エンティティを検索
      const entityIndex = this.db.data!.entities.findIndex(
        (e) => e.name === deletion.entityName
      );

      // エンティティが存在する場合
      if (entityIndex !== -1) {
        const entity = this.db.data!.entities[entityIndex];
        const deleteSet = new Set(deletion.contents);

        // 削除対象の観察を除外
        const originalLength = entity.observations.length;
        entity.observations = entity.observations.filter(
          (obs) => !deleteSet.has(obs)
        );

        // 変更があったかチェック
        if (originalLength !== entity.observations.length) {
          hasChanges = true;
        }
      }
    }

    // 変更があれば保存
    if (hasChanges) {
      await this.saveDatabase();
    }
  }

  /**
   * リレーションを削除する
   * @param relations 削除するリレーションの配列
   */
  async deleteRelations(relations: Relation[]): Promise<void> {
    await this.initialize();

    const originalLength = this.db.data!.relations.length;

    // 削除対象のリレーションを除外
    this.db.data!.relations = this.db.data!.relations.filter(
      (existingRel) =>
        !relations.some(
          (delRel) =>
            existingRel.from === delRel.from &&
            existingRel.to === delRel.to &&
            existingRel.relationType === delRel.relationType
        )
    );

    // 変更があれば保存
    if (originalLength !== this.db.data!.relations.length) {
      await this.saveDatabase();
    }
  }

  /**
   * ナレッジグラフ全体を読み取る
   * @returns ナレッジグラフ
   */
  async readGraph(): Promise<KnowledgeGraph> {
    await this.initialize();

    return {
      entities: [...this.db.data!.entities],
      relations: [...this.db.data!.relations],
    };
  }

  /**
   * エンティティを検索する
   * @param query 検索クエリ
   * @returns 検索結果のエンティティ配列
   */
  async searchNodes(query: string): Promise<Entity[]> {
    await this.initialize();

    if (!query || query.trim() === "") {
      return [];
    }

    // Fuse.jsで検索を実行
    const results = this.fuse.search(query);

    // 検索結果からエンティティを抽出（重複を排除）
    const uniqueEntities = new Map<string, Entity>();
    for (const result of results) {
      if (!uniqueEntities.has(result.item.name)) {
        uniqueEntities.set(result.item.name, result.item);
      }
    }

    return Array.from(uniqueEntities.values());
  }

  /**
   * 指定した名前のエンティティを取得する
   * @param names エンティティ名の配列
   * @returns 取得したエンティティの配列
   */
  async openNodes(names: string[]): Promise<Entity[]> {
    await this.initialize();

    const nameSet = new Set(names);

    // 指定された名前のエンティティをフィルタリング
    return this.db.data!.entities.filter((entity) => nameSet.has(entity.name));
  }
}
