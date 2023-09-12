variable "name" {
  description = "Name prefix to add to all resources"
  type        = string
  default     = "hava-integration"
}

variable "hava_endpoint" {
  description = "URL of Hava API. Only use for self-hosted, ignore if running against SaaS"
  type        = string
  default     = null
}

variable "hava_car_account" {
  description = "AWS Account ID to use for the Cross Account Role (CAR), this needs to match the ID of the account which has the CAR role defined. Only use for self-hosted, ignore if running against SaaS"
  type        = string
  default     = null
}

variable "hava_blocklist_account_ids" {
  description = "Comma delimited list of AWS account IDs to ignore"
  type        = string
  default     = ""
}

variable "hava_blocklist_ou_ids" {
  description = "Comma delimited list of AWS Org Unit IDs to ignore"
  type        = string
  default     = ""
}

variable "hava_external_id" {
  description = "External ID used to secure the ReadOnly role Hava use to connect to your AWS accounts"
  type        = string
}

variable "hava_token_path" {
  description = "Path to the HAVA API token in System Manager Parameter store. e.g. /hava-integration/token"
  type        = string
}

variable "tags" {
  description = "Map of Tags to apply to all resources"
  type        = map(string)
  default     = {}
}

variable "schedule_expression" {
  description = "CloudWatch Event Rule Schedule Expression that defines when to trigger the Lambda Function"
  type        = string
  default     = "rate(24 hours)"
}
