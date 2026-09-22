const mushroomTypeModel = require('../models/mushroomType.model');
const AppError = require('../utils/app-error');
const cloudinaryService = require('./cloudinary.service');

const VALID_STATUS = ['ACTIVE', 'INACTIVE'];

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStatus(status, fallback = 'ACTIVE') {
  const value = typeof status === 'string' ? status.trim().toUpperCase() : fallback;

  if (!VALID_STATUS.includes(value)) {
    throw new AppError('status must be ACTIVE or INACTIVE', 400);
  }

  return value;
}

function parsePositiveInteger(value, fieldName) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError(`${fieldName} must be a positive integer`, 400);
  }

  return parsed;
}

function parseNonNegativeNumber(value, fieldName) {
  const parsed = Number(value);

  if (Number.isNaN(parsed) || parsed < 0) {
    throw new AppError(`${fieldName} must be a non-negative number`, 400);
  }

  return parsed;
}

function parseId(value, fieldName) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError(`${fieldName} must be a positive integer`, 400);
  }

  return parsed;
}

async function getAllMushroomTypes(filters = {}) {
  let status = null;

  if (filters.status !== undefined && filters.status !== null && String(filters.status).trim() !== '') {
    status = normalizeStatus(filters.status);
  }

  return mushroomTypeModel.findAll({ status });
}

async function getMushroomTypeById(mushroomTypeId) {
  const id = parseId(mushroomTypeId, 'mushroomTypeId');
  const mushroomType = await mushroomTypeModel.findById(id);

  if (!mushroomType) {
    throw new AppError('Mushroom type not found', 404);
  }

  return mushroomType;
}

async function createMushroomType(payload = {}) {
  const name = normalizeText(payload.name);
  const description = payload.description === undefined || payload.description === null
    ? null
    : String(payload.description).trim();
  const growingDays = parsePositiveInteger(
    payload.growingDays ?? payload.growing_days,
    'growingDays',
  );
  const price = parseNonNegativeNumber(payload.price, 'price');
  const imageFile = payload.imageFile || null;
  const uploadedImageUrl = imageFile ? await cloudinaryService.uploadImage(imageFile, 'mushroom-types') : null;
  const imageUrl = uploadedImageUrl || payload.imageUrl || payload.image_url;
  const status = normalizeStatus(payload.status ?? 'ACTIVE');

  if (!name) {
    throw new AppError('name is required', 400);
  }

  if (await mushroomTypeModel.findByName(name)) {
    throw new AppError('Mushroom type name already exists', 409);
  }

  const data = {
    name,
    description: description || null,
    growingDays,
    price,
    imageUrl: imageUrl ? String(imageUrl).trim() : null,
    status,
  };

  return mushroomTypeModel.create(data);
}

async function updateMushroomType(mushroomTypeId, payload = {}) {
  const id = parseId(mushroomTypeId, 'mushroomTypeId');
  const updateData = {};

  if (!payload || Object.keys(payload).length === 0) {
    throw new AppError('No update data provided', 400);
  }

  if (payload.name !== undefined) {
    const name = normalizeText(payload.name);
    if (!name) {
      throw new AppError('name cannot be empty', 400);
    }

    if (await mushroomTypeModel.findByName(name, id)) {
      throw new AppError('Mushroom type name already exists', 409);
    }

    updateData.name = name;
  }

  if (payload.description !== undefined) {
    updateData.description = payload.description === null || payload.description === ''
      ? null
      : String(payload.description).trim();
  }

  if (payload.growingDays !== undefined || payload.growing_days !== undefined) {
    updateData.growing_days = parsePositiveInteger(
      payload.growingDays ?? payload.growing_days,
      'growingDays',
    );
  }

  if (payload.price !== undefined) {
    updateData.price = parseNonNegativeNumber(payload.price, 'price');
  }

  if (payload.imageFile) {
    const uploadedImageUrl = await cloudinaryService.uploadImage(payload.imageFile, 'mushroom-types');
    updateData.image_url = uploadedImageUrl;
  } else if (payload.imageUrl !== undefined || payload.image_url !== undefined) {
    const imageUrl = payload.imageUrl ?? payload.image_url;
    updateData.image_url = imageUrl === null || imageUrl === '' ? null : String(imageUrl).trim();
  }

  if (payload.status !== undefined) {
    updateData.status = normalizeStatus(payload.status);
  }

  if (Object.keys(updateData).length === 0) {
    throw new AppError('No valid fields provided for update', 400);
  }

  const updatedMushroomType = await mushroomTypeModel.updateById(id, updateData);

  if (!updatedMushroomType) {
    throw new AppError('Mushroom type not found', 404);
  }

  return updatedMushroomType;
}

async function deleteMushroomType(mushroomTypeId) {
  const id = parseId(mushroomTypeId, 'mushroomTypeId');
  const deletedMushroomType = await mushroomTypeModel.removeById(id);

  if (!deletedMushroomType) {
    throw new AppError('Mushroom type not found', 404);
  }

  return deletedMushroomType;
}

module.exports = {
  getAllMushroomTypes,
  getMushroomTypeById,
  createMushroomType,
  updateMushroomType,
  deleteMushroomType,
};
