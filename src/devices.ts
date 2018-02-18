import * as AWS from 'aws-sdk'

import {tableNameFromARN} from "./util/ARNParser";

import * as Promise from 'bluebird'

import * as rp from 'request-promise-any'

import {DocumentClient} from "aws-sdk/lib/dynamodb/document_client";
import {GenericMap, UserProfile} from "./customer";
import IotData = require("aws-sdk/clients/iotdata");
import Iot = require("aws-sdk/clients/iot");
import {ThingMetadata, ThingMetadataMap} from "./util/thingModel";
import QueryInput = DocumentClient.QueryInput;

import * as jmespath from 'jmespath'
import moment = require("moment");
import {FULL_TO_SHORT} from "./thing";

let config = require('./config/stack.json') as GenericMap

AWS.config.setPromisesDependency(Promise);

AWS.config.update({
    region: config.Region,
})

interface AlexaCapability {
    type: string
    interface: string
    version: string
    properties: any
}

interface AlexaDiscoveryEndpoint {
    endpointId: string
    friendlyName: string
    description: string
    manufacturerName: string
    displayCategories?: string[]
    cookie?: { [key: string]: string }
    capabilities: AlexaCapability[]
}

export class DeviceService {
    private thingsTable: string;

    private client: DocumentClient;

    private iot: Iot;

    constructor(c: GenericMap) {
        this.thingsTable = tableNameFromARN(c.ThingsTable)
        this.client = new AWS.DynamoDB.DocumentClient()
        this.iot = new AWS.Iot()
    }

    describeThingShadowsByUser(up: UserProfile, thingName?: string): Promise<ThingMetadataMap> {
        let endpointAddress: Iot.EndpointAddress;

        let iotData: AWS.IotData

        return Promise.resolve().then(() => {
            return this.iot.describeEndpoint().promise()
        }).then((describeEndpointResponse) => {
            endpointAddress = describeEndpointResponse.endpointAddress;

            iotData = new AWS.IotData({
                endpoint: endpointAddress
            })

            return Promise.resolve(up)
                .then((up) => {
                    let queryParams: QueryInput = {
                        TableName: this.thingsTable,
                        KeyConditionExpression: "user_id = :user_id",
                        ExpressionAttributeValues: {
                            ":user_id": up.user_id,
                        }
                    };

                    if (thingName) {
                        queryParams.IndexName = "user_id-thing_name-index"
                        queryParams.KeyConditionExpression = 'user_id = :user_id and thing_name = :thing_name'
                        queryParams.ExpressionAttributeValues[':thing_name'] = thingName
                    }

                    return this.client.query(queryParams).promise()
                })
        }).then((deviceItems) => {
            const deviceShadowPromises = deviceItems.Items.map((t) => {
                const thingName = t['thing_name']
                return Promise.resolve(thingName).then((thingName) => {
                    return iotData.getThingShadow({
                        thingName: thingName
                    }).promise().then((getThingShadowResponse) => {
                        const payload = getThingShadowResponse.payload

                        const payloadType = (typeof payload)

                        let payloadObj: ThingMetadata

                        if (payload instanceof Buffer) {
                            payloadObj = JSON.parse((payload as Buffer).toString('utf8')) as ThingMetadata
                        } else if ("string" === payloadType) {
                            payloadObj = JSON.parse(payload as string) as ThingMetadata
                        } else {
                            return Promise.reject(new Error(`Unexpected type '${payloadType}' for getThingShadowResponse payload (thingName=${thingName})`))
                        }

                        console.log(JSON.stringify(payloadObj, null, 2))

                        return Promise.resolve({thingName: thingName, metadata: payloadObj})
                    })
                })
            })

            return Promise.all(deviceShadowPromises)
        }).then((deviceResults) => {
            const result: { [key: string]: ThingMetadata } = {}

            deviceResults.forEach((x) => {
                result[x.thingName] = x.metadata
            })

            return result
        })
    }

    discoverByShadows(thingShadows: ThingMetadataMap): Promise<AlexaDiscoveryEndpoint[]> {
        const result: AlexaDiscoveryEndpoint[] = []

        for (const endpointId of Object.keys(thingShadows)) {
            const thingMeta = thingShadows[endpointId]

            const newEndpoint = this.discoverEndpoint(endpointId, thingMeta)

            if (newEndpoint && 0 !== newEndpoint.capabilities.length) {
                result.push(newEndpoint)
            }
        }

        return Promise.resolve(result)
    }

    discoverEndpoint(endpointId: string, thingMeta: ThingMetadata): AlexaDiscoveryEndpoint {
        //console.log('arguments:', JSON.stringify(arguments, null, 2))
        const friendlyNameToUSe = FULL_TO_SHORT.exec(endpointId)[1]

        let result: AlexaDiscoveryEndpoint = {
            endpointId: endpointId,
            friendlyName: friendlyNameToUSe, // TODO
            description: `${friendlyNameToUSe} Device`, // TODO
            manufacturerName: "the dasbridge project",
            capabilities: [],
            displayCategories: []
        }

        let hasTemperatureTimestamp = jmespath.search(thingMeta, 'metadata.reported."Alexa.TemperatureSensor"."3".temp.timestamp')

        if (hasTemperatureTimestamp && this.isLessThan30Minutes(hasTemperatureTimestamp)) {
            result.capabilities.push({
                type: "AlexaInterface",
                interface: "Alexa.TemperatureSensor",
                version: "3",
                properties: {
                    supported: [
                        {name: "temperature"}
                    ]
                },
                proactivelyReported: false,
                retrievable: true
            } as AlexaCapability)

            result.displayCategories.push('TEMPERATURE_SENSOR')
        }

        // metadata.reported."Alexa.TemperatureSensor"."3".temp.timestamp

        return result
    }

    private isLessThan30Minutes(ts: any): boolean {
        const typeOf = (typeof ts)

        if ("number" !== typeOf) {
            return false
        }

        const tsAsNumber: number = (ts as number)

        const minimumTime = (Math.trunc(new Date().getTime() / 1000) - 1800)

        return tsAsNumber >= minimumTime
    }

    reportState(request: any, userProfile: UserProfile, endpointId: string) {
        return this.describeThingShadowsByUser(userProfile, endpointId).then((report) => {
            const thingMeta = report[endpointId]

            const answer = {
                event: {
                    header: request.directive.header,
                    endpoint: {
                        endpointId: endpointId,
                    },
                    payload: {},
                },
                context: {
                    properties: []
                }
            }

            answer.event.header.name = 'StateReport'

            let hasTemperatureTimestamp = jmespath.search(thingMeta, 'metadata.reported."Alexa.TemperatureSensor"."3".temp.timestamp')

            if (hasTemperatureTimestamp && this.isLessThan30Minutes(hasTemperatureTimestamp)) {
                const sampleTime = new Date(hasTemperatureTimestamp * 1000)

                const temperature = jmespath.search(thingMeta, 'state.reported."Alexa.TemperatureSensor"."3".temp')

                const timeOfSample = moment(sampleTime).utc().toISOString()

                answer.context.properties.push({
                    namespace: "Alexa.TemperatureSensor",
                    name: "temperature",
                    value: {
                        value: temperature.toFixed(1),
                        scale: "CELSIUS"
                    },
                    timeOfSample: timeOfSample,
                    uncertaintyInMilliseconds: 1000
                })
            }

            return Promise.resolve(answer)
        })

    }
}

export const deviceService = new DeviceService(config)
