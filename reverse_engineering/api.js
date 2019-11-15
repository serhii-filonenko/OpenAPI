'use strict'

const commonHelper = require('./helpers/commonHelper');
const dataHelper = require('./helpers/dataHelper');
const errorHelper = require('./helpers/errorHelper');
const adaptJsonSchema = require('./helpers/adaptJsonSchema/adaptJsonSchema');
const validationHelper = require('../forward_engineering/helpers/validationHelper')

module.exports = {
	reFromFile(data, logger, callback) {
        commonHelper.getFileData(data.filePath).then(fileData => {
            return getOpenAPISchema(fileData, data.filePath);
        }).then(openAPISchema => {
            const fieldOrder = data.fieldInference.active;
            return handleOpenAPIData(openAPISchema, fieldOrder);
        }).then(reversedData => {
            return callback(null, reversedData.hackoladeData, reversedData.modelData, [], 'multipleSchema')
        }, ({ error, openAPISchema }) => {
			validationHelper.validate(filterSchema(openAPISchema))
				.then((messages) => {
					if (!Array.isArray(messages) || !messages.length) {
						this.handleErrors(error, logger, callback);
					}

					const message = `${messages[0].label}: ${messages[0].title}`;
					const errorData = error.error || {};

					this.handleErrors(errorHelper.getValidationError({ stack: errorData.stack, message }), logger, callback);
				})
				.catch(err => {
					this.handleErrors(error, logger, callback);
				});
		}).catch(errorObject => {
            this.handleErrors(errorObject, logger, callback);
		});
	},

	handleErrors(errorObject, logger, callback) {
		const { error, title } = errorObject;
		const handledError =  commonHelper.handleErrorObject(error, title);
		logger.log('error', handledError, title);
		callback(handledError);
	},

    adaptJsonSchema(data, logger, callback) {
        logger.log('info', 'Adaptation of JSON Schema started...', 'Adapt JSON Schema');
        try {
            const jsonSchema = JSON.parse(data.jsonSchema);

            const adaptedJsonSchema = adaptJsonSchema(jsonSchema);

            logger.log('info', 'Adaptation of JSON Schema finished.', 'Adapt JSON Schema');

            callback(null, {
                jsonSchema: JSON.stringify(adaptedJsonSchema)
            });
        } catch(e) {
            callback(commonHelper.handleErrorObject(e, 'Adapt JSON Schema'), data);
        }
    }
};

const convertOpenAPISchemaToHackolade = (openAPISchema, fieldOrder) => {
    const modelData = dataHelper.getModelData(openAPISchema);
	const components = openAPISchema.components;
    const definitions = dataHelper.getComponents(openAPISchema.components, fieldOrder);
	const callbacksComponent = components && components.callbacks;
    const modelContent = dataHelper.getModelContent(openAPISchema.paths, fieldOrder, callbacksComponent);
    return { modelData, modelContent, definitions };
};

const getOpenAPISchema = (data, filePath) => new Promise((resolve, reject) => {
    const { extension, fileName } = commonHelper.getPathData(filePath);

    try {
        const openAPISchemaWithModelName = dataHelper.getOpenAPIJsonSchema(data, fileName, extension);
        const isValidOpenAPISchema = dataHelper.validateOpenAPISchema(openAPISchemaWithModelName);

        if (isValidOpenAPISchema) {
            return resolve(openAPISchemaWithModelName);
        } else {
            return reject(errorHelper.getValidationError(new Error('Selected file is not a valid OpenAPI 3.0.2 schema')));
        }
    } catch (error) {
        return reject(errorHelper.getParseError(error));
    }
});

const handleOpenAPIData = (openAPISchema, fieldOrder) => new Promise((resolve, reject) => {
    try {
        const convertedData = convertOpenAPISchemaToHackolade(openAPISchema, fieldOrder);
        const { modelData, modelContent, definitions } = convertedData;
        const hackoladeData = modelContent.containers.reduce((accumulator, container) => {
            const currentEntities = modelContent.entities[container.name];
            return [
                ...accumulator, 
                ...currentEntities.map(entity => {
                    const packageData = {
                        objectNames: {
                            collectionName: entity.collectionName
                        },
                        doc: {
                            dbName: container.name,
                            collectionName: entity.collectionName,
                            modelDefinitions: definitions,
                            bucketInfo: container
                        },
                        jsonSchema: JSON.stringify(entity)
                    };
                    return packageData;
                })
            ];
        }, []);
        return resolve({ hackoladeData, modelData });
    } catch (error) {
        return reject({ error: errorHelper.getConvertError(error), openAPISchema });
    }
});

const filterSchema = schema => {
	delete schema.modelName;

	return schema;
};
