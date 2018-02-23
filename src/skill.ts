'use strict'

import * as uuidv4 from 'uuid/v4'

require('any-promise/register/bluebird')

require('source-map-support').install();

import {customerService, UserProfile} from "./customer";
import {deviceService} from "./devices";

/**
 * Main dasBridge Skill
 * @param request alexa request
 * @param context lambda context
 * @param cb callback
 */
export const main = (request, context, cb) => {
    // Debugging Helper
    console.log('request:', JSON.stringify(request, null, 2))

    const requestType = request.directive.header.namespace
    const requestName = request.directive.header.name
    const requestUuid = uuidv4()

    let namespace: string = null

    // Auth Request?
    if ("Alexa.Authorization" === requestType) {
        const tokenType = request.directive.payload.scope.type
        const bearerToken = request.directive.payload.grantee.token

        /**
         * Custom, scoped error handler
         * @param {Error} e Error
         */
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
    }

    /**
     * Generic ErrorHandler
     * @param {Error} e error
     */
    const errorHandler = (e: Error) => {
        cb(e, JSON.stringify(e, null, 2))

        throw(e);
    }

    /**
     * Discovery Request
     */
    if ("Alexa.Discovery" == requestType) {
        const tokenType = request.directive.payload.scope.type
        const bearerToken = request.directive.payload.scope.token

        console.log('Must add bearerToken:', bearerToken)

        let up: UserProfile

        /**
         * Validate Tokens
         */
        customerService.validateCustomer(tokenType, bearerToken)
            .then((userProfile: UserProfile) => {
                up = userProfile

                return deviceService.describeThingShadowsByUser(userProfile)
            }).then((thingShadows) => {
            console.log('thingShadows:', JSON.stringify(thingShadows, null, 2))

            /**
             * Lookup my devices, shadows, meta and figure out what to answer
             */

            return deviceService.discoverByShadows(thingShadows)
        }).then((deviceMeta) => {
            console.log('deviceMeta: ', JSON.stringify(deviceMeta, null, 2))

            let answer = {
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
            };

            console.log('discovery answer:', JSON.stringify(answer, null, 2))

            // Return

            cb(null, answer)
        }).catch(errorHandler)

        return
    } else if ("Alexa.PowerController" == requestType) {
        const tokenType = request.directive.endpoint.scope.type
        const bearerToken = request.directive.endpoint.scope.token

        const endpointId = request.directive.endpoint.endpointId

        let userProfile: UserProfile

        customerService.validateCustomer(tokenType, bearerToken)
            .then((up: UserProfile) => {
                userProfile = up
            }).then(() => {
            return deviceService.powerController(request, userProfile, endpointId)
        }).then((answer) => {
            console.log('answer:', JSON.stringify(answer, null, 2))
            cb(null, answer)
        }).catch(errorHandler)
    } else if ("Alexa.ColorController" == requestType && "SetColor" === requestName) {
        const tokenType = request.directive.endpoint.scope.type
        const bearerToken = request.directive.endpoint.scope.token

        const endpointId = request.directive.endpoint.endpointId

        let userProfile: UserProfile

        const payload = request.directive.payload

        customerService.validateCustomer(tokenType, bearerToken)
            .then((up: UserProfile) => {
                userProfile = up
            }).then(() => {
            return deviceService.setState(request, userProfile, endpointId, payload)
        }).then((answer) => {
            console.log('answer:', JSON.stringify(answer, null, 2))
            cb(null, answer)
        }).catch(errorHandler)
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