export interface Article {
  id: string;
  title: string;
  content: string;
  originalText: string;
  style: string;
  targetLength: number;
  createdAt: string;
  updatedAt: string;
}

export interface GenerateRequest {
  text: string;
  style: string;
  targetLength: number;
}

export interface TranscribeResponse {
  text: string;
}
