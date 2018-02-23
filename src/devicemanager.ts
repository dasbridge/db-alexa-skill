'use strict'

import * as Promise from 'bluebird'

import {validateSchema} from "./util/schemata";

require('any-promise/register/bluebird')

require('source-map-support').install();

import {customerService, UserProfile} from "./customer";
import {ThingRequest, thingService} from "./thing";
import {Callback, ProxyHandler} from 'aws-lambda';

export const defaultResponse = function (cb: Callback) {
    return (result: object) => {
        cb(null, {
            statusCode: 200,
            body: JSON.stringify(result)
        })
    }
}

export const defaultErrorHandler = function (cb: Callback) {
    return (e: Error) => {
        cb(e, {
            statusCode: 400,
            body: JSON.stringify({
                name: e.name,
                message: e.message,
                errors: (e as any).errors
            }, null, 2)
        })
    }
}

/**
 * Device API Lambda. Used by the /devices endpoint
 */
export const main: ProxyHandler = (request, context, cb) => {
    let deviceId: string = null

    if (request.pathParameters && request.pathParameters['id']) {
        deviceId = request.pathParameters['id']
    }

    const apiKeyId: string = request.requestContext.identity['apiKeyId']

    let requestBody: object
    let userProfile: UserProfile

    Promise.resolve(request.body)
        .then((body) => JSON.parse(body))
        .then((body) => {
            requestBody = body

            return customerService.findByApiKeyId(apiKeyId)
        })
        .then((returnedUserProfile) => {
            console.log("Customer Validated: ", JSON.stringify(returnedUserProfile, null, 2))

            userProfile = returnedUserProfile
        })
        .then(() => {
            if ((null === deviceId) && ("GET" === request.httpMethod)) {
                // list devices
                console.log("Listing Devices")
                return Promise.resolve(thingService.listThingsByUser(userProfile))
                    .then(defaultResponse(cb))
            } else if ((null !== deviceId) && ("GET" === request.httpMethod)) {
                // get device details
                console.log("Describing device: " + deviceId)
                return Promise.resolve(userProfile)
                    .then(() => thingService.describeDevice(userProfile, deviceId))
                    .then(defaultResponse(cb))
            } else if ("POST" === request.httpMethod) {
                console.log("Creating a new device:", JSON.stringify(requestBody, null, 2))

                let newThingRequest: ThingRequest

                // create device
                return Promise.resolve()
                    .then(() => {
                        validateSchema(requestBody, require('./schema/newDevice.json'))
                    }).then(() => {
                        newThingRequest = requestBody as ThingRequest
                        return Promise.resolve({
                            thingId: newThingRequest.thingId,
                            thingType: newThingRequest.thingType,
                            user: userProfile
                        } as ThingRequest)
                    }).then((r) => thingService.generateNewThing(r))
                    .then(defaultResponse(cb))
            } else if ("DELETE" === request.httpMethod) {
                // delete device
            }
        })
        .catch(defaultErrorHandler(cb))
}