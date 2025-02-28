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
  createEntities(entities: Entity[]) {
    return Promise.resolve(entities);
  }

  createRelations(relations: Relation[]) {
    return Promise.resolve(relations);
  }

  addObservations(observations: Array<Observation>) {
    return Promise.resolve(observations);
  }

  deleteEntities(entityNames: string[]) {
    return Promise.resolve();
  }

  deleteObservations(deletions: Array<Observation>) {
    return Promise.resolve();
  }

  deleteRelations(relations: Relation[]) {
    return Promise.resolve();
  }

  searchNodes(query: string) {
    return Promise.resolve({
      entities: [],
      relations: [],
    });
  }

  openNodes(names: string[]) {
    return Promise.resolve({
      entities: [],
      relations: [],
    });
  }
}
