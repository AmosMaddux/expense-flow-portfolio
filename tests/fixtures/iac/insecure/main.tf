resource "aws_security_group" "synthetic" {
  name        = "synthetic-insecure-fixture"
  description = "Synthetic fixture that must be flagged by IaC scanners."
  vpc_id      = "vpc-00000000000000000"

  ingress {
    description = "Synthetic public HTTP ingress fixture."
    cidr_blocks = ["0.0.0.0/0"]
    from_port   = 80
    protocol    = "tcp"
    to_port     = 80
  }
}