terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Uncomment and configure for remote state:
  # backend "s3" {
  #   bucket         = "maybeos-terraform-state"
  #   key            = "prod/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "maybeos-terraform-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "maybeos"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# ── Data sources ──────────────────────────────────────
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# ── Modules ───────────────────────────────────────────

module "vpc" {
  source      = "./modules/vpc"
  environment = var.environment
  vpc_cidr    = var.vpc_cidr
}

module "ecr" {
  source      = "./modules/ecr"
  environment = var.environment
}

module "secrets" {
  source      = "./modules/secrets"
  environment = var.environment
}

module "rds" {
  source            = "./modules/rds"
  environment       = var.environment
  vpc_id            = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  db_instance_class = var.db_instance_class
  db_name           = "maybeos"
  db_username       = "maybeos"
}

module "elasticache" {
  source             = "./modules/elasticache"
  environment        = var.environment
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  node_type          = var.redis_node_type
}

module "alb" {
  source            = "./modules/alb"
  environment       = var.environment
  vpc_id            = module.vpc.vpc_id
  public_subnet_ids = module.vpc.public_subnet_ids
  certificate_arn   = var.certificate_arn
}

module "ecs" {
  source             = "./modules/ecs"
  environment        = var.environment
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  aws_region         = var.aws_region
  account_id         = data.aws_caller_identity.current.account_id

  # Container images
  api_image = "${module.ecr.api_repository_url}:latest"
  web_image = "${module.ecr.web_repository_url}:latest"

  # Task sizing
  api_cpu    = var.api_cpu
  api_memory = var.api_memory
  web_cpu    = var.web_cpu
  web_memory = var.web_memory

  # Scaling
  api_desired_count = var.api_desired_count
  web_desired_count = var.web_desired_count

  # ALB target groups
  api_target_group_arn = module.alb.api_target_group_arn
  web_target_group_arn = module.alb.web_target_group_arn
  alb_security_group_id = module.alb.security_group_id

  # Database & Redis
  database_url_secret_arn   = module.secrets.database_url_arn
  redis_url                 = module.elasticache.redis_endpoint
  rds_security_group_id     = module.rds.security_group_id
  redis_security_group_id   = module.elasticache.security_group_id

  # App secrets
  jwt_secret_arn          = module.secrets.jwt_secret_arn
  magic_link_secret_arn   = module.secrets.magic_link_secret_arn
  stripe_secret_key_arn   = module.secrets.stripe_secret_key_arn
  stripe_webhook_secret_arn = module.secrets.stripe_webhook_secret_arn

  # App config
  api_url = "https://${var.api_domain}"
  web_url = "https://${var.web_domain}"
}
