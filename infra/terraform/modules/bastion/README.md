# Bastion

Provisions a permanent, SSM-only EC2 instance in a private subnet for
operational access to the sandbox database: running migrations, seeding
synthetic test accounts, and generating MFA codes. It goes up with the rest
of the sandbox environment and comes down when the environment is torn down.

The bastion has no inbound security group rules and no public IP - it is
reachable only through SSM Session Manager, using an instance profile scoped
to exactly what it needs (SSM connectivity, pulling the core-case-service
image from its own ECR repository, and reading the two specific secrets its
scripts require). Nothing is exposed to the internet.

## Requirements

The VPC must already have `ssm`, `ssmmessages`, and `ec2messages` interface
VPC endpoints (or NAT/internet egress) - see
`environments/sandbox/endpoints.tf`. Without one of these, the SSM agent on
the instance cannot register and the instance is unreachable.

This account's tagging SCP requires every resource an `ec2:RunInstances` call
creates - the instance *and* its EBS volume - to carry both `user` and
`env=sandbox` tags, or the launch is denied outright. The module tags both
via `tags` (instance) and `volume_tags` (root volume); pass a `tags` map that
includes those two keys.

This account's SCP also restricts EC2 instance types to the `t2`, `t3`, and
`t4g` families - `instance_type` validates this.

## Usage

Operational commands run via `scripts/aws/bastion-run.sh`, which dispatches
to the bastion over `aws ssm send-command` (no session, no tunnel, no SSH
key):

```
BASTION_INSTANCE_ID=$(terraform output -raw bastion_instance_id)
CORE_CASE_DB_MASTER_USER_SECRET_ARN=$(terraform output -raw core_case_db_master_user_secret_arn)
MFA_TOTP_SECRET_ENCRYPTION_KEY_SECRET_ARN=<the ARN passed as core_case_mfa_totp_secret_encryption_key_secret_arn>
CORE_CASE_IMAGE_URI=$(terraform output -raw core_case_repository_url)

scripts/aws/bastion-run.sh migrate
scripts/aws/bastion-run.sh seed
scripts/aws/bastion-run.sh code employee-1
```

The bastion pulls the `:latest` tag from Core Case's ECR repository on every
invocation, so it always runs whatever was most recently pushed - not
necessarily what's currently deployed to ECS if `core_case_image_uri` pins a
different tag there.

## Out of scope

- No automatic seeding on boot. Migrations and account seeding are explicit,
  operator-triggered commands (`scripts/aws/bastion-run.sh migrate` /
  `seed`), not something that runs unattended when the instance starts.
- No SSH access. The instance has no key pair and no inbound rules; all
  access is through SSM.
- Docker is installed via user-data on first boot. If Docker installation
  ever needs to change, replacing the instance (not patching a running one)
  is the supported path - user-data only runs once per instance lifecycle.
