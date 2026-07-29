# ExpenseReportStageTransitioned CloudEvent v1

The Core Case Service publishes this event after an Expense Report successfully
changes workflow stage. Publishers and consumers must validate the complete
CloudEvent with `ExpenseReportStageTransitionedCloudEventV1Schema`.

## SNS transport

The publisher sends the serialized CloudEvent as the SNS message body to the
topic configured by `STAGE_TRANSITION_SNS_TOPIC_ARN`. The SNS message attributes
`correlationId` and `eventType` mirror the corresponding CloudEvent values so
subscriptions can filter or trace messages without parsing the body. An inbound
`X-Correlation-Id` UUID is reused; when the header is omitted, the Core Case
Service generates one and returns it in the response header.

The workflow update and its outbox event are committed in the same PostgreSQL
transaction. The API response reflects that committed state and does not fail
when SNS is temporarily unavailable. The dispatcher retries pending events with
bounded exponential backoff and marks an event dead-lettered after ten failed
attempts. SNS/SQS delivery remains at-least-once, so consumers must deduplicate
using the CloudEvent `id`.

## Version identity

- CloudEvents specification: `1.0`
- Event type: `com.expenseflow.expense-report.stage-transitioned.v1`
- Data schema: `urn:expenseflow:schema:events:expense-report-stage-transitioned:v1`
- Source: `urn:expenseflow:core-case-service`

The `v1` suffix in the event type, data-schema URN, schema filename, and exported
TypeScript names identifies this contract version. Additive, optional fields may
be introduced within v1. Removing a field, changing a field's meaning or type,
or making an optional field required needs a new event version.

## Envelope and data

The event uses the CloudEvents JSON format. `correlationid` is a CloudEvents
extension attribute for routing and observability. It must equal
`data.correlationId`. `subject` must be `expense-reports/{caseId}`.

| Field                | Type                         | Required | Meaning                                     |
| -------------------- | ---------------------------- | -------- | ------------------------------------------- |
| `specversion`        | literal `"1.0"`              | yes      | CloudEvents specification version           |
| `type`               | literal event type above     | yes      | Versioned event contract identifier         |
| `source`             | literal source above         | yes      | Publishing bounded context                  |
| `id`                 | UUID                         | yes      | Unique event identifier                     |
| `time`               | RFC 3339 timestamp           | yes      | Time the transition completed               |
| `subject`            | string                       | yes      | `expense-reports/{caseId}`                  |
| `datacontenttype`    | literal `"application/json"` | yes      | Event data encoding                         |
| `dataschema`         | literal schema URN above     | yes      | Versioned data contract identifier          |
| `correlationid`      | UUID                         | yes      | CloudEvents correlation extension           |
| `data.caseId`        | UUID                         | yes      | Expense Report case identifier              |
| `data.tenantId`      | UUID                         | yes      | Tenant isolation scope                      |
| `data.fromStage`     | Expense Report stage         | yes      | Stage before the transition                 |
| `data.toStage`       | Expense Report stage         | yes      | Stage after the transition                  |
| `data.correlationId` | UUID                         | yes      | End-to-end operation correlation identifier |

Valid stages are `Drafted`, `Submitted`, `Manager Approval`, `AP Review`, `Paid`,
and `Reconciled`. The from and to stages must differ.

## Synthetic example

```json
{
    "specversion": "1.0",
    "type": "com.expenseflow.expense-report.stage-transitioned.v1",
    "source": "urn:expenseflow:core-case-service",
    "id": "40000000-0000-4000-8000-000000000001",
    "time": "2026-07-29T15:30:00.000Z",
    "subject": "expense-reports/30000000-0000-4000-8000-000000000001",
    "datacontenttype": "application/json",
    "dataschema": "urn:expenseflow:schema:events:expense-report-stage-transitioned:v1",
    "correlationid": "50000000-0000-4000-8000-000000000001",
    "data": {
        "caseId": "30000000-0000-4000-8000-000000000001",
        "tenantId": "10000000-0000-4000-8000-000000000100",
        "fromStage": "Submitted",
        "toStage": "Manager Approval",
        "correlationId": "50000000-0000-4000-8000-000000000001"
    }
}
```
