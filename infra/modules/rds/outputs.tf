output "endpoint" {
  value = aws_db_instance.main.endpoint
}

output "security_group_id" {
  value = aws_security_group.rds.id
}
