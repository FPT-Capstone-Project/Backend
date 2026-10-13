const rentalPackageModel = require('../models/rentalPackage.model');
const AppError = require('../utils/app-error');

const VALID_STATUS = ['ACTIVE', 'INACTIVE'];

function parseId(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError(`${fieldName} must be a positive integer`, 400);
  }
  return parsed;
}

function parsePositiveInteger(value, fieldName) {
  const parsed = parseId(value, fieldName);
  return parsed;
}

function parseNonNegativeNumber(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new AppError(`${fieldName} must be a non-negative number`, 400);
  }
  return parsed;
}

function normalizeStatus(value = 'ACTIVE') {
  const status = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!VALID_STATUS.includes(status)) {
    throw new AppError('status must be ACTIVE or INACTIVE', 400);
  }
  return status;
}

function normalizePackageName(value, fieldName = 'packageName') {
  const packageName = typeof value === 'string' ? value.trim() : '';
  if (!packageName) throw new AppError(`${fieldName} is required`, 400);
  return packageName;
}

async function getAllRentalPackages(filters = {}) {
  let status;

  if (filters.status !== undefined && String(filters.status).trim() !== '') {
    status = normalizeStatus(filters.status);
  }

  return rentalPackageModel.findAll({ status });
}

async function getRentalPackageById(packageId) {
  const id = parseId(packageId, 'packageId');
  const rentalPackage = await rentalPackageModel.findById(id);
  if (!rentalPackage) throw new AppError('Rental package not found', 404);
  return rentalPackage;
}

async function createRentalPackage(payload = {}) {
  const packageName = normalizePackageName(payload.packageName ?? payload.package_name);
  const description = payload.description == null || payload.description === ''
    ? null
    : String(payload.description).trim();
  const durationDays = parsePositiveInteger(payload.durationDays ?? payload.duration_days, 'durationDays');
  const price = parseNonNegativeNumber(payload.price, 'price');
  const status = normalizeStatus(payload.status ?? 'ACTIVE');

  return rentalPackageModel.create({ packageName, description, durationDays, price, status });
}

async function updateRentalPackage(packageId, payload = {}) {
  const id = parseId(packageId, 'packageId');
  const existing = await rentalPackageModel.findById(id);
  if (!existing) throw new AppError('Rental package not found', 404);
  if (!payload || Object.keys(payload).length === 0) throw new AppError('No update data provided', 400);

  const updateData = {};
  if (payload.packageName !== undefined || payload.package_name !== undefined) {
    updateData.package_name = normalizePackageName(payload.packageName ?? payload.package_name, 'packageName');
  }
  if (payload.description !== undefined) {
    updateData.description = payload.description == null || payload.description === ''
      ? null
      : String(payload.description).trim();
  }
  if (payload.durationDays !== undefined || payload.duration_days !== undefined) {
    updateData.duration_days = parsePositiveInteger(payload.durationDays ?? payload.duration_days, 'durationDays');
  }
  if (payload.price !== undefined) updateData.price = parseNonNegativeNumber(payload.price, 'price');
  if (payload.status !== undefined) updateData.status = normalizeStatus(payload.status);

  if (Object.keys(updateData).length === 0) throw new AppError('No valid fields provided for update', 400);

  const updated = await rentalPackageModel.updateById(id, updateData);
  if (!updated) throw new AppError('Rental package not found', 404);
  return updated;
}

async function deleteRentalPackage(packageId) {
  const id = parseId(packageId, 'packageId');
  try {
    const deleted = await rentalPackageModel.removeById(id);
    if (!deleted) throw new AppError('Rental package not found', 404);
    return deleted;
  } catch (error) {
    if (error.code === '23503') {
      throw new AppError('Rental package is referenced by an order or rental and cannot be deleted', 409);
    }
    throw error;
  }
}

module.exports = {
  getAllRentalPackages,
  getRentalPackageById,
  createRentalPackage,
  updateRentalPackage,
  deleteRentalPackage,
};