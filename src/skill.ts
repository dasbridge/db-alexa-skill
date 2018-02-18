'use strict'

import * as uuidv4 from 'uuid/v4'

require('any-promise/register/bluebird')

require('source-map-support').install();

import {customerService, UserProfile} from "./customer";
import {deviceService} from "./devices";

export const main = (request, context, cb) => {
    console.log('request:', JSON.stringify(request, null, 2))

    const requestType = request.directive.header.namespace
    const requestName = request.directive.header.name
    const requestUuid = uuidv4()

    const errorHandler = (e: Error) => {
        console.log("Oops: ", JSON.stringify(e, null, 2))

        cb(null, {
            "event": {
                "header": {
                    "messageId": requestUuid,
                    "namespace": requestType,
                    "name": "ErrorResponse",
                    "payloadVersion": "3"
                },
                "payload": {
                    "type": "ACCEPT_GRANT_FAILED",
                    "message": `${e.name}: ${e.message}`
                }
            }
        })
    }

    if ("Alexa.Authorization" === requestType) {
        const tokenType = request.directive.payload.scope.type
        const bearerToken = request.directive.payload.grantee.token

        console.log('Must add bearerToken:', bearerToken)

        customerService.validateCustomer(tokenType, bearerToken)
            .then((userProfile: UserProfile) => {
                console.log('New UserProfile:', JSON.stringify(userProfile, null, 2))

                cb(null, {
                    event: {
                        header: {
                            messageId: requestUuid,
                            namespace: requestType,
                            name: "AcceptGrant.Response",
                            payloadVersion: "3"
                        },
                        payload: {}
                    }
                })
            })
            .catch(errorHandler)

        return
    } else if ("Alexa.Discovery" == requestType) {
        const tokenType = request.directive.payload.scope.type
        const bearerToken = request.directive.payload.scope.token

        console.log('Must add bearerToken:', bearerToken)

        let up: UserProfile

        customerService.validateCustomer(tokenType, bearerToken)
            .then((userProfile: UserProfile) => {
                up = userProfile

                return deviceService.describeThingShadowsByUser(userProfile)
            }).then((thingShadows) => {
            return deviceService.discoverByShadows(thingShadows)
        }).then((deviceMeta) => {
            cb(null, {
                event: {
                    header: {
                        namespace: "Alexa.Discovery",
                        name: "Discover.Response",
                        payloadVersion: 3,
                        messageId: requestUuid,
                    },
                    payload: {
                        endpoints: deviceMeta
                    }
                }
            })
        }).catch(errorHandler)

        return
    } else if ("Alexa" == requestType && "ReportState" == requestName) {
        const tokenType = request.directive.endpoint.scope.type
        const bearerToken = request.directive.endpoint.scope.token

        const endpointId = request.directive.endpoint.endpointId

        let userProfile: UserProfile

        customerService.validateCustomer(tokenType, bearerToken)
            .then((up: UserProfile) => {
                userProfile = up
            }).then(() => {
            return deviceService.reportState(request, userProfile, endpointId)
        }).then((answer) => {
            console.log('answer:', JSON.stringify(answer, null, 2))
            cb(null, answer)
        }).catch(errorHandler)
    } else {
        cb(new Error("Not Implemented"), null)
    }
}