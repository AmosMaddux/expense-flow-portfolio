# ECR moved to infra/terraform/environments/sandbox-ecr so normal runtime
# teardown can leave cheap reusable image storage in place.
removed {
  from = module.ecs.aws_ecr_repository.core_case

  lifecycle {
    destroy = false
  }
}

removed {
  from = module.ecs.aws_ecr_repository.gl_coding

  lifecycle {
    destroy = false
  }
}

removed {
  from = module.lambda_stage_transition_consumer.aws_ecr_repository.this

  lifecycle {
    destroy = false
  }
}
