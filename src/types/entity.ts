export type EntityType =
  | 'project'
  | 'connection'
  | 'person'
  | 'company'
  | 'event'
  | 'resource'
  | 'goal'
  | 'result'
  | 'task'
  | 'shape';

export interface CanvasNodeProjection {
  id: string;
  entityId: string;
  x: number;
  y: number;
  scale?: number;
}

export interface CanvasGroupProjection {
  id: string;
  name: string;
  nodeIds: string[];
  color?: string;
}

export interface CanvasEdgeProjection {
  id: string;
  source: string;
  target: string;
  label?: string;
  color?: string;
  arrowLeft?: boolean;
  arrowRight?: boolean;
}

export interface ProjectCanvasViewport {
  x: number;
  y: number;
  zoom: number;
  width: number;
  height: number;
}

export interface ProjectCanvasData {
  nodes: CanvasNodeProjection[];
  edges: CanvasEdgeProjection[];
  groups?: CanvasGroupProjection[];
  viewport?: ProjectCanvasViewport;
  background?: string;
}

export interface Entity {
  _id: string;
  type: EntityType;
  name: string;
  profile?: Record<string, unknown>;
  is_mine?: boolean;
  is_me?: boolean;
  ai_metadata?: Record<string, unknown>;
  canvas_data?: ProjectCanvasData;
  createdAt?: string;
  updatedAt?: string;
}

export type EntityPayload = Partial<Omit<Entity, '_id'>> & Pick<Entity, 'type'>;
