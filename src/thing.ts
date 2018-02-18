import * as AWS from 'aws-sdk'

import {tableNameFromARN} from "./util/ARNParser";

import * as Promise from 'bluebird'

import * as rp from 'request-promise-any'

import {DocumentClient} from "aws-sdk/lib/dynamodb/document_client";
import {GenericMap, UserProfile} from "./customer";
import Iot = require("aws-sdk/clients/iot");
import {AttachPolicyRequest, AttachThingPrincipalRequest, CreateThingRequest} from "aws-sdk/clients/iot";
import QueryOutput = DocumentClient.QueryOutput;

let config = require('./config/stack.json') as GenericMap

AWS.config.setPromisesDependency(Promise);
AWS.config.update({
    region: config.Region,
})

export interface ThingRequest {
    user: UserProfile
    thingType: string
    thingId: string
}

export interface ThingDescription {
    certificateId: string
    certificateArn: string
    thingId: string
    thingArn: string
    thingName: string
    thingType: string
}

export interface ThingSpec {
    endpoint: string
    certificateId: string
    certificateArn: string
    certificatePem: string
    publicKey: string
    privateKey: string
    thingId: string
    thingArn: string
    thingName: string
    thingType: string
    thingPolicy: string
    rootCertificates: { [key: string]: string }
}

export const FULL_TO_SHORT = /^[A-Z0-9]+_(.*)/

export class ThingService {
    private thingsTable: string

    private client: DocumentClient;

    private iot: Iot;

    private thingTypesTable: string;

    constructor(c: GenericMap) {
        this.thingsTable = tableNameFromARN(c.ThingsTable)
        this.thingTypesTable = tableNameFromARN(c.ThingTypesTable)
        this.iot = new AWS.Iot()
        this.client = new AWS.DynamoDB.DocumentClient()
    }

    downloadCertificates(): Promise<{ [key: string]: string }> {
        const resultCertificates: { [key: string]: string } = {}

        resultCertificates['https://www.symantec.com/content/en/us/enterprise/verisign/roots/VeriSign-Class%203-Public-Primary-Certification-Authority-G5.pem'] = "-----BEGIN CERTIFICATE-----\n" +
            "MIIE0zCCA7ugAwIBAgIQGNrRniZ96LtKIVjNzGs7SjANBgkqhkiG9w0BAQUFADCB\n" +
            "yjELMAkGA1UEBhMCVVMxFzAVBgNVBAoTDlZlcmlTaWduLCBJbmMuMR8wHQYDVQQL\n" +
            "ExZWZXJpU2lnbiBUcnVzdCBOZXR3b3JrMTowOAYDVQQLEzEoYykgMjAwNiBWZXJp\n" +
            "U2lnbiwgSW5jLiAtIEZvciBhdXRob3JpemVkIHVzZSBvbmx5MUUwQwYDVQQDEzxW\n" +
            "ZXJpU2lnbiBDbGFzcyAzIFB1YmxpYyBQcmltYXJ5IENlcnRpZmljYXRpb24gQXV0\n" +
            "aG9yaXR5IC0gRzUwHhcNMDYxMTA4MDAwMDAwWhcNMzYwNzE2MjM1OTU5WjCByjEL\n" +
            "MAkGA1UEBhMCVVMxFzAVBgNVBAoTDlZlcmlTaWduLCBJbmMuMR8wHQYDVQQLExZW\n" +
            "ZXJpU2lnbiBUcnVzdCBOZXR3b3JrMTowOAYDVQQLEzEoYykgMjAwNiBWZXJpU2ln\n" +
            "biwgSW5jLiAtIEZvciBhdXRob3JpemVkIHVzZSBvbmx5MUUwQwYDVQQDEzxWZXJp\n" +
            "U2lnbiBDbGFzcyAzIFB1YmxpYyBQcmltYXJ5IENlcnRpZmljYXRpb24gQXV0aG9y\n" +
            "aXR5IC0gRzUwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCvJAgIKXo1\n" +
            "nmAMqudLO07cfLw8RRy7K+D+KQL5VwijZIUVJ/XxrcgxiV0i6CqqpkKzj/i5Vbex\n" +
            "t0uz/o9+B1fs70PbZmIVYc9gDaTY3vjgw2IIPVQT60nKWVSFJuUrjxuf6/WhkcIz\n" +
            "SdhDY2pSS9KP6HBRTdGJaXvHcPaz3BJ023tdS1bTlr8Vd6Gw9KIl8q8ckmcY5fQG\n" +
            "BO+QueQA5N06tRn/Arr0PO7gi+s3i+z016zy9vA9r911kTMZHRxAy3QkGSGT2RT+\n" +
            "rCpSx4/VBEnkjWNHiDxpg8v+R70rfk/Fla4OndTRQ8Bnc+MUCH7lP59zuDMKz10/\n" +
            "NIeWiu5T6CUVAgMBAAGjgbIwga8wDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8E\n" +
            "BAMCAQYwbQYIKwYBBQUHAQwEYTBfoV2gWzBZMFcwVRYJaW1hZ2UvZ2lmMCEwHzAH\n" +
            "BgUrDgMCGgQUj+XTGoasjY5rw8+AatRIGCx7GS4wJRYjaHR0cDovL2xvZ28udmVy\n" +
            "aXNpZ24uY29tL3ZzbG9nby5naWYwHQYDVR0OBBYEFH/TZafC3ey78DAJ80M5+gKv\n" +
            "MzEzMA0GCSqGSIb3DQEBBQUAA4IBAQCTJEowX2LP2BqYLz3q3JktvXf2pXkiOOzE\n" +
            "p6B4Eq1iDkVwZMXnl2YtmAl+X6/WzChl8gGqCBpH3vn5fJJaCGkgDdk+bW48DW7Y\n" +
            "5gaRQBi5+MHt39tBquCWIMnNZBU4gcmU7qKEKQsTb47bDN0lAtukixlE0kF6BWlK\n" +
            "WE9gyn6CagsCqiUXObXbf+eEZSqVir2G3l6BFoMtEMze/aiCKm0oHw0LxOXnGiYZ\n" +
            "4fQRbxC1lfznQgUy286dUV4otp6F01vvpX1FQHKOtw5rDgb7MzVIcbidJ4vEZV8N\n" +
            "hnacRHr2lVz2XTIIM6RUthg/aFzyQkqFOFSDX9HoLPKsEdao7WNq\n" +
            "-----END CERTIFICATE-----"

        return Promise.resolve(resultCertificates)
    }

    generateNewThing(r: ThingRequest): Promise<ThingSpec> {
        let returnValues: ThingSpec = ({}) as ThingSpec

        // TODO: Think about parallel flows
        // TODO: Validate if this thing name is unique among all users or not - if it is, abort the transaction
        // TODO: Consider AWS Cloud Directory

        let thingName = r.user.short_id + '_' + r.thingId

        return this.downloadCertificates().then((rootCertificates) => {
            returnValues.rootCertificates = rootCertificates
        }).then(() => this.iot.describeEndpoint().promise()).then((endpointResponse) => {
            returnValues.endpoint = endpointResponse.endpointAddress
            // }).then(() => { // TODO: Validate Existing Thing Id
        }).then(() => {
            return this.client.get({
                TableName: this.thingTypesTable,
                Key: {
                    "thing_type": r.thingType,
                }
            }).promise()
        }).then((result) => {
            console.log('thing lookup:', JSON.stringify(result, null, 2))

            returnValues.thingPolicy = result.Item["thing_policy"]
        }).then(() => {
            return this.iot.createKeysAndCertificate({
                setAsActive: true
            }).promise()
        }).then(cert => {
            returnValues.certificateArn = cert.certificateArn
            returnValues.certificateId = cert.certificateId
            returnValues.certificatePem = cert.certificatePem
            returnValues.publicKey = cert.keyPair.PublicKey
            returnValues.privateKey = cert.keyPair.PrivateKey
        }).then(() => {
            const createThingRequest = {
                "thingName": thingName,
                "thingTypeName": r.thingType,
                "attributePayload": {
                    "attributes": {
                        "user_id": r.user.user_id,
                    }
                }
            }

            console.log('createThingRequest:', JSON.stringify(createThingRequest, null, 2))

            return this.iot.createThing(createThingRequest).promise()
        }).then((createThingResponse) => {
            console.log('createThingResponse:', JSON.stringify(createThingResponse, null, 2))

            returnValues.thingArn = createThingResponse.thingArn
            returnValues.thingId = createThingResponse.thingId
            returnValues.thingName = createThingResponse.thingName
        }).then(() => {
            let attachPolicyRequest = {
                policyName: returnValues.thingPolicy,
                target: returnValues.certificateArn,
            } as AttachPolicyRequest;

            return this.iot.attachPolicy(attachPolicyRequest).promise()
        }).then(() => {
            return this.iot.attachThingPrincipal({
                thingName: returnValues.thingName,
                principal: returnValues.certificateArn,
            }).promise()
        }).then(() => {
            return this.client.put({
                TableName: this.thingsTable,
                Item: {
                    'user_id': r.user.user_id,
                    'certificate_id': returnValues.certificateId,
                    'certificate_arn': returnValues.certificateArn,
                    'thing_id': returnValues.thingId,
                    'thing_arn': returnValues.thingArn,
                    'thing_name': returnValues.thingName,
                    'thing_type': returnValues.thingType,
                }
            }).promise()
            //}).then(() => { // TODO: Enumerate ROOT Certificates
        }).then(() => {
            return returnValues
        })
    }

    listThingsByUser(userProfile: UserProfile): Promise<ThingDescription[]> {
        let result: ThingDescription[] = []

        return Promise.resolve(userProfile)
            .then(() => {
                return this.client.query({
                    TableName: this.thingsTable,
                    KeyConditionExpression: "user_id = :user_id",
                    ExpressionAttributeValues: {
                        ':user_id': userProfile.user_id,
                    },
                    Limit: 32,
                }).promise()
            })
            .then((queryResult: QueryOutput) => {
                for (let i of queryResult.Items) {
                    let newResult = {
                        certificateId: i["certificate_id"],
                        certificateArn: i["certificate_arn"],
                        thingId: i["thing_id"],
                        thingArn: i["thing_arn"],
                        thingName: i["thing_name"],
                        thingType: i["thing_type"],
                    } as ThingDescription

                    newResult.thingName = FULL_TO_SHORT.exec(newResult.thingName)[1]

                    result.push(newResult)
                }

                return Promise.resolve(result)
            })
    }

    describeDevice(userProfile: UserProfile, deviceId: string): Promise<ThingDescription> {
        let result: ThingDescription = null

        const thingId = deviceId

        return Promise.resolve()
            .then(() => this.client.query({
                    TableName: this.thingsTable,
                    KeyConditionExpression: "user_id = :user_id and thing_id = :thing_id",
                    Limit: 1,
                    ExpressionAttributeValues: {
                        ':user_id': userProfile.user_id,
                        ':thing_id': thingId,
                    }
                }).promise()
            ).then((queryResult: QueryOutput) => {
                const i = queryResult.Items[0]

                result = {
                    certificateId: i["certificate_id"],
                    certificateArn: i["certificate_arn"],
                    thingId: i["thing_id"],
                    thingArn: i["thing_arn"],
                    thingName: i["thing_name"],
                    thingType: i["thing_type"],
                } as ThingDescription

                result.thingName = FULL_TO_SHORT.exec(result.thingName)[1]

                return Promise.resolve(result)
            })
    }
}

export const thingService = new ThingService(config)