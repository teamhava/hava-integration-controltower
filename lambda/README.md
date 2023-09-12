# Hava Control Tower Intergation Lambda

A lambda that scans an AWS organisation for AWS accounts and adds missing accounts to Hava automatically, as well as removes old accounts that are no longer valid from Hava. 

> Note: This is designed to run from the Organization root account, as it relies on premissions only available for resources running in this account to connect to child accounts and add a ReadOnly role for Hava to use

## Deploy

To deploy this lambda, it's recommended to use the [Terraform Module](../terraform/README.md) found in this same repository to ensure that it is configured correctly.

## Logging and Monitoring

The lambda is designed to write logs to a CloudWatch log group and relies on access to being able to create this log group as part of the first run. 

As a general rule, log entries are written as `WARN` message if it's a recoverable issue, and `ERROR` if is unrecoverable, which will also mean the Lambda exeuction will fail with a non-zero exit code.

## Hava API authentication

The lambda relies on a Hava API token to access the API, this is expected to be stored in the Systems Manager Parameter store

Use the `HAVA_TOKEN_PATH` environment variable to configure the path in the parameter store this secure string is located.

## Blocklists

There are two blocklists available to be used, one that allows you to block individual accounts by ID and one that will allows you to block whole OUs and all subsequent accounts and OUs.

These are configured by setting two different environment variables

|Variable|Example|Description|
|-|-|-|
|HAVA_BLOCKLIST_ACCOUNT_IDS|"123456789012,123456789013"|A comma delimited list of AWS Account IDs to be blocked from being added to Hava|
|HAVA_BLOCKLIST_OU_IDS|"ou-ue1b-37u4fiye,ou-u52c-34u1fpyq"|A comma delimeited list of AWS Organisational Unit IDs to be blocked from being added to Hava|

## IAM Role for the Lambda function

The Lambda deployment requires a few permissions to be able to scan the org accounts, also to get the API token from the Parameter store

This is an example policy for the lambda role with the minimal required permissions. Some details will have to be updated to match the configuration of your deployment.

```json
{
    "Statement": [
        {
            "Action": "logs:CreateLogGroup",
            "Effect": "Allow",
            "Resource": "arn:aws:logs:<region>:<account id>:*"
        },
        {
            "Action": [
                "logs:PutLogEvents",
                "logs:CreateLogStream"
            ],
            "Effect": "Allow",
            "Resource": "arn:aws:logs:<region>:<account id>:log-group:/aws/lambda/<lambda function name>:*"
        },
        {
            "Action": "organizations:List*",
            "Effect": "Allow",
            "Resource": "*"
        },
        {
            "Action": "ssm:GetParameter",
            "Effect": "Allow",
            "Resource": "arn:aws:ssm:<region>:<account id>:parameter/<parameter store path>"
        },
        {
            "Action": "sts:AssumeRole",
            "Effect": "Allow",
            "Resource": "*"
        }
    ],
    "Version": "2012-10-17"
}
```

The `sts:AssumeRole` statement is to allow the Lambda to assume the `AWSControlTowerExecution` role in child accounts to set up the required read-only role for Hava to poll information about the account resources.

## Configuration

This is the full list of configuration options for the lambda. All configuration is set through environment variables

|Variable|Required|Default|Description|
|-|-|-|-|
|HAVA_EXTERNAL_ID|Yes||The external ID for yout Hava account. Get this through the UI. It's unique for your Hava account and doesn't change. Example: 0934086b5ab9970105378261249aebd9|
|HAVA_TOKEN_PATH|Yes||The path to the Hava API token in the Systems Manaer Parameter Store. Example: /hava-integration/token|
|HAVA_BLOCKLIST_ACCOUNT_IDS|No|""|A comma delimited list of AWS Account IDs to be blocked from being added to Hava. Example: "123456789012,123456789013"|
|HAVA_BLOCKLIST_OU_IDS|No|""|A comma delimeited list of AWS Organisational Unit IDs to be blocked from being added to Hava. Example: "ou-ue1b-37u4fiye,ou-u52c-34u1fpyq"|
|HAVA_CAR_ACCOUNT|no|"281013829959"|This is used to configure the account used as the base for the CAR role for those that run a self-hosted version of Hava|
|HAVA_ENDPOINT|no|"https://api.hava.io"|This is used to configure the integration to run against a different Hava instance than the SaaS platform for those that run a self-hosted version of Hava|