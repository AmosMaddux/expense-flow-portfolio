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
  existing_explicit_route_table_subnet_pairs = local.uses_existing_network && var.enable_nat_gateway ? flatten([
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

  existing_private_subnets_using_main_route_table = local.uses_existing_network && var.enable_nat_gateway ? setsubtract(
    toset(local.private_subnet_ids),
    toset(local.existing_private_subnets_with_explicit_route_tables),
  ) : toset([])

  existing_private_route_table_ids_for_nat = local.uses_existing_network && var.enable_nat_gateway ? distinct(concat(
    local.existing_private_explicit_route_table_ids,
    length(local.existing_private_subnets_using_main_route_table) > 0 ? [data.aws_vpc.selected[0].main_route_table_id] : [],
  )) : []
}

resource "aws_eip" "existing_nat" {
  count = local.uses_existing_network && var.enable_nat_gateway ? 1 : 0

  domain = "vpc"

  tags = {
    Name = "${var.name_prefix}-existing-vpc-nat-eip"
  }
}

resource "aws_nat_gateway" "existing" {
  count = local.uses_existing_network && var.enable_nat_gateway && length(local.public_subnet_ids) > 0 ? 1 : 0

  allocation_id = aws_eip.existing_nat[0].id
  subnet_id     = local.public_subnet_ids[0]

  tags = {
    Name = "${var.name_prefix}-existing-vpc-nat"
  }

  depends_on = [terraform_data.existing_network_discovery]
}

resource "aws_route" "existing_private_nat" {
  for_each = local.uses_existing_network && var.enable_nat_gateway ? toset(local.existing_private_route_table_ids_for_nat) : toset([])

  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.existing[0].id
  route_table_id         = each.value

  depends_on = [terraform_data.existing_network_discovery]
}
