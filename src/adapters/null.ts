import {
  KnowledgeGraphManagerInterface,
  Entity,
  Relation,
  Observation,
  KnowledgeGraph,
} from "../types";

/**
 * A null implementation of the KnowledgeGraphManagerInterface that does nothing.
 */
export class NullKnowledgeGraphManager
  implements KnowledgeGraphManagerInterface
{
  createEntities(entities: Entity[]): Promise<Entity[]> {
    return Promise.resolve(entities);
  }

  createRelations(relations: Relation[]): Promise<Relation[]> {
    return Promise.resolve(relations);
  }

  addObservations(observations: Array<Observation>): Promise<Observation[]> {
    return Promise.resolve(observations);
  }

  deleteEntities(entityNames: string[]): Promise<void> {
    return Promise.resolve();
  }

  deleteObservations(deletions: Array<Observation>): Promise<void> {
    return Promise.resolve();
  }

  deleteRelations(relations: Relation[]): Promise<void> {
    return Promise.resolve();
  }

  readGraph(): Promise<KnowledgeGraph> {
    return Promise.resolve({
      entities: [],
      relations: [],
    });
  }

  searchNodes(query: string): Promise<Entity[]> {
    return Promise.resolve([]);
  }

  openNodes(names: string[]): Promise<Entity[]> {
    return Promise.resolve([]);
  }
}
