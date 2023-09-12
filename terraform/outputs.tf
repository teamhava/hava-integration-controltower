output "lambda_function_arn" {
  description = "ARN of the Lambda Function"
  value       = aws_lambda_function.this.arn
}

output "lambda_iam_role_arn" {
  description = "ARN of the Lambda Function IAM Role"
  value       = aws_iam_role.lambda.arn
}
