resource "aws_security_group" "public_alb" {
  name        = "${var.name_prefix}-public-alb-sg"
  description = "Controls inbound traffic to the public ExpenseFlow ALB."
  vpc_id      = var.vpc_id

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-public-alb-sg"
  })
}

resource "terraform_data" "runtime_smoke_http_configuration" {
  lifecycle {
    precondition {
      condition     = var.public_alb_certificate_arn != null || var.allow_plain_http_public_api || length(var.runtime_smoke_source_cidrs) == 0
      error_message = "runtime_smoke_source_cidrs requires allow_plain_http_public_api=true when no public_alb_certificate_arn is configured."
    }
  }
}

#tfsec:ignore:aws-vpc-no-public-ingress-sgr Public sandbox API ingress is required for external employee portal smoke testing, owner platform-security, review by 2026-12-31
resource "aws_vpc_security_group_ingress_rule" "public_alb_http" {
  #checkov:skip=CKV_AWS_260: Public sandbox API accepts HTTP for certificate-free smoke testing, owner platform-security, review by 2026-12-31
  security_group_id = aws_security_group.public_alb.id
  description       = "Allow public HTTP traffic to the sandbox API."
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 80
  ip_protocol       = "tcp"
  to_port           = 80
}

#tfsec:ignore:aws-vpc-no-public-ingress-sgr Public sandbox API ingress is required for external employee portal testing, owner platform-security, review by 2026-12-31
resource "aws_vpc_security_group_ingress_rule" "public_alb_https" {
  #checkov:skip=CKV_AWS_260: Public sandbox API accepts HTTPS from internet clients, owner platform-security, review by 2026-12-31
  count = var.public_alb_certificate_arn == null ? 0 : 1

  security_group_id = aws_security_group.public_alb.id
  description       = "Allow public HTTPS traffic to the sandbox API."
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  ip_protocol       = "tcp"
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "public_alb_all" {
  #checkov:skip=CKV_AWS_382: ALB egress remains unrestricted in sandbox until service endpoint ranges are modeled, owner platform-security, review by 2026-12-31
  security_group_id = aws_security_group.public_alb.id
  description       = "Allow public ALB egress to service targets."
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_security_group" "internal_alb" {
  name        = "${var.name_prefix}-internal-alb-sg"
  description = "Controls inbound traffic to the internal GL-coding ALB."
  vpc_id      = var.vpc_id

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-internal-alb-sg"
  })
}

resource "aws_vpc_security_group_egress_rule" "internal_alb_all" {
  #checkov:skip=CKV_AWS_382: Internal ALB egress remains unrestricted in sandbox until target endpoint ranges are modeled, owner platform-security, review by 2026-12-31
  security_group_id = aws_security_group.internal_alb.id
  description       = "Allow internal ALB egress to service targets."
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

#tfsec:ignore:aws-elb-alb-not-public Public API must be internet-facing in sandbox, owner platform-security, review by 2026-12-31
resource "aws_lb" "public" {
  #checkov:skip=CKV2_AWS_20: HTTP listener is retained for certificate-free sandbox smoke testing, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV2_AWS_28: Public sandbox ALB WAF is deferred until managed rule cost and ownership are approved, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV_AWS_150: Sandbox ALB deletion protection is disabled so ephemeral environments can be torn down, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV_AWS_91: Sandbox ALB access logs are deferred until a dedicated log bucket is provisioned, owner platform-security, review by 2026-12-31
  name                       = var.public_alb_name
  internal                   = false
  load_balancer_type         = "application"
  drop_invalid_header_fields = true
  security_groups            = [aws_security_group.public_alb.id]
  subnets                    = var.public_subnet_ids

  tags = merge(var.tags, {
    Name = var.public_alb_name
  })
}

resource "aws_lb" "internal" {
  #checkov:skip=CKV2_AWS_20: Internal GL-coding ALB uses HTTP only inside private subnets with application-layer auth, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV_AWS_150: Sandbox internal ALB deletion protection is disabled so ephemeral environments can be torn down, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV_AWS_91: Sandbox internal ALB access logs are deferred until a dedicated log bucket is provisioned, owner platform-security, review by 2026-12-31
  name                       = var.internal_alb_name
  internal                   = true
  load_balancer_type         = "application"
  drop_invalid_header_fields = true
  security_groups            = [aws_security_group.internal_alb.id]
  subnets                    = var.internal_subnet_ids

  tags = merge(var.tags, {
    Name = var.internal_alb_name
  })
}

resource "aws_lb_target_group" "core_case" {
  #checkov:skip=CKV_AWS_378: Core Case target group uses HTTP behind the ALB in private service networking, owner platform-security, review by 2026-12-31
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

  tags = merge(var.tags, {
    Name = var.core_case_target_group_name
  })
}

resource "aws_lb_target_group" "gl_coding" {
  #checkov:skip=CKV_AWS_378: GL-coding target group uses HTTP behind the internal ALB in private service networking, owner platform-security, review by 2026-12-31
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

  tags = merge(var.tags, {
    Name = var.gl_coding_target_group_name
  })
}

#tfsec:ignore:aws-elb-http-not-used HTTP listener only redirects to HTTPS when a certificate is configured, owner platform-security, review by 2026-12-31
resource "aws_lb_listener" "public_http_redirect" {
  #checkov:skip=CKV_AWS_2: HTTP listener only redirects to HTTPS when a certificate is configured, owner platform-security, review by 2026-12-31
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

#tfsec:ignore:aws-elb-http-not-used Plain HTTP is allowed only for certificate-free sandbox smoke testing, owner platform-security, review by 2026-12-31
resource "aws_lb_listener" "public_http" {
  #checkov:skip=CKV_AWS_103: Plain HTTP is allowed only for certificate-free sandbox smoke testing, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV_AWS_2: Plain HTTP is allowed only for certificate-free sandbox smoke testing, owner platform-security, review by 2026-12-31
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

#tfsec:ignore:aws-elb-http-not-used Internal GL-coding traffic stays inside private subnets and uses application-layer auth, owner platform-security, review by 2026-12-31
resource "aws_lb_listener" "internal_http" {
  #checkov:skip=CKV_AWS_103: Internal GL-coding listener uses HTTP only inside private subnets with application-layer auth, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV_AWS_2: Internal GL-coding traffic stays inside private subnets and uses application-layer auth, owner platform-security, review by 2026-12-31
  load_balancer_arn = aws_lb.internal.arn
  port              = 80
  protocol          = "HTTP"

  # Default action: forward to GL-coding.
  # When gl_coding_internal_auth_secret_arn is configured, listener rules take precedence
  # and enforce authentication before traffic reaches this default action.
  default_action {
    target_group_arn = aws_lb_target_group.gl_coding.arn
    type             = "forward"
  }
}

# GL-coding service routing with defense-in-depth authentication.
# Core Case must authenticate by including X-Internal-Auth header when calling GL-coding.
# This listener rule makes authentication intent explicit at the infrastructure layer.
resource "aws_lb_listener_rule" "gl_coding_authenticated" {
  count = var.gl_coding_internal_auth_secret_arn != null ? 1 : 0

  listener_arn = aws_lb_listener.internal_http.arn
  priority     = 1

  action {
    target_group_arn = aws_lb_target_group.gl_coding.arn
    type             = "forward"
  }

  # Require X-Internal-Auth header to be present.
  # Core Case is responsible for retrieving the secret value and including it in the header.
  # GL-coding service validates that the header value matches its configured secret.
  condition {
    http_header {
      http_header_name = "X-Internal-Auth"
      values           = ["*"]
    }
  }
}

# Fallback rule for GL-coding requests without proper authentication.
# Returns 403 Forbidden if request lacks X-Internal-Auth header.
resource "aws_lb_listener_rule" "gl_coding_unauthorized" {
  count = var.gl_coding_internal_auth_secret_arn != null ? 1 : 0

  listener_arn = aws_lb_listener.internal_http.arn
  priority     = 2

  action {
    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }

    type = "fixed-response"
  }

  # Match all traffic to GL-coding when auth is configured.
  # This is a catch-all that ensures unauthorized requests are rejected.
  condition {
    path_pattern {
      values = ["/*"]
    }
  }
}
