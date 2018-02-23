#!/usr/bin/env node
'use strict'

import {ApiKey} from "aws-sdk/clients/apigateway";

require('source-map-support').install();
require('any-promise/register/bluebird')

import AWS = require("aws-sdk")

AWS.config.update({
    region: 'us-east-1'
})

AWS.config.setPromisesDependency(require('bluebird'))

if (3 !== process.argv.length) {
    console.log("Usage: generateApiKey EMAIL")
}

import path = require('path')
import {tableNameFromARN} from "../util/ARNParser"

const stackDataConfig = require(path.join(process.cwd(), "src/config/stack.json"))
const stackConfig = require(path.join(process.cwd(), "stack.json"))

const email = process.argv[2]

console.log('email:', email)

const customerKeysTable = tableNameFromARN(stackDataConfig['CustomerKeysTable'] as string)
const customerTable = tableNameFromARN(stackDataConfig['CustomerTable'] as string)

console.log('customerKeysTable:', customerKeysTable)
console.log('customerTable:', customerTable)

let restApiId, restApiStage: string

{
    const restEndpoint = stackConfig['ServiceEndpoint'] as string

    console.log('ServiceEndpoint:', restEndpoint)

    const restApiIdMatches = /^https\:\/\/([^.]+)\.execute\-api.[^\/]+\/(.*)/.exec(restEndpoint)

    restApiId = restApiIdMatches[1]
    restApiStage = restApiIdMatches[2]

    console.log('restApiId:', restApiId)
    console.log('restApiStage:', restApiStage)
}

{
    const documentClient = new AWS.DynamoDB.DocumentClient()

    let item

    documentClient.query({
        TableName: customerTable,
        KeyConditionExpression: 'email = :email',
        ExpressionAttributeValues: {
            ':email': email
        },
        IndexName: 'email-index'
    }).promise().then((result) => {
        item = result.Items[0];

        console.log('item:', JSON.stringify(item, null, 2))
    }).then(() => {
        const apiGatewayClient = new AWS.APIGateway()

        return apiGatewayClient.createApiKey({
            enabled: true,
            name: "key-" + email,
            stageKeys: [{restApiId: restApiId, stageName: restApiStage}]
        }).promise()
    }).then((apiKey: ApiKey) => {
        console.log('apiKey: ', JSON.stringify(apiKey, null, 2))

        return documentClient.update({
            TableName: customerKeysTable,
            Key: {
                short_id: item['short_id'],
                api_key: apiKey.id
            },
            AttributeUpdates: {
                created: {
                    Value: Math.trunc(new Date().getTime() / 1000),
                    Action: 'PUT'
                }
            }
        }).promise()
    })
}
