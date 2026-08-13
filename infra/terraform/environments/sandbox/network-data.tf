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

data "aws_route_table" "existing_private" {
  for_each = local.uses_existing_network && var.enable_nat_gateway ? toset(local.private_subnet_ids) : toset([])

  subnet_id = each.value
}

resource "aws_eip" "existing_nat" {
  count = local.uses_existing_network && var.enable_nat_gateway ? 1 : 0

  domain = "vpc"

  tags = {
    Name = "${var.name_prefix}-existing-vpc-nat-eip"
  }
}

resource "aws_nat_gateway" "existing" {
  count = local.uses_existing_network && var.enable_nat_gateway ? 1 : 0

  allocation_id = aws_eip.existing_nat[0].id
  subnet_id     = local.public_subnet_ids[0]

  tags = {
    Name = "${var.name_prefix}-existing-vpc-nat"
  }
}

resource "aws_route" "existing_private_nat" {
  for_each = local.uses_existing_network && var.enable_nat_gateway ? toset([for route_table in data.aws_route_table.existing_private : route_table.id]) : toset([])

  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.existing[0].id
  route_table_id         = each.value
}
