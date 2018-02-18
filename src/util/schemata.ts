import * as Ajv from 'ajv'

export const validateSchema = (x: object, schema: object) => {
    const ajv = new Ajv()

    const validator = ajv.compile(schema)

    const valid = validator(x)

    if (!valid) {
        const err = new Error("Invalid Object")

        console.log('errors:', JSON.stringify({
            schema: validator.schema,
            errors: validator.errors,
            refs: validator.refs,
            refVal: validator.refVal,
            root: validator.root,
            source: validator.source
        }, null, 2))

        //(err as any).errors = validator.errors

        throw err
    }
}