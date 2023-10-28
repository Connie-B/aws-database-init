## AWS Database Initializer

Looks up an existing VPC and RDS cluster and then runs a SQL script on the database.

Similar to the example here: https://aws.amazon.com/blogs/infrastructure-and-automation/use-aws-cdk-to-initialize-amazon-rds-instances/

This uses the exported attributes from an existing VPC stack to look up the existing VPC and RDS cluster.  And then creates a Lambda function in that VPC that runs a SQL script on the database.
