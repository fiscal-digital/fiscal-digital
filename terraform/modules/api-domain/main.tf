/*
 * api-domain — `api.fiscaldigital.org` subdomain para a API pública.
 *
 * Arquitetura: CloudFront em front da Lambda Function URL existente.
 *
 *   client → api.fiscaldigital.org → CloudFront → Lambda Function URL → Lambda
 *
 * Vantagens vs. Lambda Function URL direta:
 *   - Domain estável para LLMs/agentes referenciarem no OpenAPI
 *   - TLS managed pelo ACM com SAN customizado
 *   - Edge caching opcional (hoje desabilitado, Lambda controla cache-control)
 *
 * Cuidados aplicados:
 *   - NUNCA forward `Host` header (LRN-20260503-028/034 — causa 403
 *     AccessDeniedException em Lambda Function URL com OAC sigv4 ou
 *     AWS::Lambda::FunctionUrl com authType=NONE)
 *   - Pass-through cache: TTL=0 deixa Lambda controlar via `cache-control`
 *   - Forward `Origin`, `If-None-Match`, `If-Modified-Since`, `Accept-Encoding`
 *     para preservar CORS preflight + ETag/304
 *
 * Blueprint AI SEO Onda 2 §5.1.
 */

# ─── ACM Certificate (us-east-1 — obrigatório para CloudFront) ──────────────

resource "aws_acm_certificate" "api" {
  domain_name       = "api.fiscaldigital.org"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "api_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.api.domain_validation_options : dvo.domain_name => {
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

resource "aws_acm_certificate_validation" "api" {
  certificate_arn         = aws_acm_certificate.api.arn
  validation_record_fqdns = [for r in aws_route53_record.api_cert_validation : r.fqdn]

  timeouts {
    create = "10m"
  }
}

# ─── CloudFront origin request policy (forward sem Host) ────────────────────
#
# Forward minimal — Lambda Function URL com authType=NONE não exige sigv4
# mas FALHA com 403 se receber `Host` diferente do esperado (LRN-20260503-028).
# Forward apenas o necessário para preservar CORS + ETag.

resource "aws_cloudfront_origin_request_policy" "api" {
  name    = "fiscal-digital-api-origin-policy"
  comment = "Forward seletivo para Lambda Function URL (sem Host)"

  cookies_config {
    cookie_behavior = "none"
  }

  headers_config {
    header_behavior = "whitelist"

    headers {
      items = [
        "Accept",
        "Accept-Encoding",
        "Accept-Language",
        "Origin",
        "If-None-Match",
        "If-Modified-Since",
        "User-Agent",
        # Host explicitamente OMITIDO (LRN-20260503-028)
      ]
    }
  }

  query_strings_config {
    query_string_behavior = "all"
  }
}

# ─── CloudFront cache policy (pass-through) ──────────────────────────────────
#
# A API já controla cache via cache-control header. CloudFront não cacheia
# por default — TTL=0 honra o que vier de Lambda. Para endpoints que retornam
# `cache-control: public, max-age=300`, CloudFront cacheia 5min.

resource "aws_cloudfront_cache_policy" "api" {
  name        = "fiscal-digital-api-cache-policy"
  comment     = "Pass-through; Lambda controla cache-control"
  default_ttl = 0
  max_ttl     = 31536000
  min_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "all"
    }
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true
  }
}

# ─── CloudFront distribution ─────────────────────────────────────────────────

resource "aws_cloudfront_distribution" "api" {
  enabled         = true
  is_ipv6_enabled = true
  aliases         = ["api.fiscaldigital.org"]
  price_class     = "PriceClass_100"
  comment         = "fiscal-digital-api-prod"

  origin {
    domain_name = var.lambda_function_url_domain
    origin_id   = "lambda-api"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      # Lambda Function URL aceita default timeouts
    }
  }

  default_cache_behavior {
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    target_origin_id         = "lambda-api"
    viewer_protocol_policy   = "redirect-to-https"
    compress                 = true
    cache_policy_id          = aws_cloudfront_cache_policy.api.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.api.id
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.api.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# ─── Route53 records — api.fiscaldigital.org ─────────────────────────────────

resource "aws_route53_record" "api_a" {
  zone_id = var.hosted_zone_id
  name    = "api.fiscaldigital.org"
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.api.domain_name
    zone_id                = aws_cloudfront_distribution.api.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "api_aaaa" {
  zone_id = var.hosted_zone_id
  name    = "api.fiscaldigital.org"
  type    = "AAAA"
  alias {
    name                   = aws_cloudfront_distribution.api.domain_name
    zone_id                = aws_cloudfront_distribution.api.hosted_zone_id
    evaluate_target_health = false
  }
}
