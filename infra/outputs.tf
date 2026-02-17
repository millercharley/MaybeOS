output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  value       = module.alb.dns_name
}

output "api_ecr_repository_url" {
  description = "ECR repository URL for the API image"
  value       = module.ecr.api_repository_url
}

output "web_ecr_repository_url" {
  description = "ECR repository URL for the Web image"
  value       = module.ecr.web_repository_url
}

output "rds_endpoint" {
  description = "RDS PostgreSQL endpoint"
  value       = module.rds.endpoint
}

output "redis_endpoint" {
  description = "ElastiCache Redis endpoint"
  value       = module.elasticache.redis_endpoint
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = module.ecs.cluster_name
}

output "api_service_name" {
  description = "ECS API service name"
  value       = module.ecs.api_service_name
}

output "web_service_name" {
  description = "ECS Web service name"
  value       = module.ecs.web_service_name
}
