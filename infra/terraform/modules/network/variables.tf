variable "name_prefix" {
  description = "Name prefix for networking resources."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the sandbox VPC."
  type        = string
  default     = "10.40.0.0/16"
}

variable "availability_zone_count" {
  description = "Number of availability zones to use."
  type        = number
  default     = 2

  validation {
    condition     = var.availability_zone_count >= 2 && var.availability_zone_count <= 3
    error_message = "availability_zone_count must be between 2 and 3."
  }
}

variable "enable_nat_gateway" {
  description = "Whether to create a NAT gateway for private subnet egress."
  type        = bool
  default     = true
}
