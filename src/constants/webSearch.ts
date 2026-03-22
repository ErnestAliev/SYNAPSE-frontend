export const WEB_SEARCH_IMAGE_DRAG_MIME = 'application/x-synapse-web-search-image';

export interface WebSearchImageResult {
  id: string;
  imageUrl: string;
  thumbnailUrl: string;
  title: string;
  domain: string;
  sourcePageUrl: string;
  width: number;
  height: number;
}

export interface WebSearchDraggedImagePayload {
  id: string;
  imageUrl: string;
  thumbnailUrl: string;
  title: string;
  domain: string;
  sourcePageUrl: string;
}
