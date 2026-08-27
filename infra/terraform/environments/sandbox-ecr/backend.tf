terraform {
  backend "s3" {
    key          = "sandbox/ecr-repositories/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}
