output "redis_endpoint" {
  value = "redis://${aws_elasticache_cluster.main.cache_nodes[0].address}:6379"
}

output "security_group_id" {
  value = aws_security_group.redis.id
}
