'use strict'

import * as Promise from 'bluebird'

import {validateSchema} from "./util/schemata";

require('any-promise/register/bluebird')

require('source-map-support').install();

import {customerService} from "./customer";
import {ThingRequest, thingService} from "./thing";

/**
 * Status Method. Returns User Status based on API Key
 * @param request api request (API Gateway)
 * @param context lambda context
 * @param cb callback
 */
export const main = (request, context, cb) => {
    console.log('request', JSON.stringify(request, null, 2))

    const apiKeyId = request.requestContext.identity.apiKeyId

    //cb(new Error("Not Implemented"), null)

    Promise.resolve()
        .then(() => customerService.findByApiKeyId(apiKeyId))
        .then((userProfile) => {
            cb(null, {
                statusCode: 200,
                body: JSON.stringify({
                    name: userProfile.name,
                    email: userProfile.email,
                }, null, 2)
            })
        }).catch((e: Error) => {
            cb(null, {
                statusCode: 500,
                body: JSON.stringify({
                    name: e.name,
                    message: e.stack
                }, null, 2)
            })
        })
}