data "aws_vpc" "existing" {
  count = local.uses_existing_network && var.existing_vpc_id == null ? 1 : 0

  tags = {
    Name = var.existing_vpc_name
    env  = "sandbox"
  }
}

data "aws_vpc" "selected" {
  count = local.uses_existing_network ? 1 : 0

  id = local.existing_vpc_id
}

data "aws_subnets" "existing_public" {
  count = local.uses_existing_network && length(var.existing_public_subnet_ids) == 0 ? 1 : 0

  filter {
    name   = "vpc-id"
    values = [local.existing_vpc_id]
  }

  filter {
    name   = "tag:Name"
    values = var.existing_public_subnet_name_patterns
  }

  filter {
    name   = "tag:env"
    values = ["sandbox"]
  }
}

data "aws_subnets" "existing_private" {
  count = local.uses_existing_network && length(var.existing_private_subnet_ids) == 0 ? 1 : 0

  filter {
    name   = "vpc-id"
    values = [local.existing_vpc_id]
  }

  filter {
    name   = "tag:Name"
    values = var.existing_private_subnet_name_patterns
  }

  filter {
    name   = "tag:env"
    values = ["sandbox"]
  }
}

resource "terraform_data" "existing_network_discovery" {
  count = local.uses_existing_network ? 1 : 0

  lifecycle {
    precondition {
      condition     = length(local.public_subnet_ids) > 0
      error_message = "Existing network discovery found no public subnets. Supply existing_public_subnet_ids or update existing_public_subnet_name_patterns."
    }

    precondition {
      condition     = length(local.private_subnet_ids) > 0
      error_message = "Existing network discovery found no private subnets. Supply existing_private_subnet_ids or update existing_private_subnet_name_patterns."
    }

    precondition {
      condition     = length(local.existing_private_subnets_using_main_route_table) == 0
      error_message = "Existing private subnet discovery found one or more private subnets using the VPC main route table. Terraform will not mutate the main route table. Supply existing_private_route_table_ids or explicitly associate private subnets with dedicated private route tables."
    }
  }
}

data "aws_route_tables" "existing" {
  count = local.uses_existing_network && var.enable_nat_gateway ? 1 : 0

  vpc_id = local.existing_vpc_id
}

data "aws_route_table" "existing_by_id" {
  for_each = local.uses_existing_network && var.enable_nat_gateway ? toset(data.aws_route_tables.existing[0].ids) : toset([])

  route_table_id = each.value
}

locals {
  existing_nat_gateway_enabled = local.uses_existing_network && var.enable_nat_gateway && length(local.public_subnet_ids) > 0

  # When explicit route table IDs are provided, use them directly for NAT routes.
  # Otherwise, discover route tables explicitly associated with private subnets.
  existing_private_route_table_ids_from_var = length(var.existing_private_route_table_ids) > 0 ? var.existing_private_route_table_ids : []

  existing_explicit_route_table_subnet_pairs = local.uses_existing_network && var.enable_nat_gateway && length(local.existing_private_route_table_ids_from_var) == 0 ? flatten([
    for route_table in data.aws_route_table.existing_by_id : [
      for association in route_table.associations : {
        route_table_id = route_table.id
        subnet_id      = association.subnet_id
      }
      if association.subnet_id != ""
    ]
  ]) : []

  existing_private_explicit_route_table_ids = distinct([
    for pair in local.existing_explicit_route_table_subnet_pairs : pair.route_table_id
    if contains(local.private_subnet_ids, pair.subnet_id)
  ])

  existing_private_subnets_with_explicit_route_tables = distinct([
    for pair in local.existing_explicit_route_table_subnet_pairs : pair.subnet_id
    if contains(local.private_subnet_ids, pair.subnet_id)
  ])

  # Identify private subnets that would rely on the main route table (discovery failure case).
  existing_private_subnets_using_main_route_table = local.uses_existing_network && var.enable_nat_gateway && length(local.existing_private_route_table_ids_from_var) == 0 ? setsubtract(
    toset(local.private_subnet_ids),
    toset(local.existing_private_subnets_with_explicit_route_tables),
  ) : toset([])

  # Route tables for NAT: use explicit variable if provided, otherwise discovered explicit route tables only.
  # Never include main_route_table_id.
  existing_private_route_table_ids_for_nat = local.uses_existing_network && var.enable_nat_gateway ? (
    length(local.existing_private_route_table_ids_from_var) > 0 ? local.existing_private_route_table_ids_from_var : local.existing_private_explicit_route_table_ids
  ) : []
}

resource "aws_eip" "existing_nat" {
  count = local.existing_nat_gateway_enabled ? 1 : 0

  domain = "vpc"

  tags = merge(local.tags, {
    Name = "${var.name_prefix}-existing-vpc-nat-eip"
  })
}

resource "aws_nat_gateway" "existing" {
  count = local.existing_nat_gateway_enabled ? 1 : 0

  allocation_id = aws_eip.existing_nat[0].id
  subnet_id     = local.public_subnet_ids[0]

  tags = merge(local.tags, {
    Name = "${var.name_prefix}-existing-vpc-nat"
  })

  depends_on = [terraform_data.existing_network_discovery]
}

resource "aws_route" "existing_private_nat" {
  for_each = local.existing_nat_gateway_enabled ? toset(local.existing_private_route_table_ids_for_nat) : toset([])

  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.existing[0].id
  route_table_id         = each.value

  depends_on = [terraform_data.existing_network_discovery]
}
