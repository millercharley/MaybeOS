variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "aws_region" {
  type = string
}

variable "account_id" {
  type = string
}

variable "api_image" {
  type = string
}

variable "web_image" {
  type = string
}

variable "api_cpu" {
  type = number
}

variable "api_memory" {
  type = number
}

variable "web_cpu" {
  type = number
}

variable "web_memory" {
  type = number
}

variable "api_desired_count" {
  type = number
}

variable "web_desired_count" {
  type = number
}

variable "api_target_group_arn" {
  type = string
}

variable "web_target_group_arn" {
  type = string
}

variable "alb_security_group_id" {
  type = string
}

variable "database_url_secret_arn" {
  type = string
}

variable "redis_url" {
  type = string
}

variable "rds_security_group_id" {
  type = string
}

variable "redis_security_group_id" {
  type = string
}

variable "jwt_secret_arn" {
  type = string
}

variable "magic_link_secret_arn" {
  type = string
}

variable "stripe_secret_key_arn" {
  type = string
}

variable "stripe_webhook_secret_arn" {
  type = string
}

variable "api_url" {
  type = string
}

variable "web_url" {
  type = string
}
