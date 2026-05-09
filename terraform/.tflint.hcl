plugin "aws" {
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
  version = "0.47.0"
  enabled = true
}

config {
  call_module_type = "local"
}
