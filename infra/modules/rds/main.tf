resource "aws_db_subnet_group" "main" {
  name       = "maybeos-${var.environment}"
  subnet_ids = var.private_subnet_ids
  tags       = { Name = "maybeos-${var.environment}" }
}

resource "aws_security_group" "rds" {
  name        = "maybeos-${var.environment}-rds"
  description = "Allow PostgreSQL access from ECS tasks"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    description = "PostgreSQL from VPC"
    cidr_blocks = ["10.0.0.0/16"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "maybeos-${var.environment}-rds" }
}

resource "aws_db_instance" "main" {
  identifier     = "maybeos-${var.environment}"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  db_name  = var.db_name
  username = var.db_username
  manage_master_user_password = true

  allocated_storage     = 20
  max_allocated_storage = 100
  storage_type          = "gp3"
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  multi_az            = false
  publicly_accessible = false
  skip_final_snapshot = false
  final_snapshot_identifier = "maybeos-${var.environment}-final"

  backup_retention_period = 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "Mon:04:00-Mon:05:00"

  tags = { Name = "maybeos-${var.environment}" }
}
