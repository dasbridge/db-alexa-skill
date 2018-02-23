/**
 * Thing Metadata Stuff
 */
export interface ThingMetadata {
    reported: any

    desired: any
}

export interface ThingState {
    reported: any

    desired: any
}

export interface ThingShadow {
    metadata: ThingMetadata

    state: ThingState

    timestamp: number

    version: 60
}

export type ThingMetadataMap = { [thingName: string]: ThingMetadata }