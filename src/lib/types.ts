export interface Article {
  id: string;
  userId: string;
  title: string;
  content: string;
  originalText: string;
  style: string;
  targetLength: number;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface GenerateRequest {
  text: string;
  style: string;
  targetLength: number;
}

export interface TranscribeResponse {
  text: string;
}
