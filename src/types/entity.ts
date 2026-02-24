export type EntityType =
  | 'project'
  | 'person'
  | 'company'
  | 'event'
  | 'resource'
  | 'goal'
  | 'result'
  | 'task'
  | 'shape';

export interface CanvasNode {
  id: string;
  label: string;
  x: number;
  y: number;
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface ProjectCanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface Entity {
  _id: string;
  type: EntityType;
  name: string;
  profile?: Record<string, unknown>;
  ai_metadata?: Record<string, unknown>;
  canvas_data?: ProjectCanvasData;
  createdAt?: string;
  updatedAt?: string;
}

export type EntityPayload = Partial<Omit<Entity, '_id'>> & Pick<Entity, 'type'>;
