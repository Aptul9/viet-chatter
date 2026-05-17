// EmbeddingService: lazy-load @xenova/transformers feature-extraction pipeline,
// bounded LRU cache on raw text -> Float32Array embeddings.
// See docs/dev/06-kb-and-rag.md "Embedding service" section.

import { log } from '../log.js'
import { EMBEDDING_CACHE_SIZE } from '../config/constants.js'

type ExtractorFn = (
  text: string,
  opts: { pooling: 'mean'; normalize: boolean }
) => Promise<{ data: ArrayLike<number> }>

class LruCache<K, V> {
  private readonly map = new Map<K, V>()
  constructor(private readonly limit: number) {}

  get(key: K): V | undefined {
    const v = this.map.get(key)
    if (v === undefined) return undefined
    this.map.delete(key)
    this.map.set(key, v)
    return v
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size > this.limit) {
      const oldest = this.map.keys().next().value as K | undefined
      if (oldest !== undefined) this.map.delete(oldest)
    }
  }

  get size(): number {
    return this.map.size
  }
}

export class EmbeddingService {
  private extractor: ExtractorFn | null = null
  private loadPromise: Promise<ExtractorFn> | null = null
  private readonly cache: LruCache<string, Float32Array>

  constructor(
    private readonly modelId: string,
    cacheSize: number = EMBEDDING_CACHE_SIZE
  ) {
    this.cache = new LruCache(cacheSize)
  }

  async embed(text: string): Promise<Float32Array> {
    const cached = this.cache.get(text)
    if (cached) return cached
    const fn = await this.ensureModel()
    const out = await fn(text, { pooling: 'mean', normalize: true })
    const vec = new Float32Array(out.data)
    this.cache.set(text, vec)
    return vec
  }

  private ensureModel(): Promise<ExtractorFn> {
    if (this.extractor) return Promise.resolve(this.extractor)
    if (this.loadPromise) return this.loadPromise
    this.loadPromise = (async () => {
      const startedAt = Date.now()
      log.info({ model: this.modelId }, 'embedding model load start')
      const transformers = await import('@xenova/transformers')
      const pipeline = (transformers as { pipeline: unknown }).pipeline as (
        task: string,
        model: string
      ) => Promise<ExtractorFn>
      const fn = await pipeline('feature-extraction', this.modelId)
      this.extractor = fn
      log.info(
        { model: this.modelId, durationMs: Date.now() - startedAt },
        'embedding model loaded'
      )
      return fn
    })()
    return this.loadPromise
  }
}
