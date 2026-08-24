output "instance_id" {
  description = "EC2 instance ID of the bastion, for use with aws ssm send-command / start-session."
  value       = aws_instance.this.id
}

output "security_group_id" {
  description = "Bastion security group ID. Pass this into the database module's allowed_security_group_ids to permit RDS access."
  value       = aws_security_group.this.id
}
