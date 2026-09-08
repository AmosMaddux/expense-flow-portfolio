# Architecture Decision Records

Record architecture decisions in this directory when a pull request changes architecture, tenant boundaries, workflow contracts, authorization models, data classification posture, or technology choices.

Use the filename pattern `NNNN-short-title.md`, such as `0001-tenant-isolation.md`.

ADRs must use only synthetic examples and must not include customer data, tenant data, private identifiers, receipt data, payment data, credentials, tokens, API keys, or secrets.

## Records

- [0001. Store Expense Report Case records in PostgreSQL](0001-expense-report-case-postgresql.md)
- [0002. Polyglot Service Split Placeholder](0002-polyglot-service-split-placeholder.md)
- [0003. Use storage per bounded context](0003-storage-per-bounded-context.md)
- [0004. Run containerized services on ECS Fargate](0004-run-containerized-services-on-ecs-fargate.md)
- [0005. Manage sandbox AWS infrastructure with Terraform](0005-manage-sandbox-aws-infrastructure-with-terraform.md)
- [0006. Store policy retrieval embeddings in pgvector with an external embedding provider](0006-pgvector-policy-embeddings.md)
- [0007. Gate policy RAG changes on deterministic RAGAS metrics and a prompt-injection set](0007-rag-evaluation-gate.md)
- [0008. Run a ZAP DAST baseline scan from the sandbox redeploy script, not the Secure Release Gate workflow](0008-zap-dast-baseline-on-sandbox-redeploy.md)
