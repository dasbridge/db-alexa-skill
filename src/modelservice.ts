import * as AWS from 'aws-sdk'

import {tableNameFromARN} from "./util/ARNParser";

import * as Promise from 'bluebird'

import * as rp from 'request-promise-any'

import {DocumentClient} from "aws-sdk/lib/dynamodb/document_client";
import {GenericMap} from "./customer";
import Iot = require("aws-sdk/clients/iot");
import {AttachPolicyRequest, AttachThingPrincipalRequest, CreateThingRequest} from "aws-sdk/clients/iot";

let config = require('./config/stack.json') as GenericMap

AWS.config.setPromisesDependency(Promise);
AWS.config.update({
    region: config.Region,
})

export interface Model {
    feature: string

    descriptor: object
}

export class ModelService {
    private thingsTable: string

    private client: DocumentClient;

    private thingTypesTable: string;

    constructor(c: GenericMap) {
        this.thingsTable = tableNameFromARN(c.ThingsTable)
        this.thingTypesTable = tableNameFromARN(c.ThingTypesTable)
        this.client = new AWS.DynamoDB.DocumentClient()
    }

    getModelsFor(userId, thingId: string): Promise<Model[]> {
        let result: Model[] = []

        return Promise.resolve().then(() => {
            this.client.query({
                TableName: this.thingsTable,
                KeyConditionExpression: "user_id = :user_id AND thing_id = :thing_id",
                ExpressionAttributeValues: {
                    ":user_id": {"S": userId},
                    ":thing_id": {"S": thingId},
                },
                Limit: 1,
            }).promise()
        }).then((result) => {

        }).then(() => {
            return result
        })
    }

}