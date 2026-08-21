# Policy RAG Retrieval

## Corpus

Policy retrieval reads from `tenant_expense_policy_chunk`, which is populated from each tenant's current expense policy. The corpus is tenant-scoped by `tenant_id`.

## Embeddings

Each chunk carries an OpenAI embedding in the `embedding` pgvector column, alongside `embedding_model` and `embedded_at`. The default model is `text-embedding-3-small` at 1536 dimensions, which is the width of the column; changing model width requires a migration. An HNSW index with `vector_cosine_ops` supports similarity search.

Embeddings are tenant-scoped by the same `tenant_id` column that scopes the chunk, and the chunk `metadata` JSON repeats the tenant, section, policy hash, and chunk hash so a retrieved vector always carries its tenant provenance. HNSW cannot filter by tenant itself, so every similarity query pairs the index with a `tenant_id` predicate in SQL, and retrieval re-checks the tenant of each candidate before ranking.

Chunks are embedded in two places:

- `loadExpensePolicyCorpus` embeds chunks as it loads them when an embedding provider is configured. A provider failure is not fatal — chunks are persisted without vectors.
- `npm run policy:corpus:embed --workspace backend/core-case-service` backfills chunks that have no vector for the configured model.

A chunk that changes text loses its embedding in the same transaction that rewrites it, so a vector is never served for text it was not generated from. A backfill write is dropped if the chunk text changed while the embedding was in flight.

Configuration lives in `POLICY_EMBEDDING_*` environment variables. `POLICY_EMBEDDING_API_KEY` is a secret and must never be committed or logged; provider error bodies are not surfaced because they echo the submitted policy text.

## Retrieval contract

Retrieval must validate the request and filter by the authenticated tenant before ranking. The current implementation calls `findTenantPolicyCorpusChunks(tenantId)` and defensively excludes any returned record whose tenant does not match the validated request.

Ranking is hybrid. The deterministic lexical score combines token overlap and term frequency with boosts for an exact query phrase and matching section-title terms. When an embedding provider is configured, the query is embedded and `findSimilarTenantPolicyChunks` contributes a cosine similarity in `[0, 1]`, scaled by a weight of `10` and added to the lexical score. Each result reports `lexicalScore` and `vectorSimilarity` alongside the blended `score`.

Results are ordered by score descending and then `chunkIndex` ascending. Zero-score chunks are excluded when any relevant result exists; otherwise the first requested number of chunks is returned with score `0`.

Similarity search is a ranking aid, not a dependency. An unconfigured or failing embedding provider degrades retrieval to lexical-only ranking rather than failing the request.

The response citation format is:

```text
tenant_expense_policy:<policyHash>:chunk-<chunkIndex>
```

Every answer generated from policy retrieval must cite every policy chunk used to produce that answer.

## Tenant isolation

Embeddings must not weaken the tenant filter or allow cross-tenant chunks into ranking or response generation. Two chunks from different tenants can hold identical vectors; only the `tenant_id` predicate keeps them apart.

## Local database

Policy chunk storage requires the `vector` extension, so local and test PostgreSQL run the `pgvector/pgvector:pg17` image rather than stock `postgres`. On RDS the extension is provisioned by the `database` Terraform module's `extensions` input, because the service user that applies migrations cannot create extensions.
