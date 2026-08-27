data "aws_iam_policy_document" "bucket" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.this.arn}/*"]

    principals {
      identifiers = ["cloudfront.amazonaws.com"]
      type        = "Service"
    }

    condition {
      test     = "StringEquals"
      values   = [aws_cloudfront_distribution.this.arn]
      variable = "AWS:SourceArn"
    }
  }
}

resource "aws_s3_bucket" "this" {
  #checkov:skip=CKV_AWS_18: SPA bucket access logging needs a dedicated log archive bucket outside SCRUM-154, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV_AWS_144: Sandbox SPA cross-region replication is deferred until DR requirements are approved, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV_AWS_145: SPA bucket KMS CMK is deferred until key ownership and grants are approved, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV2_AWS_61: SPA lifecycle policy is deferred until asset retention requirements are approved, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV2_AWS_62: SPA event notifications are deferred until audit ingestion is designed, owner platform-security, review by 2026-12-31
  bucket = var.bucket_name
  tags   = var.tags
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket = aws_s3_bucket.this.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_cloudfront_origin_access_control" "this" {
  name                              = "${var.name_prefix}-spa-oac"
  description                       = "Private S3 origin access for ExpenseFlow SPA."
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "this" {
  #checkov:skip=CKV_AWS_216: Distribution is enabled literally; Checkov reports a false positive after module expansion, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV_AWS_68: Sandbox CloudFront WAF is deferred until managed rule cost and ownership are approved, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV_AWS_86: CloudFront access logging needs a dedicated log archive bucket outside SCRUM-154, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV_AWS_174: Sandbox uses the default CloudFront certificate until a custom domain is approved, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV_AWS_310: SPA origin failover is deferred until a secondary origin exists, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV_AWS_374: Global sandbox SPA access intentionally has no geo restriction, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV2_AWS_32: Response headers policy attachment is deferred to the SPA hardening ticket, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV2_AWS_42: Sandbox uses the default CloudFront certificate until a custom domain is approved, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV2_AWS_47: CloudFront WAF Log4j managed rule configuration is deferred with WAF adoption, owner platform-security, review by 2026-12-31
  enabled             = true
  default_root_object = "index.html"
  comment             = "${var.name_prefix} SPA"
  price_class         = "PriceClass_100"
  is_ipv6_enabled     = true
  tags                = var.tags

  origin {
    domain_name              = aws_s3_bucket.this.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.this.id
    origin_id                = "expenseflow-spa-s3"
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = var.cache_policy_id
    compress               = true
    target_origin_id       = "expenseflow-spa-s3"
    viewer_protocol_policy = "redirect-to-https"
  }

  custom_error_response {
    error_caching_min_ttl = 0
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
  }

  custom_error_response {
    error_caching_min_ttl = 0
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

resource "aws_s3_bucket_policy" "this" {
  bucket = aws_s3_bucket.this.id
  policy = data.aws_iam_policy_document.bucket.json
}
