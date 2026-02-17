output "database_url_arn" {
  value = aws_secretsmanager_secret.database_url.arn
}

output "jwt_secret_arn" {
  value = aws_secretsmanager_secret.jwt_secret.arn
}

output "magic_link_secret_arn" {
  value = aws_secretsmanager_secret.magic_link_secret.arn
}

output "stripe_secret_key_arn" {
  value = aws_secretsmanager_secret.stripe_secret_key.arn
}

output "stripe_webhook_secret_arn" {
  value = aws_secretsmanager_secret.stripe_webhook_secret.arn
}
