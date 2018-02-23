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

import uuidv4 = require('uuid/v4')

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

    /**
     * Returns all thing shadows for a given user's device
     *
     * @param {UserProfile} up user
     * @param {string} thingName (optional: thing name)
     * @returns {Bluebird<ThingMetadataMap>} maps of things shadows and their metadatas
     */
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

            // Returns all things on DynamoDB
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
            // For those, build an array of promises to retrieve shadows and their metadata
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
            // Assemble as a map, then return
            const result: { [key: string]: ThingMetadata } = {}

            deviceResults.forEach((x) => {
                result[x.thingName] = x.metadata
            })

            return result
        })
    }

    /**
     * Main Discovery Entrypoint. Lookups an user things and performs metadata building for the discovery endpoint
     * @param {ThingMetadataMap} thingShadows
     * @returns {Bluebird<AlexaDiscoveryEndpoint[]>}
     */
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

    /**
     * This section actually builds the alexa metadata required
     *
     * @param {string} endpointId endpoint id
     * @param {ThingMetadata} thingMeta thing metadata / shadow
     * @returns {AlexaDiscoveryEndpoint}
     */
    discoverEndpoint(endpointId: string, thingMeta: ThingMetadata): AlexaDiscoveryEndpoint {
        //console.log('arguments:', JSON.stringify(arguments, null, 2))
        const friendlyNameToUse = FULL_TO_SHORT.exec(endpointId)[1]

        let result: AlexaDiscoveryEndpoint = {
            endpointId: endpointId,
            friendlyName: friendlyNameToUse, // TODO
            description: `${friendlyNameToUse} Device`, // TODO
            manufacturerName: "the dasbridge project",
            capabilities: [],
            displayCategories: []
        }

        let displayCategories = {}

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

            displayCategories['TEMPERATURE_SENSOR'] = true
        }

        let hasColorController = jmespath.search(thingMeta, 'metadata.reported."Alexa.ColorController"."3".color.hue.timestamp')

        if (hasColorController && this.isLessThan30Minutes(hasColorController)) {
            result.capabilities.push({
                type: "AlexaInterface",
                interface: "Alexa.ColorController",
                version: "3",
                properties: {
                    supported: [{name: "color"}]
                },
                proactivelyReported: true,
                retrievable: true
            } as AlexaCapability)

            result.capabilities.push({
                type: "AlexaInterface",
                interface: "Alexa",
                version: "3"
            } as AlexaCapability)

            displayCategories['LIGHT'] = true
        }

        let hasPowerController = jmespath.search(thingMeta, 'metadata.reported."Alexa.PowerController"."3".powerState.timestamp')

        if (hasPowerController && this.isLessThan30Minutes(hasPowerController)) {
            result.capabilities.push({
                type: "AlexaInterface",
                interface: "Alexa.PowerController",
                version: "3",
                properties: {
                    supported: [{name: "state"}]
                },
                proactivelyReported: true,
                retrievable: true
            } as AlexaCapability)
        }

        for (let k of Object.keys(displayCategories)) {
            result.displayCategories.push(k)
        }

        return result
    }

    /**
     * Helper Method to filter out inactive devices
     * @param ts timestamp (epoch seconds)
     * @returns {boolean} true if less than 30 minutes
     */
    private isLessThan30Minutes(ts: any): boolean {
        const typeOf = (typeof ts)

        if ("number" !== typeOf) {
            return false
        }

        const tsAsNumber: number = (ts as number)

        const minimumTime = (Math.trunc(new Date().getTime() / 1000) - 1800)

        return tsAsNumber >= minimumTime
    }

    /**
     * ReportState Handler
     * @param request alexa request
     * @param {UserProfile} userProfile user
     * @param {string} endpointId emd[pomt od
     * @returns {Bluebird<{event: {header; endpoint: {endpointId: string}; payload: {}}; context: {properties: any[]}}>} reportstate result
     */
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

            let hasColorController = jmespath.search(thingMeta, 'metadata.reported."Alexa.ColorController"."3".color.hue.timestamp')

            if (hasColorController && this.isLessThan30Minutes(hasColorController)) {
                const curColor: { [k: string]: number } = {}

                for (let k of ['hue', 'saturation', 'brightness']) {
                    const colorValue = jmespath.search(thingMeta, `state.reported."Alexa.ColorController'."3".color.${k}`)

                    curColor[k] = colorValue
                }

                const sampleTime = jmespath.search(thingMeta, `metadata.reported."Alexa.ColorController'."3".color.hue.timestamp`)

                const timeOfSample = moment(sampleTime).utc().toISOString()

                answer.context.properties.push({
                    namespace: "Alexa.ColorController",
                    name: "color",
                    value: {
                        hue: curColor['hue'].toFixed(1),
                        saturation: curColor['saturation'].toFixed(4),
                        brightness: curColor['brightness'].toFixed(4)
                    },
                    timeOfSample: timeOfSample,
                    uncertaintyInMilliseconds: 1000
                })
            }

            return Promise.resolve(answer)
        })

    }

    /**
     * SetState Handler
     * @param request alexa request
     * @param {UserProfile} userProfile iser
     * @param {string} endpointId emd[pomt od
     * @param payload setState payload
     * @returns {Bluebird<any>} response
     */
    setState(request: any, userProfile: UserProfile, endpointId: string, payload: any): Promise<any> {
        const requestType = request.directive.header.namespace
        const requestVersion = request.directive.header.payloadVersion

        const answer = {
            event: {
                header: request.directive.header,
                endpoint: {
                    //scope: request.directive.endpoint.scope,
                    endpointId: endpointId,
                    scope: request.directive.endpoint.scope,
                },
                payload: {},
            },
            context: {
                properties: [
                    {
                        namespace: request.directive.header.namespace,
                        name: Object.keys(request.directive.payload)[0],
                        value: payload[Object.keys(payload)[0]],
                        timeOfSample: moment().utc().toISOString(),
                        uncertaintyInMilliseconds: 1000,
                    }
                ]
            }
        }

        //delete(answer.event.header.correlationToken)

        answer.event.header.namespace = 'Alexa'
        answer.event.header.name = 'Response'
        answer.event.header.messageId = uuidv4();

        console.log('setState: request', request, JSON.stringify(payload, null, 2))
        console.log('setState: answer', JSON.stringify(answer, null, 2))

        let endpointAddress: Iot.EndpointAddress;

        let iotData: AWS.IotData

        return Promise.resolve().then(() => {
            return this.iot.describeEndpoint().promise()
        }).then((describeEndpointResponse) => {
            endpointAddress = describeEndpointResponse.endpointAddress;

            iotData = new AWS.IotData({
                endpoint: endpointAddress
            })
        }).then(() => {
            const newPayload = {
                state: {
                    desired: {}
                }
            };

            newPayload.state.desired[requestType] = {}
            newPayload.state.desired[requestType][requestVersion] = payload

            let updateThingShadowRequest = {
                thingName: endpointId,
                payload: JSON.stringify(newPayload, null, 2),
            };
            return iotData.updateThingShadow(updateThingShadowRequest).promise()
        }).then(() => Promise.resolve(answer))
    }

    /**
     * Handler for 'powerController' requests
     * @param request alexa request
     * @param {UserProfile} userProfile iser
     * @param {string} endpointId endpoint id
     * @returns {Bluebird<any>} response
     */
    powerController(request: any, userProfile: UserProfile, endpointId: string): Promise<any> {
        let desiredState = "ON"

        if ("TurnOff" === request.directive.header.name) {
            desiredState = "OFF"
        }

        const answer = {
            event: {
                header: request.directive.header,
                endpoint: {
                    //scope: request.directive.endpoint.scope,
                    endpointId: endpointId,
                    scope: request.directive.endpoint.scope
                },
                payload: {},
            },
            context: {
                properties: [
                    {
                        namespace: request.directive.header.namespace,
                        name: "powerState",
                        value: desiredState,
                        timeOfSample: moment().utc().toISOString(),
                        uncertaintyInMilliseconds: 1000,
                    }
                ]
            }
        }

        //delete(answer.event.header.correlationToken)

        answer.event.header.namespace = 'Alexa'
        answer.event.header.name = 'Response'
        answer.event.header.messageId = uuidv4();

        console.log('setState: request', request)
        console.log('setState: answer', JSON.stringify(answer, null, 2))

        let endpointAddress: Iot.EndpointAddress;

        let iotData: AWS.IotData

        return Promise.resolve().then(() => {
            return this.iot.describeEndpoint().promise()
        }).then((describeEndpointResponse) => {
            endpointAddress = describeEndpointResponse.endpointAddress;

            iotData = new AWS.IotData({
                endpoint: endpointAddress
            })
        }).then(() => {
            let updateThingShadowRequest = {
                thingName: endpointId,
                payload: JSON.stringify({
                    state: {
                        desired: {
                            "Alexa.PowerController": {
                                "3": {
                                    powerState: desiredState
                                }
                            }
                        }
                    }
                }, null, 2),
            };
            return iotData.updateThingShadow(updateThingShadowRequest).promise()
        }).then(() => Promise.resolve(answer))
    }
}

export const deviceService = new DeviceService(config)
