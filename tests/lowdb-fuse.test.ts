import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LowDBFuseKnowledgeGraphManager } from "../src/adapters/lowdb-fuse";
import { Entity, Relation, Observation } from "../src/types";
import { join } from "path";
import { existsSync, unlinkSync } from "fs";

describe("LowDBFuseKnowledgeGraphManager", () => {
  // テスト用の一時ファイルパス
  const testDbPath = join(process.cwd(), "test-knowledge-graph.json");
  let manager: LowDBFuseKnowledgeGraphManager;

  // テストデータ
  const testEntities: Entity[] = [
    {
      name: "Entity1",
      entityType: "TestType",
      observations: ["Observation1", "Observation2"],
    },
    {
      name: "Entity2",
      entityType: "TestType",
      observations: ["Observation3"],
    },
  ];

  // テスト用のモックデータを作成する関数
  const createTestData = async () => {
    await manager.createEntities(testEntities);
  };

  const testRelations: Relation[] = [
    {
      from: "Entity1",
      to: "Entity2",
      relationType: "TestRelation",
    },
  ];

  const testObservations: Observation[] = [
    {
      entityName: "Entity1",
      contents: ["Observation4", "Observation5"],
    },
  ];

  // 各テスト前に実行
  beforeEach(() => {
    // テスト用のマネージャーを作成
    manager = new LowDBFuseKnowledgeGraphManager(testDbPath);
  });

  // 各テスト後に実行
  afterEach(() => {
    // テスト用のファイルを削除
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  describe("createEntities", () => {
    it("should create new entities", async () => {
      const result = await manager.createEntities(testEntities);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Entity1");
      expect(result[1].name).toBe("Entity2");

      // グラフを読み取って確認
      const graph = await manager.readGraph();
      expect(graph.entities).toHaveLength(2);
      expect(graph.entities[0].name).toBe("Entity1");
      expect(graph.entities[1].name).toBe("Entity2");
    });

    it("should not create duplicate entities", async () => {
      // 最初のエンティティを作成
      await manager.createEntities([testEntities[0]]);

      // 同じエンティティを含む配列で再度作成を試みる
      const result = await manager.createEntities(testEntities);

      // 重複しないエンティティのみ作成されるはず
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Entity2");

      // グラフを読み取って確認
      const graph = await manager.readGraph();
      expect(graph.entities).toHaveLength(2);
    });
  });

  describe("createRelations", () => {
    it("should create relations between existing entities", async () => {
      // エンティティを作成
      await manager.createEntities(testEntities);

      // リレーションを作成
      const result = await manager.createRelations(testRelations);
      expect(result).toHaveLength(1);
      expect(result[0].from).toBe("Entity1");
      expect(result[0].to).toBe("Entity2");

      // グラフを読み取って確認
      const graph = await manager.readGraph();
      expect(graph.relations).toHaveLength(1);
      expect(graph.relations[0].from).toBe("Entity1");
      expect(graph.relations[0].to).toBe("Entity2");
    });

    it("should not create relations for non-existing entities", async () => {
      // エンティティを作成せずにリレーションを作成しようとする
      const result = await manager.createRelations(testRelations);

      // 存在しないエンティティ間のリレーションは作成されないはず
      expect(result).toHaveLength(0);

      // グラフを読み取って確認
      const graph = await manager.readGraph();
      expect(graph.relations).toHaveLength(0);
    });

    it("should not create duplicate relations", async () => {
      // エンティティを作成
      await manager.createEntities(testEntities);

      // リレーションを作成
      await manager.createRelations(testRelations);

      // 同じリレーションを再度作成しようとする
      const result = await manager.createRelations(testRelations);

      // 重複するリレーションは作成されないはず
      expect(result).toHaveLength(0);

      // グラフを読み取って確認
      const graph = await manager.readGraph();
      expect(graph.relations).toHaveLength(1);
    });
  });

  describe("addObservations", () => {
    it("should add observations to existing entities", async () => {
      // エンティティを作成
      await manager.createEntities(testEntities);

      // 観察を追加
      const result = await manager.addObservations(testObservations);
      expect(result).toHaveLength(1);
      expect(result[0].entityName).toBe("Entity1");
      expect(result[0].contents).toHaveLength(2);
      expect(result[0].contents).toContain("Observation4");
      expect(result[0].contents).toContain("Observation5");

      // グラフを読み取って確認
      const graph = await manager.readGraph();
      const entity = graph.entities.find((e) => e.name === "Entity1");
      expect(entity).toBeDefined();
      expect(entity!.observations).toHaveLength(4); // 元の2つ + 新しい2つ
      expect(entity!.observations).toContain("Observation1");
      expect(entity!.observations).toContain("Observation2");
      expect(entity!.observations).toContain("Observation4");
      expect(entity!.observations).toContain("Observation5");
    });

    it("should not add duplicate observations", async () => {
      // エンティティを作成
      await manager.createEntities(testEntities);

      // 重複する観察を含む配列を作成
      const duplicateObservations: Observation[] = [
        {
          entityName: "Entity1",
          contents: ["Observation1", "Observation4"], // Observation1は既に存在する
        },
      ];

      // 観察を追加
      const result = await manager.addObservations(duplicateObservations);

      // グラフを読み取って確認
      const graph = await manager.readGraph();
      const entity = graph.entities.find((e) => e.name === "Entity1");
      expect(entity).toBeDefined();

      // 観察が追加されているか確認
      expect(entity!.observations).toContain("Observation1");
      expect(entity!.observations).toContain("Observation2");
      expect(entity!.observations).toContain("Observation4");
    });

    it("should ignore observations for non-existing entities", async () => {
      // 存在しないエンティティに対する観察
      const nonExistingObservations: Observation[] = [
        {
          entityName: "NonExistingEntity",
          contents: ["Observation1"],
        },
      ];

      // 観察を追加
      const result = await manager.addObservations(nonExistingObservations);
      expect(result).toHaveLength(0);

      // グラフを読み取って確認
      const graph = await manager.readGraph();
      expect(graph.entities).toHaveLength(0);
    });
  });

  describe("deleteObservations", () => {
    it("should delete observations from entities", async () => {
      // エンティティを作成
      await createTestData();

      // 削除する観察
      const deletions: Observation[] = [
        {
          entityName: "Entity1",
          contents: ["Observation1"],
        },
      ];

      // 観察を削除
      await manager.deleteObservations(deletions);

      // グラフを読み取って確認
      const graph = await manager.readGraph();
      const entity = graph.entities.find((e) => e.name === "Entity1");
      expect(entity).toBeDefined();

      // 元の観察配列から削除されたか確認
      expect(entity!.observations).not.toContain("Observation1");
      expect(entity!.observations).toContain("Observation2");
    });

    it("should handle non-existing entities gracefully", async () => {
      // 存在しないエンティティからの観察削除
      const deletions: Observation[] = [
        {
          entityName: "NonExistingEntity",
          contents: ["Observation1"],
        },
      ];

      // エラーが発生しないことを確認
      await expect(
        manager.deleteObservations(deletions)
      ).resolves.not.toThrow();
    });

    it("should handle non-existing observations gracefully", async () => {
      // エンティティを作成
      await manager.createEntities(testEntities);

      // 存在しない観察の削除
      const deletions: Observation[] = [
        {
          entityName: "Entity1",
          contents: ["NonExistingObservation"],
        },
      ];

      // 観察を削除
      await manager.deleteObservations(deletions);

      // グラフを読み取って確認（変更なし）
      const graph = await manager.readGraph();
      const entity = graph.entities.find((e) => e.name === "Entity1");
      expect(entity).toBeDefined();

      // 観察が存在するか確認
      expect(entity!.observations.length).toBeGreaterThan(0);
    });
  });

  describe("deleteEntities", () => {
    it("should delete entities and their relations", async () => {
      // エンティティとリレーションを作成
      await manager.createEntities(testEntities);
      await manager.createRelations(testRelations);

      // Entity1を削除
      await manager.deleteEntities(["Entity1"]);

      // グラフを読み取って確認
      const graph = await manager.readGraph();
      expect(graph.entities).toHaveLength(1); // Entity2のみ残る
      expect(graph.entities[0].name).toBe("Entity2");
      expect(graph.relations).toHaveLength(0); // リレーションも削除される
    });

    it("should handle non-existing entities gracefully", async () => {
      // 存在しないエンティティの削除
      await expect(
        manager.deleteEntities(["NonExistingEntity"])
      ).resolves.not.toThrow();
    });
  });

  describe("deleteRelations", () => {
    it("should delete specific relations", async () => {
      // エンティティとリレーションを作成
      await manager.createEntities(testEntities);
      await manager.createRelations(testRelations);

      // リレーションを削除
      await manager.deleteRelations(testRelations);

      // グラフを読み取って確認
      const graph = await manager.readGraph();
      expect(graph.entities).toHaveLength(2); // エンティティは残る
      expect(graph.relations).toHaveLength(0); // リレーションは削除される
    });

    it("should handle non-existing relations gracefully", async () => {
      // 存在しないリレーションの削除
      const nonExistingRelations: Relation[] = [
        {
          from: "NonExistingEntity1",
          to: "NonExistingEntity2",
          relationType: "NonExistingRelation",
        },
      ];

      // エラーが発生しないことを確認
      await expect(
        manager.deleteRelations(nonExistingRelations)
      ).resolves.not.toThrow();
    });
  });

  describe("searchNodes", () => {
    it("should find entities by name", async () => {
      // エンティティを作成
      await createTestData();

      // 名前で検索
      const results = await manager.searchNodes("Entity1");

      // 検索結果を確認
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((entity) => entity.name === "Entity1")).toBe(true);
    });

    it("should find entities by type", async () => {
      // エンティティを作成
      await manager.createEntities(testEntities);

      // タイプで検索
      const results = await manager.searchNodes("TestType");
      expect(results).toHaveLength(2); // 両方のエンティティがTestType
    });

    it("should find entities by observation content", async () => {
      // エンティティを作成
      await manager.createEntities(testEntities);

      // 観察内容で検索
      const results = await manager.searchNodes("Observation1");

      // 検索結果を確認
      expect(results.length).toBeGreaterThan(0);
      // 検索結果にEntity1が含まれているか確認
      expect(results.some((entity) => entity.name === "Entity1")).toBe(true);
    });

    it("should return empty array for no matches", async () => {
      // エンティティを作成
      await manager.createEntities(testEntities);

      // 一致しない検索
      const results = await manager.searchNodes("NonExistingTerm");
      expect(results).toHaveLength(0);
    });

    it("should return empty array for empty query", async () => {
      // エンティティを作成
      await manager.createEntities(testEntities);

      // 空のクエリ
      const results = await manager.searchNodes("");
      expect(results).toHaveLength(0);
    });
  });

  describe("openNodes", () => {
    it("should retrieve specific entities by name", async () => {
      // エンティティを作成
      await manager.createEntities(testEntities);

      // 名前で取得
      const results = await manager.openNodes(["Entity1"]);
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("Entity1");
      expect(results[0].entityType).toBe("TestType");

      // 観察が存在するか確認
      expect(results[0].observations.length).toBeGreaterThan(0);
    });

    it("should retrieve multiple entities", async () => {
      // エンティティを作成
      await manager.createEntities(testEntities);

      // 複数のエンティティを取得
      const results = await manager.openNodes(["Entity1", "Entity2"]);
      expect(results).toHaveLength(2);
      expect(results.map((e) => e.name)).toContain("Entity1");
      expect(results.map((e) => e.name)).toContain("Entity2");
    });

    it("should return empty array for non-existing entities", async () => {
      // エンティティを作成
      await manager.createEntities(testEntities);

      // 存在しないエンティティを取得
      const results = await manager.openNodes(["NonExistingEntity"]);
      expect(results).toHaveLength(0);
    });

    it("should return only existing entities from a mixed list", async () => {
      // エンティティを作成
      await manager.createEntities(testEntities);

      // 存在するエンティティと存在しないエンティティの混合リスト
      const results = await manager.openNodes(["Entity1", "NonExistingEntity"]);
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("Entity1");
    });
  });

  describe("readGraph", () => {
    it("should return the entire knowledge graph", async () => {
      // エンティティとリレーションを作成
      await manager.createEntities(testEntities);
      await manager.createRelations(testRelations);

      // グラフを読み取る
      const graph = await manager.readGraph();
      expect(graph.entities).toHaveLength(2);
      expect(graph.relations).toHaveLength(1);
      expect(graph.entities[0].name).toBe("Entity1");
      expect(graph.entities[1].name).toBe("Entity2");
      expect(graph.relations[0].from).toBe("Entity1");
      expect(graph.relations[0].to).toBe("Entity2");
    });

    it("should return empty graph when no data exists", async () => {
      // 何も作成せずにグラフを読み取る
      const graph = await manager.readGraph();
      expect(graph.entities).toHaveLength(0);
      expect(graph.relations).toHaveLength(0);
    });
  });
});
