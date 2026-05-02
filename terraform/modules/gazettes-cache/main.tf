data "aws_caller_identity" "current" {}

# ─── S3 bucket (origem privada para CloudFront) ──────────────────────────────

resource "aws_s3_bucket" "gazettes_cache" {
  bucket = "fiscal-digital-gazettes-cache-prod"
}

resource "aws_s3_bucket_public_access_block" "gazettes_cache" {
  bucket                  = aws_s3_bucket.gazettes_cache.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Lifecycle: S3 Standard → Glacier IR após 180 dias
resource "aws_s3_bucket_lifecycle_configuration" "gazettes_cache" {
  bucket = aws_s3_bucket.gazettes_cache.id

  rule {
    id     = "archive-to-glacier-ir"
    status = "Enabled"

    transition {
      days          = 181
      storage_class = "GLACIER_IR"
    }
  }
}

# ─── ACM Certificate (us-east-1 — obrigatório para CloudFront) ──────────────

resource "aws_acm_certificate" "gazettes" {
  domain_name       = "gazettes.fiscaldigital.org"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "gazettes_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.gazettes.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = var.hosted_zone_id
}

resource "aws_acm_certificate_validation" "gazettes" {
  certificate_arn         = aws_acm_certificate.gazettes.arn
  validation_record_fqdns = [for r in aws_route53_record.gazettes_cert_validation : r.fqdn]

  timeouts {
    create = "10m"
  }
}

# ─── CloudFront OAC ──────────────────────────────────────────────────────────

resource "aws_cloudfront_origin_access_control" "gazettes_cache" {
  name                              = "fiscal-digital-gazettes-cache-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ─── CloudFront Response Headers Policy ─────────────────────────────────────

resource "aws_cloudfront_response_headers_policy" "gazettes_cache" {
  name    = "fiscal-digital-gazettes-cache-headers"
  comment = "Headers para PDFs do cache de gazettes"

  cors_config {
    access_control_allow_credentials = false

    access_control_allow_headers {
      items = ["*"]
    }

    access_control_allow_methods {
      items = ["GET", "HEAD"]
    }

    access_control_allow_origins {
      items = ["https://fiscaldigital.org"]
    }

    origin_override = true
  }

  security_headers_config {
    frame_options {
      frame_option = "SAMEORIGIN"
      override     = true
    }
  }

  custom_headers_config {
    items {
      header   = "Content-Disposition"
      value    = "inline"
      override = false
    }
  }
}

# ─── CloudFront distribution ─────────────────────────────────────────────────

resource "aws_cloudfront_distribution" "gazettes_cache" {
  enabled         = true
  is_ipv6_enabled = true
  aliases         = ["gazettes.fiscaldigital.org"]
  price_class     = "PriceClass_100"
  comment         = "fiscal-digital-gazettes-cache-prod"

  origin {
    domain_name              = aws_s3_bucket.gazettes_cache.bucket_regional_domain_name
    origin_id                = "s3-gazettes-cache"
    origin_access_control_id = aws_cloudfront_origin_access_control.gazettes_cache.id
  }

  default_cache_behavior {
    allowed_methods                = ["GET", "HEAD"]
    cached_methods                 = ["GET", "HEAD"]
    target_origin_id               = "s3-gazettes-cache"
    viewer_protocol_policy         = "redirect-to-https"
    compress                       = true
    response_headers_policy_id     = aws_cloudfront_response_headers_policy.gazettes_cache.id

    # Cache-Control vem do S3 (public, max-age=31536000, immutable)
    # Deixar CloudFront honrar o header do objeto
    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 86400
    max_ttl     = 31536000
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.gazettes.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# ─── S3 bucket policy (CloudFront OAC access) ────────────────────────────────

resource "aws_s3_bucket_policy" "gazettes_cache" {
  bucket = aws_s3_bucket.gazettes_cache.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.gazettes_cache.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.gazettes_cache.arn
        }
      }
    }]
  })
}

# ─── Route53 record — gazettes.fiscaldigital.org ─────────────────────────────

resource "aws_route53_record" "gazettes_a" {
  zone_id = var.hosted_zone_id
  name    = "gazettes.fiscaldigital.org"
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.gazettes_cache.domain_name
    zone_id                = aws_cloudfront_distribution.gazettes_cache.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "gazettes_aaaa" {
  zone_id = var.hosted_zone_id
  name    = "gazettes.fiscaldigital.org"
  type    = "AAAA"
  alias {
    name                   = aws_cloudfront_distribution.gazettes_cache.domain_name
    zone_id                = aws_cloudfront_distribution.gazettes_cache.hosted_zone_id
    evaluate_target_health = false
  }
}
