# AWS ControlTower Integration

Integration for AWS Control Tower to automatically synchronize control tower managed aws accounts with Hava.io

It traverses the full Org tree to locate all accounts that are managed by controll tower and configures a read only role in each of the accounts. Then it adds these to Hava.io as data sources to ensure that all AWS accounts can automatically be monitored for change and diagrams automatically generated for all cloud resources deployed.

> Note: This is designed to run from the Organization root account, as it relies on premissions only available for resources running in this account to connect to child accounts and add a ReadOnly role for Hava to use

## Lambda

The lambda is a single, self-contained js file that is responsible for scanning both Hava and the AWS organisation for accounts that are in one but not the other. 

If an account is found in Hava that is no longer existing in AWS, it will automatically be removed from Hava as to not increase the cost of Hava
If an account is found in AWS that is not in Hava, it will be added to hava under the default project. 

More details on the Lambda can be found in the [lambda readme](lambda/README.md)

## Terraform Module

This repository contains a terraform module that can be used to automatically deploy the integration lambda with all the required permissions and support resources. More details on this can be found in the [module readme](terraform/README.md)