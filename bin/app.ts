#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { BookingWorkflowStack } from "../lib/booking-workflow-stack";

const app = new cdk.App();

cdk.Tags.of(app).add("Project", "DurableFunctionTest");

new BookingWorkflowStack(app, "BookingWorkflowStack");
