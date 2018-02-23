const COMPONENTS = [
    'arn',
    'aws',
    'service',
    'region',
    'namespace',
    'relativeId',
]

export interface ARNElements {
    arn: string,
    aws: string,
    service: string,
    region: string,
    namespace: string,
    relativeId?: string
}

/**
 * Parses an ARN
 * @param {string} arnString
 * @returns {ARNElements} elements of the ARN
 */
export const parseArn = (arnString: string): ARNElements => {
    let result = arnString.split(':').reduce(function (result, part, idx) {
        result[COMPONENTS[idx]] = part
        return result
    }, {})

    return result as ARNElements
}

/**
 * Given an ARN, extracts the DynamoDB Table Name
 * @param {string} arn
 * @param {string} defaultValue
 * @returns {string} dynamodb table name
 */
export const tableNameFromARN = (arn: string, defaultValue?: string): string => {
    const parsedArn = parseArn(arn)

    return (parsedArn && parsedArn.relativeId && parsedArn.relativeId.replace(/^table\//, '') || defaultValue)
}
