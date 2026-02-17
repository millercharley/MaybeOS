# Secrets are created with placeholder values.
# Actual values must be set manually in the AWS console or via CLI
# BEFORE deploying the ECS services.

resource "aws_secretsmanager_secret" "database_url" {
  name        = "maybeos/${var.environment}/database-url"
  description = "PostgreSQL connection string"
}

resource "aws_secretsmanager_secret" "jwt_secret" {
  name        = "maybeos/${var.environment}/jwt-secret"
  description = "JWT signing secret"
}

resource "aws_secretsmanager_secret" "magic_link_secret" {
  name        = "maybeos/${var.environment}/magic-link-secret"
  description = "Magic link token secret"
}

resource "aws_secretsmanager_secret" "stripe_secret_key" {
  name        = "maybeos/${var.environment}/stripe-secret-key"
  description = "Stripe secret API key"
}

resource "aws_secretsmanager_secret" "stripe_webhook_secret" {
  name        = "maybeos/${var.environment}/stripe-webhook-secret"
  description = "Stripe webhook signing secret"
}
