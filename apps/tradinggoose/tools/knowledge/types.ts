import type { EmbeddingAccounting } from '@/lib/embeddings/utils'
import type { NativeCost } from '@/lib/mastra/usage'

export interface KnowledgeSearchResult {
  documentId: string
  documentName: string
  content: string
  chunkIndex: number
  metadata: Record<string, any>
  similarity: number
}

export interface KnowledgeSearchResponse {
  success: boolean
  output: {
    results: KnowledgeSearchResult[]
    query: string
    totalResults: number
    embeddingUsage?: EmbeddingAccounting['usage']
    cost?: NativeCost & { model: string; tokens: { prompt?: number; total?: number } }
  }
  error?: string
}

export interface KnowledgeSearchParams {
  knowledgeBaseIds: string | string[]
  query: string
  topK?: number
}

export interface KnowledgeUploadChunkResult {
  chunkId: string
  chunkIndex: number
  content: string
  contentLength: number
  tokenCount: number
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface KnowledgeUploadChunkResponse {
  success: boolean
  output: {
    data: KnowledgeUploadChunkResult
    message: string
    documentId: string
    documentName: string
    embeddingUsage?: EmbeddingAccounting
    cost?: NativeCost & { model: string; tokens: { prompt?: number; total?: number } }
  }
  error?: string
}

export interface KnowledgeUploadChunkParams {
  documentId: string
  content: string
  enabled?: boolean
}

export interface KnowledgeCreateDocumentResult {
  documentId: string
  documentName: string
  type: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface KnowledgeCreateDocumentResponse {
  success: boolean
  output: {
    data: KnowledgeCreateDocumentResult
    message: string
  }
  error?: string
}
