import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { Construct } from 'constructs'
import { Duration, Stack } from 'aws-cdk-lib/core'
import { AwsCustomResource, AwsCustomResourcePolicy, AwsSdkCall, PhysicalResourceId } from 'aws-cdk-lib/custom-resources'
import { RetentionDays } from 'aws-cdk-lib/aws-logs'
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam'
import { createHash } from 'crypto'

export interface CdkResourceInitializerProps {
  vpc: ec2.IVpc
  subnetsSelection: ec2.SubnetSelection
  fnSecurityGroups: ec2.ISecurityGroup[]
  fnTimeout: Duration
  fnCode: lambda.DockerImageCode
  fnLogRetention: RetentionDays
  fnMemorySize?: number
  config: any
}

export class CdkResourceInitializer extends Construct {
  public readonly response: string
  public readonly customResource: AwsCustomResource
  public readonly function: lambda.Function

  constructor (scope: Construct, id: string, props: CdkResourceInitializerProps) {
    super(scope, id)

    const stack = Stack.of(this)

    // Create a lambda function where the handler is a docker image with the fnCode passed in
    const dockerImageFunction = new lambda.DockerImageFunction(this, 'ResourceInitializerFn', {
      memorySize: props.fnMemorySize || 128,
      functionName: `${id}-ResInit${stack.stackName}`,
      code: props.fnCode,
      vpcSubnets: props.vpc.selectSubnets(props.subnetsSelection),
      vpc: props.vpc,
      securityGroups: props.fnSecurityGroups,
      timeout: props.fnTimeout,
      logRetention: props.fnLogRetention
    })

    const payload: string = JSON.stringify({
      params: {
        config: props.config
      }
    })

    const payloadHashPrefix = createHash('md5').update(payload).digest('hex').substring(0, 6)

    // create the AwsSdkCall
    const sdkCall: AwsSdkCall = {
      service: 'Lambda',
      action: 'invoke',
      parameters: {
        FunctionName: dockerImageFunction.functionName,
        Payload: payload
      },
      physicalResourceId: PhysicalResourceId.of(`${id}-AwsSdkCall-${dockerImageFunction.currentVersion.version + payloadHashPrefix}`)
    }
    
    // IMPORTANT: the AwsCustomResource construct deploys a singleton AWS Lambda function that is re-used across the same CDK Stack,
    // because it is intended to be re-used, make sure it has permissions to invoke multiple "resource initializer functions" within the same stack and it's timeout is sufficient.
    // @see: https://github.com/aws/aws-cdk/blob/cafe8257b777c2c6f6143553b147873d640c6745/packages/%40aws-cdk/custom-resources/lib/aws-custom-resource/aws-custom-resource.ts#L360
    const customResourceFnRole = new Role(this, 'AwsCustomResourceRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com')
    })
    customResourceFnRole.addToPolicy(
      new PolicyStatement({
        resources: [`arn:aws:lambda:${stack.region}:${stack.account}:function:*-ResInit${stack.stackName}`],
        actions: ['lambda:InvokeFunction']
      })
    )
    this.customResource = new AwsCustomResource(this, 'AwsCustomResource', {
      policy: AwsCustomResourcePolicy.fromSdkCalls({ resources: AwsCustomResourcePolicy.ANY_RESOURCE }),
      onUpdate: sdkCall,
      timeout: Duration.minutes(10),
      role: customResourceFnRole
    })

    this.response = this.customResource.getResponseField('Payload')

    this.function = dockerImageFunction
  }
}
