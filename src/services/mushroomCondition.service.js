const mushroomConditionModel = require('../models/mushroomCondition.model');
const mushroomTypeModel = require('../models/mushroomType.model');
const AppError = require('../utils/app-error');

function parseId(value, fieldName) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError(`${fieldName} must be a positive integer`, 400);
  }

  return parsed;
}

function parseNullableNumber(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new AppError(`${fieldName} must be a valid number`, 400);
  }

  return parsed;
}

function validateRange(minValue, maxValue, fieldLabel) {
  if (minValue !== null && maxValue !== null && minValue > maxValue) {
    throw new AppError(`${fieldLabel} minimum cannot be greater than maximum`, 400);
  }
}

async function ensureSingleConditionPerMushroomType(mushroomTypeId, ignoreConditionId = null) {
  const existingConditions = await mushroomConditionModel.findByMushroomTypeId(mushroomTypeId);

  const hasOtherCondition = existingConditions.some((condition) => String(condition.condition_id) !== String(ignoreConditionId));

  if (hasOtherCondition) {
    throw new AppError('Nấm này đã có condition rồi', 409);
  }
}

function buildRangeUpdate(payload, fieldPrefix) {
  const minKey = `${fieldPrefix}Min`;
  const maxKey = `${fieldPrefix}Max`;
  const result = {};

  if (payload[minKey] !== undefined) result[minKey] = parseNullableNumber(payload[minKey], `${fieldPrefix}Min`);
  if (payload[maxKey] !== undefined) result[maxKey] = parseNullableNumber(payload[maxKey], `${fieldPrefix}Max`);

  if (result[minKey] !== undefined && result[maxKey] !== undefined) {
    validateRange(result[minKey], result[maxKey], fieldPrefix.charAt(0).toUpperCase() + fieldPrefix.slice(1));
  }

  return result;
}

async function getAllMushroomConditions(filters = {}) {
  let mushroomTypeId = null;

  if (filters.mushroomTypeId !== undefined && filters.mushroomTypeId !== null && String(filters.mushroomTypeId).trim() !== '') {
    mushroomTypeId = parseId(filters.mushroomTypeId, 'mushroomTypeId');
  }

  return mushroomConditionModel.findAll({ mushroomTypeId });
}

async function getMushroomConditionById(conditionId) {
  const id = parseId(conditionId, 'conditionId');
  const data = await mushroomConditionModel.findById(id);

  if (!data) {
    throw new AppError('Mushroom condition not found', 404);
  }

  return data;
}

async function createMushroomCondition(payload = {}) {
  const mushroomTypeId = parseId(payload.mushroomTypeId ?? payload.mushroom_type_id, 'mushroomTypeId');
  const mushroomType = await mushroomTypeModel.findById(mushroomTypeId);

  if (!mushroomType) {
    throw new AppError('Mushroom type not found', 404);
  }

  await ensureSingleConditionPerMushroomType(mushroomTypeId);

  const data = {
    mushroomTypeId,
    temperatureMin: parseNullableNumber(payload.temperatureMin ?? payload.temperature_min, 'temperatureMin'),
    temperatureMax: parseNullableNumber(payload.temperatureMax ?? payload.temperature_max, 'temperatureMax'),
    humidityMin: parseNullableNumber(payload.humidityMin ?? payload.humidity_min, 'humidityMin'),
    humidityMax: parseNullableNumber(payload.humidityMax ?? payload.humidity_max, 'humidityMax'),
  };

  validateRange(data.temperatureMin, data.temperatureMax, 'Temperature');
  validateRange(data.humidityMin, data.humidityMax, 'Humidity');

  return mushroomConditionModel.create(data);
}

async function updateMushroomCondition(conditionId, payload = {}) {
  const id = parseId(conditionId, 'conditionId');
  const existingCondition = await mushroomConditionModel.findById(id);

  if (!existingCondition) {
    throw new AppError('Mushroom condition not found', 404);
  }

  if (!payload || Object.keys(payload).length === 0) {
    throw new AppError('No update data provided', 400);
  }

  const updateData = {};

  if (payload.mushroomTypeId !== undefined || payload.mushroom_type_id !== undefined) {
    const mushroomTypeId = parseId(payload.mushroomTypeId ?? payload.mushroom_type_id, 'mushroomTypeId');
    const mushroomType = await mushroomTypeModel.findById(mushroomTypeId);

    if (!mushroomType) {
      throw new AppError('Mushroom type not found', 404);
    }

    await ensureSingleConditionPerMushroomType(mushroomTypeId, id);
    updateData.mushroom_type_id = mushroomTypeId;
  }

  const temperatureRanges = buildRangeUpdate(payload, 'temperature');
  Object.assign(updateData, {
    temperature_min: temperatureRanges.temperatureMin,
    temperature_max: temperatureRanges.temperatureMax,
  });

  const humidityRanges = buildRangeUpdate(payload, 'humidity');
  Object.assign(updateData, {
    humidity_min: humidityRanges.humidityMin,
    humidity_max: humidityRanges.humidityMax,
  });

  const filteredUpdateData = Object.fromEntries(
    Object.entries(updateData).filter(([, value]) => value !== undefined),
  );

  if (Object.keys(filteredUpdateData).length === 0) {
    throw new AppError('No valid fields provided for update', 400);
  }

  if (
    filteredUpdateData.temperature_min !== undefined && filteredUpdateData.temperature_max !== undefined
    && filteredUpdateData.temperature_min > filteredUpdateData.temperature_max
  ) {
    throw new AppError('Temperature minimum cannot be greater than maximum', 400);
  }

  if (
    filteredUpdateData.humidity_min !== undefined && filteredUpdateData.humidity_max !== undefined
    && filteredUpdateData.humidity_min > filteredUpdateData.humidity_max
  ) {
    throw new AppError('Humidity minimum cannot be greater than maximum', 400);
  }

  const updatedCondition = await mushroomConditionModel.updateById(id, filteredUpdateData);

  if (!updatedCondition) {
    throw new AppError('Mushroom condition not found', 404);
  }

  return updatedCondition;
}

async function deleteMushroomCondition(conditionId) {
  const id = parseId(conditionId, 'conditionId');
  const deleted = await mushroomConditionModel.removeById(id);

  if (!deleted) {
    throw new AppError('Mushroom condition not found', 404);
  }

  return deleted;
}

module.exports = {
  getAllMushroomConditions,
  getMushroomConditionById,
  createMushroomCondition,
  updateMushroomCondition,
  deleteMushroomCondition,
};
