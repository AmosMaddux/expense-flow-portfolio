output "state_bucket_name" {
  description = "S3 bucket used for Terraform remote state."
  value       = aws_s3_bucket.terraform_state.bucket
}

output "aws_region" {
  description = "AWS region that hosts the Terraform remote state resources."
  value       = var.aws_region
}
