# MaybeOS — AWS Deployment Guide

## Architecture

```
Internet → ALB (HTTPS) → ECS Fargate
                            ├── API (NestJS :3001)  → RDS PostgreSQL 16
                            │                       → ElastiCache Redis 7
                            └── Web (Next.js :3000)
```

All services run in private subnets. Only the ALB is public-facing.

## Prerequisites

1. **AWS Account** with admin access
2. **Terraform** >= 1.5 installed locally
3. **Docker** installed locally (for testing images)
4. **AWS CLI** configured (`aws configure`)
5. **Domain name** with DNS you control
6. **ACM Certificate** for your domain (must be in the same region as the ALB)

## Step 1: Provision Infrastructure

```bash
cd infra

# Copy and fill in your values
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your domain, certificate ARN, etc.

terraform init
terraform plan
terraform apply
```

This creates: VPC, subnets, NAT gateway, ALB, ECS cluster, RDS, ElastiCache, ECR repos, Secrets Manager entries, IAM roles, and CloudWatch log groups.

## Step 2: Set Secrets

After `terraform apply`, populate the secrets in AWS Secrets Manager:

```bash
# Database URL (use the RDS endpoint from terraform output)
aws secretsmanager put-secret-value \
  --secret-id maybeos/production/database-url \
  --secret-string "postgresql://maybeos:YOUR_PASSWORD@RDS_ENDPOINT:5432/maybeos"

# JWT secret (generate a random 64-char string)
aws secretsmanager put-secret-value \
  --secret-id maybeos/production/jwt-secret \
  --secret-string "$(openssl rand -hex 32)"

# Magic link secret
aws secretsmanager put-secret-value \
  --secret-id maybeos/production/magic-link-secret \
  --secret-string "$(openssl rand -hex 32)"

# Stripe keys
aws secretsmanager put-secret-value \
  --secret-id maybeos/production/stripe-secret-key \
  --secret-string "sk_live_..."

aws secretsmanager put-secret-value \
  --secret-id maybeos/production/stripe-webhook-secret \
  --secret-string "whsec_..."
```

> **Note:** RDS uses AWS-managed master password. Retrieve it from the console or via `aws rds describe-db-instances`.

## Step 3: Build & Push Images (first time)

```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com

# Build and push API
docker build -f apps/api/Dockerfile -t ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/maybeos-production/api:latest .
docker push ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/maybeos-production/api:latest

# Build and push Web
docker build -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://api.maybeos.app \
  -t ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/maybeos-production/web:latest .
docker push ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/maybeos-production/web:latest
```

## Step 4: Run Database Migrations

Run a one-off ECS task to apply Prisma migrations:

```bash
aws ecs run-task \
  --cluster maybeos-production \
  --task-definition maybeos-production-api \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[SUBNET_IDS],securityGroups=[SG_IDS],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"api","command":["npx","prisma","migrate","deploy","--schema","apps/api/prisma/schema.prisma"]}]}'
```

## Step 5: DNS

Point your domains to the ALB:
- `app.maybeos.app` → ALB DNS name (CNAME)
- `api.maybeos.app` → ALB DNS name (CNAME), or use path-based routing via `/api/*`

Get the ALB DNS name:
```bash
cd infra && terraform output alb_dns_name
```

## Step 6: CI/CD (GitHub Actions)

The workflow at `.github/workflows/deploy.yml` automates everything on push to `main`.

### Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `AWS_DEPLOY_ROLE_ARN` | IAM role ARN for GitHub OIDC (see below) |

### Required GitHub Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `API_ECR_REPO` | ECR repo name for API | `maybeos-production/api` |
| `WEB_ECR_REPO` | ECR repo name for Web | `maybeos-production/web` |
| `NEXT_PUBLIC_API_URL` | Public API URL | `https://api.maybeos.app` |
| `ECS_CLUSTER` | ECS cluster name | `maybeos-production` |
| `API_SERVICE` | ECS API service name | `maybeos-production-api` |
| `WEB_SERVICE` | ECS Web service name | `maybeos-production-web` |
| `API_TASK_DEFINITION` | API task definition family | `maybeos-production-api` |
| `PRIVATE_SUBNETS` | Comma-separated subnet IDs | `subnet-abc,subnet-def` |
| `ECS_SECURITY_GROUPS` | ECS task security group ID | `sg-abc123` |

### GitHub OIDC Setup

Create an IAM OIDC provider and role so GitHub Actions can authenticate without long-lived keys:

```bash
# 1. Create OIDC provider (one-time)
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1

# 2. Create the deploy role with a trust policy scoped to your repo
# (see AWS docs for the full trust policy JSON)
```

## Estimated Costs (us-east-1)

| Resource | Spec | ~Monthly |
|----------|------|----------|
| ECS Fargate (API 2x) | 0.5 vCPU, 1GB | ~$30 |
| ECS Fargate (Web 2x) | 0.25 vCPU, 0.5GB | ~$15 |
| RDS PostgreSQL | db.t4g.micro | ~$13 |
| ElastiCache Redis | cache.t4g.micro | ~$12 |
| NAT Gateway | Single AZ | ~$32 |
| ALB | 1 LB | ~$16 |
| **Total** | | **~$118/mo** |

Scale up by adjusting `terraform.tfvars`. The defaults are production-suitable for low to moderate traffic.
