# Hava Control Tower Integration Terraform Module

This terraform module deploys a lambda that will scan your aws organisation for new accounts and sync any changes to Hava.io. Making sure that Hava is always up to date with the accounts in your AWS organisation.

The synchronization will happen both on a schedule and every time a new account is created in the AWS vending machine. This is achieved by setting up EventBridge Rules that listens for specific events and triggers the Lambda.

By default all accounts that are managed by Control Tower will be added to Hava. If there is a need for some accounts to be separated a blocklist for both Organizational Units and Individual accounts are available to be configured

The Lambda also relies on the Hava API token being stored in the System Manager Parameter store as a secure string. 

> Note: This is designed to run from the Organization root account, as it relies on premissions only available for resources running in this account to connect to child accounts and add a ReadOnly role for Hava to use

## Example Usage

```hcl
module "hava_integration" {
  source = "https://github.com/teamhava/hava-integration-controltower/terraform"

  hava_token_path = "/hava-integration/token"
  hava_external_id = "0934086b5ab9970105378261249aebd9"

}
```

<!-- BEGIN_TF_DOCS -->
## Requirements

| Name | Version |
|------|---------|
| <a name="requirement_terraform"></a> [terraform](#requirement\_terraform) | >= 1.5 |
| <a name="requirement_archive"></a> [archive](#requirement\_archive) | ~> 2.0 |
| <a name="requirement_aws"></a> [aws](#requirement\_aws) | ~> 5.0 |

## Providers

| Name | Version |
|------|---------|
| <a name="provider_archive"></a> [archive](#provider\_archive) | ~> 2.0 |
| <a name="provider_aws"></a> [aws](#provider\_aws) | ~> 5.0 |

## Resources

| Name | Type |
|------|------|
| [aws_cloudwatch_event_rule.create_account](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/cloudwatch_event_rule) | resource |
| [aws_cloudwatch_event_rule.schedule](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/cloudwatch_event_rule) | resource |
| [aws_cloudwatch_event_target.create_account](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/cloudwatch_event_target) | resource |
| [aws_cloudwatch_event_target.schedule](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/cloudwatch_event_target) | resource |
| [aws_iam_policy.lambda](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/iam_policy) | resource |
| [aws_iam_role.lambda](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/iam_role) | resource |
| [aws_iam_role_policy_attachment.lambda](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/iam_role_policy_attachment) | resource |
| [aws_lambda_function.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/lambda_function) | resource |
| [aws_lambda_permission.create_account_lambda](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/lambda_permission) | resource |
| [aws_lambda_permission.schedule_lambda](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/lambda_permission) | resource |
| [archive_file.lambda](https://registry.terraform.io/providers/hashicorp/archive/latest/docs/data-sources/file) | data source |
| [aws_caller_identity.current](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/caller_identity) | data source |
| [aws_iam_policy_document.lambda_access](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/iam_policy_document) | data source |
| [aws_iam_policy_document.lambda_assume_role](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/iam_policy_document) | data source |
| [aws_region.current](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/region) | data source |

## Inputs

| Name | Description | Type | Default | Required |
|------|-------------|------|---------|:--------:|
| <a name="input_hava_blocklist_account_ids"></a> [hava\_blocklist\_account\_ids](#input\_hava\_blocklist\_account\_ids) | Comma delimited list of AWS account IDs to ignore | `string` | `""` | no |
| <a name="input_hava_blocklist_ou_ids"></a> [hava\_blocklist\_ou\_ids](#input\_hava\_blocklist\_ou\_ids) | Comma delimited list of AWS Org Unit IDs to ignore | `string` | `""` | no |
| <a name="input_hava_car_account"></a> [hava\_car\_account](#input\_hava\_car\_account) | AWS Account ID to use for the Cross Account Role (CAR), this needs to match the ID of the account which has the CAR role defined. Only use for self-hosted, ignore if running against SaaS | `string` | `null` | no |
| <a name="input_hava_dry_run"></a> [hava\_dry\_run](#input\_hava\_dry\_run) | Deploys Lambda in DryRun mode, where it will not write to any AWS or Hava endpoints but print out log entries instead | `string` | `"false"` | no |
| <a name="input_hava_endpoint"></a> [hava\_endpoint](#input\_hava\_endpoint) | URL of Hava API. Only use for self-hosted, ignore if running against SaaS | `string` | `null` | no |
| <a name="input_hava_external_id"></a> [hava\_external\_id](#input\_hava\_external\_id) | External ID used to secure the ReadOnly role Hava use to connect to your AWS accounts | `string` | n/a | yes |
| <a name="input_hava_token_path"></a> [hava\_token\_path](#input\_hava\_token\_path) | Path to the HAVA API token in System Manager Parameter store. e.g. /hava-integration/token | `string` | n/a | yes |
| <a name="input_name"></a> [name](#input\_name) | Name prefix to add to all resources | `string` | `"hava-integration"` | no |
| <a name="input_schedule_expression"></a> [schedule\_expression](#input\_schedule\_expression) | CloudWatch Event Rule Schedule Expression that defines when to trigger the Lambda Function | `string` | `"rate(24 hours)"` | no |
| <a name="input_tags"></a> [tags](#input\_tags) | Map of Tags to apply to all resources | `map(string)` | `{}` | no |

## Outputs

| Name | Description |
|------|-------------|
| <a name="output_lambda_function_arn"></a> [lambda\_function\_arn](#output\_lambda\_function\_arn) | ARN of the Lambda Function |
| <a name="output_lambda_iam_role_arn"></a> [lambda\_iam\_role\_arn](#output\_lambda\_iam\_role\_arn) | ARN of the Lambda Function IAM Role |
<!-- END_TF_DOCS -->