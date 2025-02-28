// We are storing our memory using entities, relations, and observations in a graph structure
export type Entity = {
  name: string;
  entityType: string;
  observations: string[];
};

export type Relation = {
  from: string;
  to: string;
  relationType: string;
};

export type KnowledgeGraph = {
  entities: Entity[];
  relations: Relation[];
};

export type Observation = {
  entityName: string;
  contents: string[];
};

export type KnowledgeGraphManagerInterface = {
  createEntities(entities: Entity[]): Promise<Entity[]>;
  createRelations(relations: Relation[]): Promise<Relation[]>;
  addObservations(observations: Array<Observation>): Promise<Observation[]>;
  deleteEntities(entityNames: string[]): Promise<void>;
  deleteObservations(deletions: Array<Observation>): Promise<void>;
  deleteRelations(relations: Relation[]): Promise<void>;
  readGraph(): Promise<KnowledgeGraph>;
  searchNodes(query: string): Promise<Entity[]>;
  openNodes(names: string[]): Promise<Entity[]>;
};
