terraform {
  backend "s3" {
    bucket       = "expenseflow-sandbox-terraform-state-208096650110-us-east-1"
    key          = "sandbox/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
