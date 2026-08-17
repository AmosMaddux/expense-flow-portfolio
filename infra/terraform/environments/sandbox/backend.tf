terraform {
  backend "s3" {
    key          = "sandbox/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}
