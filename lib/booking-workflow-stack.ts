import * as cdk from "aws-cdk-lib";
import { LambdaIntegration, RestApi } from "aws-cdk-lib/aws-apigateway";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import * as path from "path";

export class BookingWorkflowStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const senderEmail = new cdk.CfnParameter(this, "SenderEmail", {
      type: "String",
      description: "Indirizzo mittente verificato in Amazon SES.",
    });

    const durableExecutionTimeoutSeconds = new cdk.CfnParameter(this, "DurableExecutionTimeoutSeconds", {
      type: "Number",
      default: 900,
      minValue: 60,
      description: "Timeout complessivo della Durable Function.",
    });

    const commonBundling = {
      minify: false,
      sourceMap: true,
      target: "es2022",
    };

    const workflowFunction = new NodejsFunction(this, "BookingWorkflowFunction", {
      functionName: "DurableFunctionTest_booking_workflow",
      runtime: Runtime.NODEJS_24_X,
      entry: path.join(__dirname, "../src/booking-workflow.ts"),
      handler: "handler",
      timeout: cdk.Duration.seconds(30),
      environment: {
        SENDER_EMAIL: senderEmail.valueAsString,
      },
      bundling: commonBundling,
    });

    const cfnWorkflowFunction = workflowFunction.node.defaultChild as cdk.aws_lambda.CfnFunction;
    cfnWorkflowFunction.addPropertyOverride("DurableConfig", {
      ExecutionTimeout: durableExecutionTimeoutSeconds.valueAsNumber,
      RetentionPeriodInDays: 7,
    });

    workflowFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["ses:SendEmail"],
        resources: ["*"],
      }),
    );
    workflowFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "lambda:CheckpointDurableExecution",
          "lambda:GetDurableExecutionState",
        ],
        resources: ["*"],
      }),
    );

    const workflowVersion = workflowFunction.currentVersion;
    const workflowAlias = new cdk.aws_lambda.Alias(this, "BookingWorkflowAlias", {
      aliasName: "DurableFunctionTest_live",
      version: workflowVersion,
    });

    const startFunction = new NodejsFunction(this, "StartBookingFunction", {
      functionName: "DurableFunctionTest_start_booking",
      runtime: Runtime.NODEJS_24_X,
      entry: path.join(__dirname, "../src/start-booking.ts"),
      handler: "handler",
      timeout: cdk.Duration.seconds(10),
      environment: {
        BOOKING_WORKFLOW_FUNCTION_ARN: workflowAlias.functionArn,
      },
      bundling: commonBundling,
    });

    workflowAlias.grantInvoke(startFunction);

    const callbackFunction = new NodejsFunction(this, "BookingCallbackFunction", {
      functionName: "DurableFunctionTest_booking_callback",
      runtime: Runtime.NODEJS_24_X,
      entry: path.join(__dirname, "../src/booking-callback.ts"),
      handler: "handler",
      timeout: cdk.Duration.seconds(10),
      bundling: commonBundling,
    });

    callbackFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["lambda:SendDurableExecutionCallbackSuccess"],
        resources: ["*"],
      }),
    );

    const api = new RestApi(this, "BookingApi", {
      restApiName: "DurableFunctionTest_booking_api",
      deployOptions: {
        stageName: "DurableFunctionTest_prod",
      },
    });

    const booking = api.root.addResource("booking");
    booking.addMethod("POST", new LambdaIntegration(startFunction));

    const callback = booking.addResource("callback");
    callback.addMethod("POST", new LambdaIntegration(callbackFunction));

    new cdk.CfnOutput(this, "BookingApiUrl", {
      value: api.url,
    });
  }
}
