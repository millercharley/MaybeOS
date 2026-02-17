variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (staging, production)"
  type        = string
  default     = "production"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

# ── Domain & TLS ──────────────────────────────────────

variable "api_domain" {
  description = "Domain name for the API (e.g., api.maybeos.app)"
  type        = string
}

variable "web_domain" {
  description = "Domain name for the web app (e.g., app.maybeos.app)"
  type        = string
}

variable "certificate_arn" {
  description = "ARN of the ACM certificate for HTTPS"
  type        = string
}

# ── Database ──────────────────────────────────────────

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.micro"
}

# ── Redis ─────────────────────────────────────────────

variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t4g.micro"
}

# ── ECS Task Sizing ──────────────────────────────────

variable "api_cpu" {
  description = "API task CPU units (1024 = 1 vCPU)"
  type        = number
  default     = 512
}

variable "api_memory" {
  description = "API task memory in MiB"
  type        = number
  default     = 1024
}

variable "web_cpu" {
  description = "Web task CPU units"
  type        = number
  default     = 256
}

variable "web_memory" {
  description = "Web task memory in MiB"
  type        = number
  default     = 512
}

variable "api_desired_count" {
  description = "Number of API tasks"
  type        = number
  default     = 2
}

variable "web_desired_count" {
  description = "Number of Web tasks"
  type        = number
  default     = 2
}
