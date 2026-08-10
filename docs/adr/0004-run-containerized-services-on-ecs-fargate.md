# 0004. Run containerized services on ECS Fargate

- Status: Accepted
- Date: 2026-08-07
- Related: [ECS task definitions](../ecs-task-definitions.md), [Core Case Service container image](../container-images-core-case-service.md), [GL-coding service container image](../container-images-gl-coding-service.md)

## Context

ExpenseFlow needs a production-oriented runtime shape for the Core Case Service and GL-coding service. Both services are already packaged as container images, and the deployment target must support task-level CPU and memory sizing, environment configuration, Secrets Manager injection, service health checks, CloudWatch logs, and later placement behind an Application Load Balancer.

The platform also needs to keep operational scope reasonable for the current team and delivery phase. SCRUM-147 defines ECS Fargate task definitions and a sandbox smoke path. Later infrastructure tickets will introduce a fuller deployment model, including Terraform-managed resources.

## Decision

ExpenseFlow will run the Core Case Service and GL-coding service on AWS ECS Fargate.

The task definitions define the production task shape for each service: Fargate launch type, `awsvpc` networking, Linux `X86_64`, CPU and memory settings, image references, health checks, CloudWatch log configuration, non-secret environment configuration, and Secrets Manager references for sensitive values.

Fargate is the default runtime choice because it lets the team run containerized services without managing the underlying compute hosts. AWS owns host provisioning, host patching, cluster capacity management, and low-level container runtime maintenance. The application team can focus on service images, task definitions, networking, secrets, logs, IAM boundaries, and deployment behavior.

## Consequences

The positive consequence is lower operational overhead than managing container hosts directly. The team does not need to provision EC2 instances, patch AMIs, size Auto Scaling groups for container capacity, drain hosts, or manage the Docker daemon on long-lived servers.

The platform gains an AWS-native path for Secrets Manager, IAM roles for tasks, CloudWatch logs, security groups per task, ECR image pulls, ALB integration, and service health checks. These pieces align with the rest of the planned AWS infrastructure and can later be codified in Terraform.

The trade-off is that ExpenseFlow becomes tied to AWS ECS and Fargate runtime semantics. Local Docker remains useful for development and image smoke checks, but it is not the production orchestration model. Some operational debugging also moves into AWS tools such as ECS task events, CloudWatch logs, IAM policy inspection, and VPC networking checks.

Fargate also requires explicit network and IAM setup before a task can run. Task definitions alone are not enough; ECR repositories, execution and task roles, log groups, security groups, subnets, Secrets Manager entries, and image publishing must exist.

## Alternatives Considered

### Kubernetes

Kubernetes can run the same services and gives a broad orchestration model for containers, service discovery, rollouts, autoscaling, and platform extensions. It was not chosen for this phase because it adds more operational surface area than ExpenseFlow currently needs.

A Kubernetes deployment would require the team to operate or configure a cluster control plane, worker node groups or serverless profiles, ingress controllers, service accounts, secrets integration, network policies, observability add-ons, cluster upgrades, and Kubernetes-specific deployment manifests. Even with a managed service such as EKS, the team would still own more platform decisions and day-two operations than the current service footprint justifies.

ECS Fargate gives the needed deployment shape for these two services with less orchestration overhead.

### Docker on EC2

Running Docker directly on EC2 would also support the existing service images, and it can be simple for a single host or early prototype. It was not chosen as the production-oriented path because the team would then own the compute layer.

An EC2-hosted Docker setup would require provisioning instances, patching operating systems, maintaining Docker, configuring systemd or another supervisor, handling instance replacement, managing capacity, forwarding logs, rotating credentials, and designing host-level deployment and rollback behavior. Those concerns are useful learning exercises, but they are not where the application team should spend production platform effort for these services.

ECS Fargate keeps the container abstraction while removing the need to manage long-lived compute resources.

### Local Docker

Local Docker remains the right tool for developer workflows and container image smoke checks. It is not a production runtime because it does not provide AWS-managed networking, IAM task roles, Secrets Manager injection, CloudWatch log routing, multi-AZ placement, ALB integration, or managed task lifecycle behavior.

Local Docker checks should continue to verify that the image builds and the service can boot, but successful local containers do not replace ECS Fargate task registration and runtime smoke checks.

## Temporary Implementation Note

The repository stores Bash scripts under `scripts/aws/` to create, smoke, and tear down the SCRUM-147 sandbox runtime resources. These scripts are a temporary bridge so the team can validate ECS Fargate task definitions with real ECR images, IAM roles, Secrets Manager entries, security groups, log groups, and one-off Fargate tasks.

Long-term AWS infrastructure should move into Terraform once the later infrastructure tickets establish the project convention. The Bash scripts should not become the permanent infrastructure-as-code system.
