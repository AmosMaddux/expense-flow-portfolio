resource "aws_security_group" "public_alb" {
  name        = "${var.name_prefix}-public-alb-sg"
  description = "Controls inbound traffic to the public ExpenseFlow ALB."
  vpc_id      = var.vpc_id

  tags = {
    Name = "${var.name_prefix}-public-alb-sg"
  }
}

resource "aws_vpc_security_group_ingress_rule" "public_alb_http" {
  security_group_id = aws_security_group.public_alb.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 80
  ip_protocol       = "tcp"
  to_port           = 80
}

resource "aws_vpc_security_group_ingress_rule" "public_alb_https" {
  count = var.public_alb_certificate_arn == null ? 0 : 1

  security_group_id = aws_security_group.public_alb.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  ip_protocol       = "tcp"
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "public_alb_all" {
  security_group_id = aws_security_group.public_alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_security_group" "internal_alb" {
  name        = "${var.name_prefix}-internal-alb-sg"
  description = "Controls inbound traffic to the internal GL-coding ALB."
  vpc_id      = var.vpc_id

  tags = {
    Name = "${var.name_prefix}-internal-alb-sg"
  }
}

resource "aws_vpc_security_group_ingress_rule" "internal_alb_gl_coding" {
  security_group_id = aws_security_group.internal_alb.id
  cidr_ipv4         = var.vpc_cidr
  from_port         = 80
  ip_protocol       = "tcp"
  to_port           = 80
}

resource "aws_vpc_security_group_egress_rule" "internal_alb_all" {
  security_group_id = aws_security_group.internal_alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_lb" "public" {
  name               = var.public_alb_name
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.public_alb.id]
  subnets            = var.public_subnet_ids

  tags = {
    Name = var.public_alb_name
  }
}

resource "aws_lb" "internal" {
  name               = var.internal_alb_name
  internal           = true
  load_balancer_type = "application"
  security_groups    = [aws_security_group.internal_alb.id]
  subnets            = var.internal_subnet_ids

  tags = {
    Name = var.internal_alb_name
  }
}

resource "aws_lb_target_group" "core_case" {
  name        = var.core_case_target_group_name
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = "/health"
    protocol            = "HTTP"
    timeout             = 5
    unhealthy_threshold = 3
  }
}

resource "aws_lb_target_group" "gl_coding" {
  name        = var.gl_coding_target_group_name
  port        = 8001
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = "/health"
    protocol            = "HTTP"
    timeout             = 5
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "public_http_redirect" {
  count = var.public_alb_certificate_arn == null ? 0 : 1

  load_balancer_arn = aws_lb.public.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "public_http" {
  count = var.public_alb_certificate_arn == null ? 1 : 0

  load_balancer_arn = aws_lb.public.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    fixed_response {
      content_type = "text/plain"
      message_body = "Not found"
      status_code  = "404"
    }

    type = "fixed-response"
  }
}

resource "aws_lb_listener" "public_https" {
  count = var.public_alb_certificate_arn == null ? 0 : 1

  certificate_arn   = var.public_alb_certificate_arn
  load_balancer_arn = aws_lb.public.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"

  default_action {
    fixed_response {
      content_type = "text/plain"
      message_body = "Not found"
      status_code  = "404"
    }

    type = "fixed-response"
  }
}

resource "aws_lb_listener_rule" "core_case_https" {
  count = var.public_alb_certificate_arn == null ? 0 : 1

  listener_arn = aws_lb_listener.public_https[0].arn
  priority     = 100

  action {
    target_group_arn = aws_lb_target_group.core_case.arn
    type             = "forward"
  }

  condition {
    path_pattern {
      values = ["/v1", "/v1/*"]
    }
  }
}

resource "aws_lb_listener_rule" "core_case_http" {
  count = var.public_alb_certificate_arn == null && var.allow_plain_http_public_api ? 1 : 0

  listener_arn = aws_lb_listener.public_http[0].arn
  priority     = 100

  action {
    target_group_arn = aws_lb_target_group.core_case.arn
    type             = "forward"
  }

  condition {
    path_pattern {
      values = ["/v1", "/v1/*"]
    }
  }
}

resource "aws_lb_listener_rule" "runtime_smoke_https" {
  count = var.public_alb_certificate_arn == null || length(var.runtime_smoke_source_cidrs) == 0 ? 0 : 1

  listener_arn = aws_lb_listener.public_https[0].arn
  priority     = 50

  action {
    target_group_arn = aws_lb_target_group.core_case.arn
    type             = "forward"
  }

  condition {
    path_pattern {
      values = ["/v1/runtime-smoke/*"]
    }
  }

  condition {
    source_ip {
      values = var.runtime_smoke_source_cidrs
    }
  }
}

resource "aws_lb_listener_rule" "runtime_smoke_https_block" {
  count = var.public_alb_certificate_arn == null ? 0 : 1

  listener_arn = aws_lb_listener.public_https[0].arn
  priority     = 51

  action {
    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }

    type = "fixed-response"
  }

  condition {
    path_pattern {
      values = ["/v1/runtime-smoke/*"]
    }
  }
}

resource "aws_lb_listener_rule" "runtime_smoke_http" {
  count = var.public_alb_certificate_arn == null && var.allow_plain_http_public_api && length(var.runtime_smoke_source_cidrs) > 0 ? 1 : 0

  listener_arn = aws_lb_listener.public_http[0].arn
  priority     = 50

  action {
    target_group_arn = aws_lb_target_group.core_case.arn
    type             = "forward"
  }

  condition {
    path_pattern {
      values = ["/v1/runtime-smoke/*"]
    }
  }

  condition {
    source_ip {
      values = var.runtime_smoke_source_cidrs
    }
  }
}

resource "aws_lb_listener_rule" "runtime_smoke_http_block" {
  count = var.public_alb_certificate_arn == null ? 1 : 0

  listener_arn = aws_lb_listener.public_http[0].arn
  priority     = 51

  action {
    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }

    type = "fixed-response"
  }

  condition {
    path_pattern {
      values = ["/v1/runtime-smoke/*"]
    }
  }
}

resource "aws_lb_listener" "internal_http" {
  load_balancer_arn = aws_lb.internal.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    target_group_arn = aws_lb_target_group.gl_coding.arn
    type             = "forward"
  }
}
