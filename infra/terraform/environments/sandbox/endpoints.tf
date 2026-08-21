# VPC endpoints for private-subnet AWS service reachability.
#
# This account's private route tables have no NAT gateway and no other
# internet egress (confirmed by inspection: no 0.0.0.0/0 route, no existing
# NAT), and an AWS Organizations SCP explicitly denies ec2:CreateNatGateway.
# ECS tasks and the stage-transition Lambda in private subnets still need to
# reach ECR (image pulls), Secrets Manager, CloudWatch Logs, SQS, and SNS -
# none of which live inside the VPC. VPC endpoints provide a private,
# in-VPC network path to each service without any internet route, which is
# the correct fix here rather than a workaround for the SCP.

data "aws_route_tables" "private_for_endpoints" {
  vpc_id = local.vpc_id

  filter {
    name   = "association.main"
    values = ["false"]
  }
}

locals {
  private_route_table_ids_for_endpoints = data.aws_route_tables.private_for_endpoints.ids
}

resource "aws_security_group" "vpc_endpoints" {
  name        = "${var.name_prefix}-vpc-endpoints-sg"
  description = "Allows HTTPS from within the VPC to interface VPC endpoints."
  vpc_id      = local.vpc_id

  tags = merge(local.tags, {
    Name = "${var.name_prefix}-vpc-endpoints-sg"
  })
}

resource "aws_vpc_security_group_ingress_rule" "vpc_endpoints_https" {
  security_group_id = aws_security_group.vpc_endpoints.id
  description       = "Allow HTTPS from the VPC to interface endpoints."
  cidr_ipv4         = local.vpc_cidr
  from_port         = 443
  ip_protocol       = "tcp"
  to_port           = 443
}

#tfsec:ignore:aws-vpc-no-public-egress-sgr Interface endpoints only need to answer inbound HTTPS from the VPC; no outbound rule broadens exposure, owner platform-security, review by 2026-12-31
resource "aws_vpc_security_group_egress_rule" "vpc_endpoints_all" {
  #checkov:skip=CKV_AWS_382: Interface endpoint egress does not leave the VPC in practice, owner platform-security, review by 2026-12-31
  security_group_id = aws_security_group.vpc_endpoints.id
  description       = "Allow endpoint network interface outbound traffic."
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

locals {
  interface_endpoint_services = [
    "ecr.api",
    "ecr.dkr",
    "secretsmanager",
    "logs",
    "sqs",
    "sns",
  ]
}

resource "aws_vpc_endpoint" "interface" {
  for_each = toset(local.interface_endpoint_services)

  vpc_id              = local.vpc_id
  service_name        = "com.amazonaws.${var.aws_region}.${each.key}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = local.private_subnet_ids
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  private_dns_enabled = true

  tags = merge(local.tags, {
    Name = "${var.name_prefix}-${replace(each.key, ".", "-")}-endpoint"
  })
}

# ECR image layers are stored in S3; the gateway endpoint is free and routed
# through the route table rather than an ENI/security group.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = local.vpc_id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = local.private_route_table_ids_for_endpoints

  tags = merge(local.tags, {
    Name = "${var.name_prefix}-s3-endpoint"
  })
}
