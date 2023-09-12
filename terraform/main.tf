locals {
  name       = "HavaIntegration"
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.name

  hava_token_path = "" // path to the HAVA API token in System Manager Parameter store. e.g. /hava-integration/token

  env_variables = {
    HAVA_BLACKLIST_ACCOUNT_IDS = "" // comma delimited list of aws account ids to ignore
    HAVA_BLACKLIST_OU_IDS      = "" // comma delimited list of aws org units ids to ignore
    HAVA_EXTERNAL_ID           = "" // external id used to secure the ReadOnly role Hava use to connect to your AWS accounts
    HAVA_TOKEN_PATH            = local.hava_token_path

    // only use for self-hosted, ignore if running against SaaS
    // HAVA_ENDPOINT = "https://api.hava.io" // url of API, change this
    // HAVA_CAR_ACCOUNT = "" // id of AWS account to use as the CAR account, needs to match the Id of the account which has the CAR role defined
  }

  tags = {
    environment = "production"
  }
}

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }
}

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${local.name}-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json

  tags = local.tags
}

data "aws_iam_policy_document" "lambda_access" {
  version = "2012-10-17"
  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup"
    ]
    resources = ["arn:aws:logs:${local.region}:${local.account_id}:*"]
  }
  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = [
      "arn:aws:logs:${local.region}:${local.account_id}:log-group:/aws/lambda/${local.name}:*"
    ]
  }

  statement {
    effect = "Allow"
    actions = [
      "organizations:List*"
    ]
    resources = ["*"]
  }

  statement {
    effect = "Allow"
    actions = [
      "ssm:GetParameter"
    ]
    resources = ["arn:aws:ssm:${local.region}:${local.account_id}:parameter${local.hava_token_path}"]
  }

  statement {
    effect = "Allow"
    actions = [
      "sts:AssumeRole"
    ]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "lambda" {
  name   = "${local.name}-lambda"
  policy = data.aws_iam_policy_document.lambda_access.json

  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "lambda" {
  role       = aws_iam_role.lambda.name
  policy_arn = aws_iam_policy.lambda.arn
}

data "archive_file" "lambda" {
  type        = "zip"
  output_path = "./temp/function.zip"

  source {
    content  = file("../lambda/index.mjs")
    filename = "index.mjs"
  }
}

resource "aws_lambda_function" "this" {
  function_name    = local.name
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs18.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = "./temp/function.zip"
  source_code_hash = data.archive_file.lambda.output_base64sha256
  timeout          = 60

  environment {
    variables = local.env_variables
  }

  tags = local.tags

  depends_on = [data.archive_file.lambda]
}

resource "aws_cloudwatch_event_rule" "schedule" {
  name = "${local.name}-schedule"
  description = "Schedule for ${local.name} lambda function"
  schedule_expression = "rate(24 hours)"
}

resource "aws_cloudwatch_event_target" "schedule" {
  rule = aws_cloudwatch_event_rule.schedule.name
  target_id = "${aws_lambda_function.this.function_name}-schedule"
  arn = aws_lambda_function.this.arn
}

resource "aws_lambda_permission" "schedule_lambda" {
  action = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this.function_name
  principal = "events.amazonaws.com"
  source_arn = aws_cloudwatch_event_rule.schedule.arn
}

resource "aws_cloudwatch_event_rule" "create_account" {
  name = "${local.name}-create-account"
  description = "Run Hava Integration when new AWS accounts are created"
  event_pattern = jsonencode({
    source = ["aws.controltower"]
    detail-type = ["AWS Service Event via CloudTrail"]
    detail = {
      eventName = ["CreateManagedAccount", "UpdateManagedAccount"]
    }
  })
}

resource "aws_cloudwatch_event_target" "create_account" {
  rule = aws_cloudwatch_event_rule.create_account.name
  target_id = "${aws_lambda_function.this.function_name}-create_account"
  arn = aws_lambda_function.this.arn
}

resource "aws_lambda_permission" "create_account_lambda" {
  action = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this.function_name
  principal = "events.amazonaws.com"
  source_arn = aws_cloudwatch_event_rule.create_account.arn
}