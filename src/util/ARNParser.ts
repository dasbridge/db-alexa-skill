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

export const parseArn = (arnString: string): ARNElements => {
    let result = arnString.split(':').reduce(function (result, part, idx) {
        result[COMPONENTS[idx]] = part
        return result
    }, {})

    return result as ARNElements
}

export const tableNameFromARN = (arn: string, defaultValue?: string): string => {
    const parsedArn = parseArn(arn)

    return (parsedArn && parsedArn.relativeId && parsedArn.relativeId.replace(/^table\//, '') || defaultValue)
}
