import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as cdk from 'aws-cdk-lib/core'
import { CfnOutput, Fn, Duration, Stack, Token } from 'aws-cdk-lib/core'
import { DockerImageCode } from 'aws-cdk-lib/aws-lambda'
import { Port, SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2'
import { RetentionDays } from 'aws-cdk-lib/aws-logs'
import { DatabaseCluster } from 'aws-cdk-lib/aws-rds'
import { Secret } from 'aws-cdk-lib/aws-secretsmanager'

import { CdkResourceInitializer } from './resource-initializer'


export class AwsDatabaseInitStack extends Stack {
  constructor (scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // environment specific variables
    const envPrefix = 'dev';
    const dbUsername = 'dbUsername';
    const dbCredsSecretName = 'dbSecretName';

    // get the exported values from our vpc stack 
    // these values were exported when we deployed our vpc stack like:
    // new CfnOutput(this, 'DB Cluster Identifier', { exportName: `${envPrefix}-db-cluster-id`, value: cluster.clusterIdentifier });
    const dbClusterId = Fn.importValue(`${envPrefix}-db-cluster-id`);
    const dbClusterHostname = Fn.importValue(`${envPrefix}-db-cluster-endpoint-hostname`);
    const dbClusterPort = Fn.importValue(`${envPrefix}-db-cluster-endpoint-port`);
    const dbClusterSecurityGroupID = Fn.importValue(`${envPrefix}-db-cluster-securitygroup-id`);

    // look up existing VPC
    const vpcTagName = `${envPrefix}-VpcStack/${envPrefix}-Vpc`;
    const vpc = Vpc.fromLookup(this, `${envPrefix}-Vpc`, { 
      // All arguments to Vpc.fromLookup() must be concrete (no Tokens)
      tags: {'Name': vpcTagName}
    });

    // look up existing DatabaseCluster
    const dbCluster = DatabaseCluster.fromDatabaseClusterAttributes(this, `${envPrefix}-DatabaseCluster`, {
      clusterIdentifier: dbClusterId,
    });

    // look up existing SecurityGroup for the RDS Cluster
    const dbClusterSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(this, 'rdsSG', dbClusterSecurityGroupID, {
      mutable: true
    });

    // Create security group for initializer function
    const initFunctionSecurityGroup = new ec2.SecurityGroup(this, `${envPrefix}-DBInitFuncSecurityGroup`, {
      vpc: vpc,
      allowAllOutbound: true,
      description: 'Security group for DB Init Function',
      securityGroupName: 'DBInitFunctionSecurityGroup'
      });

    // create the CdkResourceInitializer
    const initializer = new CdkResourceInitializer(this, `${envPrefix}-RdsInit`, {
      config: {
        credsSecretName: dbCredsSecretName,
        username: dbUsername,
        hostname: dbClusterHostname,
        port: dbClusterPort
      },
      fnLogRetention: RetentionDays.FIVE_MONTHS,
      fnCode: DockerImageCode.fromImageAsset(`rds-init-fn-code`, {}),
      fnTimeout: Duration.minutes(5),
      fnSecurityGroups: [initFunctionSecurityGroup],
      vpc: vpc,
      subnetsSelection: vpc.selectSubnets({
        subnetType: SubnetType.PRIVATE_WITH_EGRESS
      })
    })
    // CdkResourceInitializer depends on DatabaseCluster
    initializer.customResource.node.addDependency(dbCluster)

    // allow the initializer function to connect to the RDS instance
    dbClusterSecurityGroup.connections.allowFrom(initFunctionSecurityGroup, Port.tcp(3306), 'Allow access from Lambda function')

    // allow initializer function to read RDS instance creds secret
    const dbCreds = Secret.fromSecretNameV2(this, 'MysqlRdsCredentials', dbCredsSecretName);
    dbCreds.grantRead(initializer.function)

    /* eslint no-new: 0 */
    new CfnOutput(this, 'RdsInitFnResponse', {
      value: Token.asString(initializer.response)
    })
  }
}
