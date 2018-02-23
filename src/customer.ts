import * as AWS from 'aws-sdk'

import {tableNameFromARN} from "./util/ARNParser";

import * as Promise from 'bluebird'

import * as rp from 'request-promise-any'

import {DocumentClient} from "aws-sdk/lib/dynamodb/document_client";

let config = require('./config/stack.json') as GenericMap

AWS.config.setPromisesDependency(require('bluebird'));
AWS.config.update({
    region: config.Region,
})

export interface UserProfile {
    user_id: string
    name: string
    email: string
    api_key: string
    last_updated: number,
    short_id: string
}

export interface GenericMap {
    [key: string]: any
}

export class CustomerService {
    private customerKeysTable: string;

    private customerTable: string

    private client: DocumentClient;

    constructor(c: GenericMap) {
        this.customerTable = tableNameFromARN(c.CustomerTable)
        this.customerKeysTable = tableNameFromARN(c.CustomerKeysTable)
        this.client = new AWS.DynamoDB.DocumentClient()
    }

    /**
     * Creates/Updates an User
     *
     * @param {string} tokenType token type. Use 'UserId' for local debugging (not used in production fwiw)
     * @param {string} token token. Use the 'userId' if tokenType is 'UserId'
     * @returns {Bluebird<UserProfile>} User Profile, as a Promise
     */
    validateCustomer(tokenType: string, token: string): Promise<UserProfile> {
        /**
         * Debugging Hack. Love it
         */
        if ('UserId' == tokenType) {
            return Promise.resolve(token)
                .then((token) => {
                    return this.client.query({
                        TableName: this.customerTable,
                        KeyConditionExpression: 'user_id = :userId',
                        ExpressionAttributeValues: {
                            ':userId': token,
                        }
                    }).promise()
                }).then((item) => {
                    if (1 != item.Count)
                        return Promise.reject(`UserId ${token} not found.`)

                    return Promise.resolve({
                        api_key: item.Items[0]['api_key'],
                        email: item.Items[0]['email'],
                        name: item.Items[0]['name'],
                        user_id: item.Items[0]['user_id'],
                        short_id: item.Items[0]['short_id']
                    } as UserProfile)
                })
        } else if ('BearerToken' == tokenType) { /* The real functionality */
            /*
             * Query Amazon
             */
            const urlToLoad = `https://api.amazon.com/user/profile?access_token=${encodeURIComponent(token)}`

            let userProfile: UserProfile

            return rp(urlToLoad)
                .then((data) => {
                    console.log("data:", JSON.stringify(data, null, 2))

                    return JSON.parse(data) as UserProfile
                })
                .then((up: UserProfile) => {
                    userProfile = up

                    // Shorten Up
                    const shortId = up.user_id.replace(/^amzn1\.account\./, '')

                    // Always Update. Creates it if needed btw
                    return this.client.update({
                        TableName: this.customerTable,
                        Key: {
                            user_id: up.user_id,
                        },
                        AttributeUpdates: {
                            email: {
                                Value: up.email,
                                Action: "PUT",
                            },
                            short_id: {
                                Value: shortId,
                                Action: "PUT",
                            },
                            name: {
                                Value: up.name,
                                Action: "PUT"
                            },
                            last_updated: {
                                Value: Math.trunc(new Date().getTime() / 1000),
                                Action: "PUT"
                            }
                        }
                    }).promise()
                })
                .then((data) => {
                    console.log("Post-Update data:", JSON.stringify(data))

                    return Promise.resolve(userProfile)
                })
        } else {
            return Promise.reject(new Error(`Unexpected tokenType '${tokenType}'`))
        }
    }

    /**
     * Lookups an user by an api key id
     * @param {string} apiKeyId api key id
     * @returns {Bluebird<UserProfile>} user, as a bluebird promise
     */
    findByApiKeyId(apiKeyId: string): Promise<UserProfile> {
        const firstStep = Promise.resolve().then(() => {
            return this.client.query({
                TableName: this.customerKeysTable,
                IndexName: "api_key-index",
                KeyConditionExpression: 'api_key = :api_key',
                ExpressionAttributeValues: {
                    ':api_key': apiKeyId,
                }
            }).promise()
        })

        const secondStep = firstStep.then((result) => {
                console.log('result:', JSON.stringify(result))
                let item = result.Items[0]

                let queryParams = {
                    TableName: this.customerTable,
                    IndexName: "short_id-index",
                    KeyConditionExpression: 'short_id = :shortId',
                    ExpressionAttributeValues: {
                        ':shortId': item.short_id,
                    }
                };

                console.log('queryParams:', JSON.stringify(queryParams, null, 2))

                return this.client.query(queryParams).promise()
            }
        )

        const thirdStep = secondStep.then((customerData) => {
            console.log('customerData:', JSON.stringify(customerData, null, 2))

            if (1 != customerData.Count) {
                return Promise.reject(new Error(`No users found for key ${apiKeyId}`))
            }

            const record = customerData.Items[0];

            console.log("firstItem: ", JSON.stringify(record, null, 2))

            let result = {
                user_id: record.user_id,
                email: record.email,
                name: record.name,
                last_updated: record.last_updated,
                api_key: apiKeyId,
                short_id: record.short_id
            } as UserProfile;

            return Promise.resolve(result)
        })

        return thirdStep
    }
}

export const customerService = new CustomerService(config)