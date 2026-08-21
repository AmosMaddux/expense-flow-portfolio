# Policy RAG Retrieval

## Corpus

Policy retrieval reads from `tenant_expense_policy_chunk`, which is populated from each tenant's current expense policy. The corpus is tenant-scoped by `tenant_id`.

## Retrieval contract

Retrieval must validate the request and filter by the authenticated tenant before ranking. The current implementation calls `findTenantPolicyCorpusChunks(tenantId)` and defensively excludes any returned record whose tenant does not match the validated request.

Ranking is deterministic lexical hybrid ranking. It combines token overlap and term frequency with boosts for an exact query phrase and matching section-title terms. Results are ordered by score descending and then `chunkIndex` ascending. Zero-score chunks are excluded when any relevant result exists; otherwise the first requested number of chunks is returned with score `0`.

The response citation format is:

```text
tenant_expense_policy:<policyHash>:chunk-<chunkIndex>
```

Every answer generated from policy retrieval must cite every policy chunk used to produce that answer.

## Future embeddings

Embeddings may add a vector similarity score to the ranking later. They must not weaken the tenant filter or allow cross-tenant chunks into ranking or response generation.
