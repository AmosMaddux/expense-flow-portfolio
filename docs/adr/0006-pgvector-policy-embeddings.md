# 0006. Store policy retrieval embeddings in pgvector with an external embedding provider

- Status: Proposed
- Date: 2026-08-21
- Decision makers/Desired reviewer count: TBD
- Related: [0001. Store Expense Report Case records in PostgreSQL](0001-expense-report-case-postgresql.md), [0003. Use storage per bounded context](0003-storage-per-bounded-context.md), [0005. Manage sandbox AWS infrastructure with Terraform](0005-manage-sandbox-aws-infrastructure-with-terraform.md), [Policy RAG retrieval](../design/policy-rag-retrieval.md), [Data classification](../data-classification.md)

## Context

Policy retrieval answers reimbursability questions from each tenant's own expense policy. The corpus already exists: `tenant_expense_policy_chunk` holds policy text split into tenant-scoped chunks, and retrieval ranks those chunks with a deterministic lexical score built from token overlap, term frequency, section-title matching, and exact phrase matching.

Lexical ranking alone does not retrieve on meaning. A question asked as "client dinner" does not match a policy section titled "Business Entertainment", because the two share no tokens. Grounded answers require retrieval that survives paraphrase, so the corpus needs vector embeddings and similarity search.

Several constraints narrow the design:

- **Tenant isolation dominates.** ExpenseFlow is multi-tenant, and returning one tenant's expense policy inside another tenant's answer is the most damaging failure this feature can produce. A vector index has no concept of a tenant; approximate nearest neighbour search returns the mathematically closest vectors in whatever set it is given. Isolation therefore cannot be a property of the index and must be a property of every query.
- **The sandbox account forbids the AWS-native options.** The account SCP recorded in `AGENTS.md` blocks Bedrock, SageMaker, and OpenSearch. Managed vector search and managed embedding hosting are not available to this project.
- **Storage decisions follow bounded context.** ADR 0003 makes PostgreSQL the authoritative store for Core Case domain state and forbids adding datastores that become second sources of truth. Policy chunks are Core Case data, and their embeddings are derived from text this service already owns.
- **The allowed stacks are fixed.** `AGENTS.md` permits TypeScript with Express and Python with FastAPI only. Any embedding runtime that requires a different stack is out of scope without changing the agent contract.
- **Retrieval must not inherit a third party's availability.** Loading a tenant's policy and answering policy questions are product functions that should not fail because an external provider is degraded.

## Decision

ExpenseFlow will store policy chunk embeddings in the existing Core Case PostgreSQL database using the pgvector extension, and will generate those embeddings with an external OpenAI embedding model called over HTTPS.

### Storage

`tenant_expense_policy_chunk` gains three columns: `embedding` typed `vector(1536)`, `embedding_model`, and `embedded_at`. The embedding lives on the chunk row rather than in a separate table so a chunk and its vector share one tenant column, one lifecycle, and one transaction.

Similarity search is supported by an HNSW index using `vector_cosine_ops`. Search ranks by cosine distance and reports `1 - distance` as a similarity in `[0, 1]`.

The column width is fixed at 1536, which is the output width of `text-embedding-3-small`. Configuration that disagrees with the column width is rejected at startup rather than at query time. Changing to a model of a different width is a migration, not a configuration change.

Every row records the model that produced its vector. Vectors from different models are not comparable, so the backfill query treats "embedded by a different model" identically to "not embedded", and a model change becomes a configuration change plus a backfill rather than a schema change.

### Tenant isolation

The following rules are binding and must not be relaxed:

- Every similarity query must pair the vector index with a `tenant_id` predicate applied in SQL. The HNSW index is not a tenant boundary and must never be treated as one.
- Retrieval must re-check the tenant of every similarity candidate before it enters ranking, independently of the SQL predicate.
- Every embedding write must be scoped by `tenant_id`, so a vector cannot be written onto another tenant's row.
- Tenant scope comes from authenticated identity. Request bodies are not trusted for tenant isolation, consistent with ADR 0003.
- Tenant isolation of vector search must be proven by integration tests against real pgvector, using chunks from different tenants that hold identical vectors, so that isolation is pinned by a failing test rather than by convention.

### Vector and text must stay consistent

Embedding is an asynchronous network call, so chunk text can change while a vector for the previous text is in flight. Serving a vector generated from replaced text produces confidently wrong retrieval with no error anywhere, so:

- Every embedding write is additionally scoped by `chunk_hash`. A write whose chunk hash no longer matches the stored row does not apply and the row is left for the next backfill.
- A chunk whose text changes loses its embedding in the same transaction that rewrites the text.
- A chunk whose text is unchanged retains its embedding even when the load that touched it ran without an embedding provider.

### Embedding provider

Embeddings are generated by OpenAI `text-embedding-3-small`, called directly over HTTPS with request and response validated by zod, and retry with bounded exponential backoff on `429` and `5xx`. No provider SDK is added; one HTTP endpoint does not justify a dependency, and the existing GL-coding client already establishes this shape.

Provider credentials are supplied as environment configuration and are never committed or logged. Provider error bodies must not be surfaced or logged, because the provider echoes submitted policy text back inside them; only the status code is propagated.

Chunks are embedded on two paths: during corpus load when a provider is configured, and through a backfill command for chunks that have no vector for the configured model.

### Embeddings are a ranking aid, not a dependency

Ranking is hybrid. The deterministic lexical score is retained and cosine similarity is added to it under a fixed weight, so semantic matching is influential while an exact policy phrase still wins. Each result reports its lexical and vector components separately so ranking behaviour is explainable.

When no provider is configured, or a provider call fails, the corpus still loads and retrieval degrades to lexical-only ranking. Policy retrieval must not fail because an external provider is unavailable.

### Operations

The `vector` extension must exist before the schema migration runs. The service user that applies migrations cannot create extensions, so the extension is provisioned by the Terraform database module as the master user, consistent with ADR 0005. Local development and integration tests run a pgvector build of PostgreSQL rather than a stock image.

## Consequences

Policy retrieval gains semantic matching without adding a datastore. The corpus, its embeddings, and its tenant column stay in one row of one table in the service that already owns the data, which keeps ADR 0003's source-of-truth model intact and means the tenant boundary is enforced by the same mechanism as every other Core Case query.

Vector search accuracy is now coupled to an external provider's model. If OpenAI changes or retires `text-embedding-3-small`, the stored vectors remain valid for search between themselves, but new text must be embedded by a comparable model or the whole corpus must be re-embedded. Recording `embedding_model` per row is what makes that migration tractable.

**Tenant policy text is sent to an external provider.** Tenant expense policy is private tenant configuration and therefore SBU under the data classification posture. This decision sends that text outside the ExpenseFlow trust boundary at load and backfill time. The policy corpus contains tenant-authored policy documents, not receipt, payment, employee, or bank-feed records, so no CUI payment data is transmitted. Even so, this is a widening of the data boundary and requires Security CODEOWNER review, agreement on provider data-retention and training terms before any non-sandbox tenant data is embedded, and a documented answer for tenants who decline external processing. Deploying this against real tenant policy text without that review is out of scope for this ADR.

Deployment is order-dependent. The Terraform extension change must apply before the service migration runs, and an existing stock-PostgreSQL local volume will fail the migration until it is recreated on a pgvector image.

Degradation is silent by design. A missing or invalid provider credential produces lexical-only retrieval rather than an error, which protects availability but hides misconfiguration. Operational monitoring must cover the proportion of chunks with a null embedding and the rate of embedding-call failures, otherwise this decision trades a loud failure for a quiet quality regression.

Embedding introduces a per-token cost and an external latency source on the load and backfill paths. Neither sits on the request path for reading policy, but query embedding does sit on the retrieval path, which makes the provider's latency part of retrieval latency whenever similarity search is active.

The vector weight in hybrid ranking is a reasoned starting value, not a tuned one. The RAGAS evaluation work in the same feature is the mechanism intended to tune it, and this ADR does not fix that value.

## Alternatives Considered

### OpenSearch, Bedrock Knowledge Bases, or SageMaker

Managed AWS vector search and managed embedding hosting would remove operational surface and keep tenant text inside the AWS boundary. All three are blocked by the account SCP recorded in `AGENTS.md` and are unavailable to this project. Were the SCP lifted, Bedrock in particular would be worth revisiting specifically because it would resolve the data-boundary consequence described above.

### A dedicated vector database

Pinecone, Qdrant, or similar are purpose-built for this access pattern and scale further than pgvector. Rejected because it adds a datastore holding a copy of tenant policy text, which creates a second tenant boundary to enforce and a second place for that boundary to be wrong. ADR 0003 explicitly resists adding datastores that duplicate authoritative records, and the corpus is far too small for pgvector's scaling limits to bind.

### A separate embeddings table joined to the chunk

Storing vectors in their own table would keep the chunk table narrow and make a model migration additive. Rejected because it splits the tenant column, the text, and the vector across two rows, so keeping them consistent becomes a join and a second predicate on every query rather than a property of the row. Given that the dominant risk is tenant isolation and vector/text drift, fewer places to get the predicate wrong outweighed the schema tidiness.

### Self-hosted embedding model

Running an open-weight embedding model locally would keep tenant text entirely inside the trust boundary and remove the per-token cost. Rejected for now because the sandbox has no GPU capacity, the ECS Fargate footprint from ADR 0004 is not sized for model inference, and it would add model versioning, warm-up, and evaluation work disproportionate to a corpus this size. This is the strongest candidate to revisit if the external data boundary proves unacceptable.

### IVFFlat instead of HNSW

IVFFlat builds faster and uses less memory. Rejected because it needs representative rows present at build time to form useful clusters, and this index is created by a migration against an empty table. HNSW builds usefully from empty and degrades more gracefully as the corpus grows.

### Replacing lexical ranking with pure vector search

Removing the lexical score would simplify ranking. Rejected because exact phrase matching on policy language, such as dollar thresholds and defined terms, is where lexical ranking is strongest and embeddings are weakest, and because retaining it is what allows retrieval to degrade instead of fail when the provider is unavailable.

### Leaving retrieval lexical-only

Doing nothing keeps the system simple and the data boundary narrow. Rejected because it does not satisfy the retrieval quality the feature exists to provide: the paraphrase case is the common case for a natural-language reimbursability question.
