"""Render the current Terraform-managed AWS architecture.

Run with:
    python3 docs/Architecture/current_terraform_aws_architecture.py

The script requires the mingrammer/diagrams package and Graphviz on PATH.
It writes docs/Architecture/current_terraform_aws_architecture.png.
"""

from pathlib import Path

from diagrams import Cluster, Diagram, Edge
from diagrams.aws.compute import ECR, ECS, Fargate
from diagrams.aws.database import Dynamodb
from diagrams.aws.integration import SNS, SQS
from diagrams.aws.management import Cloudwatch
from diagrams.aws.network import ALB, CloudFront, InternetGateway, NATGateway, VPC
from diagrams.aws.security import IAMRole, SecretsManager
from diagrams.aws.storage import S3
from diagrams.onprem.client import Users


OUTPUT_PATH = Path(__file__).with_suffix("")


graph_attr = {
    "bgcolor": "white",
    "fontname": "Arial",
    "fontsize": "16",
    "pad": "0.4",
    "rankdir": "LR",
    "splines": "ortho",
}

node_attr = {
    "fontname": "Arial",
    "fontsize": "11",
}

edge_attr = {
    "fontname": "Arial",
    "fontsize": "10",
}


with Diagram(
    "ExpenseFlow Terraform AWS Architecture",
    filename=str(OUTPUT_PATH),
    direction="LR",
    show=False,
    graph_attr=graph_attr,
    node_attr=node_attr,
    edge_attr=edge_attr,
):
    users = Users("Employees and finance users")

    with Cluster("Terraform state"):
        state_bucket = S3("S3 backend state\nAES256 + versioning\nS3 lockfile")

    with Cluster("AWS account / us-east-1"):
        with Cluster("Edge and static web"):
            cloudfront = CloudFront("CloudFront\nSPA HTTPS + fallback")
            spa_bucket = S3("Private SPA S3\nOAC-only reads")

        with Cluster("VPC\nexisting sandbox VPC or Terraform-managed VPC"):
            selected_vpc = VPC("Selected VPC")
            internet_gateway = InternetGateway("Internet gateway")

            with Cluster("Public subnets"):
                public_alb = ALB("Public ALB\n/v1 API entrypoint")
                nat_gateway = NATGateway("NAT gateway\nprivate egress")

            with Cluster("Private subnets"):
                internal_alb = ALB("Internal ALB\nGL-coding")

                with Cluster("ECS Fargate services"):
                    cluster = ECS("ECS cluster")
                    core_case = Fargate("Core Case\nTypeScript/Express :3000")
                    gl_coding = Fargate("GL-coding\nPython/FastAPI :8001")
                    cluster - [core_case, gl_coding]

        with Cluster("Regional AWS services"):
            ecr = ECR("ECR repositories\ncore-case, gl-coding")
            logs = Cloudwatch("CloudWatch Logs\n14-day retention")
            secrets = SecretsManager("Secrets Manager\nruntime secret ARNs")
            receipts = S3("Receipt S3\nAES256 + versioning")
            projection = Dynamodb("DynamoDB\nExpense Report projection")
            iam = IAMRole("IAM roles\nexecution + task roles")

            with Cluster("Stage-transition events"):
                stage_topic = SNS("SNS topic")
                stage_queue = SQS("SQS queue")
                stage_dlq = SQS("SQS DLQ")

    users >> Edge(label="HTTPS") >> cloudfront >> spa_bucket
    users >> Edge(label="HTTP/HTTPS /v1") >> internet_gateway >> public_alb
    selected_vpc >> Edge(label="public subnet placement") >> [public_alb, nat_gateway]
    selected_vpc >> Edge(label="private subnet placement") >> [internal_alb, cluster]

    public_alb >> Edge(label="forward :3000") >> core_case
    core_case >> Edge(label="HTTP internal service call") >> internal_alb
    internal_alb >> Edge(label="forward :8001") >> gl_coding

    [core_case, gl_coding] >> Edge(label="private subnet egress") >> nat_gateway
    nat_gateway >> internet_gateway

    ecr >> Edge(label="container images") >> [core_case, gl_coding]
    secrets >> Edge(label="task secret injection") >> [core_case, gl_coding]
    iam >> Edge(label="execution/task permissions") >> [core_case, gl_coding]
    [core_case, gl_coding] >> logs

    core_case >> receipts
    core_case >> projection
    core_case >> Edge(label="publish CloudEvents") >> stage_topic
    stage_topic >> stage_queue >> stage_dlq

    state_bucket - Edge(label="remote state backend", style="dashed") - selected_vpc
